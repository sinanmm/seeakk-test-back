import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import { unlockUser } from '../../services/User/accountLockService';

const db = prisma as any;

export const performUserSelfUnlock = async (
  workspaceId: string,
  userId: string,
  lockId?: string,
  auditContext?: { ipAddress?: string; userAgent?: string },
) => {
  const targetUser = await db.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, name: true, email: true, isLocked: true, supervisorId: true },
  });

  if (!targetUser) {
    throw Object.assign(new Error('User not found in this workspace.'), { statusCode: 404 });
  }

  if (!targetUser.isLocked) {
    throw Object.assign(new Error('This lock has already been resolved or account is not locked.'), {
      statusCode: 409,
      errorCode: 'LOCK_ALREADY_RESOLVED',
    });
  }

  // Find target lock log
  let lockLog = lockId
    ? await db.targetLockLog.findFirst({
        where: { id: lockId, userId, workspaceId, isInvalidLock: false },
      })
    : await db.targetLockLog.findFirst({
        where: { userId, workspaceId, isInvalidLock: false },
        orderBy: { lockedAt: 'desc' },
      });

  if (!lockLog) {
    throw Object.assign(new Error('Target lock record not found.'), { statusCode: 404 });
  }

  const periodId = lockLog.lockPeriodId || lockLog.periodId;
  const period = periodId
    ? await db.targetCyclePeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          label: true,
          allowSelfUnlock: true,
          selfUnlockGraceDays: true,
          lockSupervisorOnRefailure: true,
          enableSupervisorLockChain: true,
        },
      })
    : null;

  const allowSelfUnlock = Boolean(period?.allowSelfUnlock ?? lockLog.selfUnlockAllowed);
  if (!allowSelfUnlock) {
    throw Object.assign(new Error('Self-unlock is not enabled for this target period.'), {
      statusCode: 400,
      errorCode: 'SELF_UNLOCK_NOT_ENABLED',
    });
  }

  // Check if self unlock was already used for this lock period or log
  if (lockLog.selfUnlockUsed) {
    throw Object.assign(
      new Error('Self-unlock has already been used for this target lock.'),
      { statusCode: 409, errorCode: 'SELF_UNLOCK_ALREADY_USED' },
    );
  }

  if (periodId) {
    const previousSelfUnlock = await db.targetUnlockLog.findFirst({
      where: {
        userId,
        unlockedById: userId,
        exemptPeriodId: periodId,
      },
    });

    if (previousSelfUnlock) {
      throw Object.assign(
        new Error('Self-unlock has already been used for this target lock.'),
        { statusCode: 409, errorCode: 'SELF_UNLOCK_ALREADY_USED' },
      );
    }
  }

  const graceDays = period?.selfUnlockGraceDays || lockLog.selfUnlockGraceDays || 1;
  const now = new Date();
  const reEvaluationAt = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);

  const assignment = await db.targetAssignment.findFirst({
    where: { userId, workspaceId, isActive: true },
    select: { id: true },
  });

  await db.$transaction(async (tx: any) => {
    // Unlock account
    await unlockUser(userId, workspaceId, { id: userId, roleName: 'USER' });

    await tx.user.update({
      where: { id: userId },
      data: {
        targetLockedAt: null,
        targetLockReason: null,
        isActive: true,
      },
    });

    if (assignment?.id) {
      await tx.targetAssignment.update({
        where: { id: assignment.id },
        data: {
          graceUntil: reEvaluationAt,
          isLockExempt: true,
          exemptPeriodId: periodId,
          exemptUntilPeriodEnd: reEvaluationAt,
          lastUnlockDate: now,
          lastUnlockedBy: userId,
        },
      });
    }

    // Update lock log
    await tx.targetLockLog.update({
      where: { id: lockLog.id },
      data: {
        selfUnlockAllowed: true,
        selfUnlockUsed: true,
        selfUnlockedAt: now,
        selfUnlockGraceDays: graceDays,
        reEvaluationAt,
        lockSupervisorOnRefailure: period?.lockSupervisorOnRefailure ?? lockLog.lockSupervisorOnRefailure,
        enableSupervisorLockChain: period?.enableSupervisorLockChain ?? lockLog.enableSupervisorLockChain,
      },
    });

    // Create unlock log
    await tx.targetUnlockLog.create({
      data: {
        userId,
        workspaceId,
        assignmentId: assignment?.id,
        unlockedById: userId,
        reason: 'SELF_UNLOCK',
        exemptPeriodId: periodId,
        exemptUntilPeriodEnd: reEvaluationAt,
        isSelfUnlock: true,
        graceUntil: reEvaluationAt,
        targetLockLogId: lockLog.id,
      },
    });
  });

  await auditService.log({
    userId,
    workspaceId,
    action: 'TARGET_SELF_UNLOCK_PERFORMED',
    entityType: 'User',
    entityId: userId,
    details: {
      lockLogId: lockLog.id,
      periodId,
      graceDays,
      reEvaluationAt,
    },
    ipAddress: auditContext?.ipAddress,
    userAgent: auditContext?.userAgent,
  });

  logger.info('User self-unlocked account successfully', {
    userId,
    workspaceId,
    graceDays,
    reEvaluationAt,
    action: 'target_self_unlock',
  });

  return {
    success: true,
    message: `Account self-unlocked successfully. You have ${graceDays} day(s) until target re-evaluation.`,
    graceDays,
    reEvaluationAt,
  };
};
