import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import {
  getAssignedUserId,
  INVALID_TARGET_LOCK_REASON_PREFIX,
  isNonAssigneeStakeholderOnAssignment,
  isUserActingAsSupervisorOrStakeholder,
} from './targetLockEvaluation.service';

const db = prisma as any;

export type TargetLockRemediationResult = {
  invalidLogsMarked: number;
  usersUnlocked: number;
  userIdsUnlocked: string[];
};

const clearTargetLockStateForUser = async (userId: string, workspaceId: string) => {
  await db.user.update({
    where: { id: userId, workspaceId },
    data: {
      isLocked: false,
      targetLockedAt: null,
      targetLockReason: null,
      isActive: true,
    },
  });
};

const markLockLogInvalid = async (logId: string, existingReason: string) => {
  const reason = existingReason.startsWith(INVALID_TARGET_LOCK_REASON_PREFIX)
    ? existingReason
    : `${INVALID_TARGET_LOCK_REASON_PREFIX} ${existingReason}`;

  await db.targetLockLog.update({
    where: { id: logId },
    data: {
      isInvalidLock: true,
      invalidatedAt: new Date(),
      reason,
    },
  });
};

const userHasValidTargetLock = async (userId: string, workspaceId: string): Promise<boolean> => {
  const validLog = await db.targetLockLog.findFirst({
    where: {
      userId,
      workspaceId,
      isInvalidLock: false,
      lockedBySystem: true,
      assignment: { userId },
    },
    select: { id: true },
  });

  return Boolean(validLog);
};

const unlockUserIfNoValidTargetLock = async (
  userId: string,
  workspaceId: string,
  result: TargetLockRemediationResult,
) => {
  const locked = await db.user.findFirst({
    where: { id: userId, workspaceId, isLocked: true, targetLockedAt: { not: null } },
    select: { id: true },
  });

  if (!locked) return;

  if (await userHasValidTargetLock(userId, workspaceId)) {
    return;
  }

  await clearTargetLockStateForUser(userId, workspaceId);

  if (!result.userIdsUnlocked.includes(userId)) {
    result.usersUnlocked += 1;
    result.userIdsUnlocked.push(userId);
  }

  logger.info('Invalid target lock cleared from user account', {
    userId,
    workspaceId,
    action: 'target_lock_invalid_user_unlocked',
  });
};

/**
 * Finds and reverses target locks applied to assigners/creators/supervisors instead of assignees.
 * Safe to run on every server boot after migrations.
 */
export const remediateInvalidTargetLocks = async (): Promise<TargetLockRemediationResult> => {
  const result: TargetLockRemediationResult = {
    invalidLogsMarked: 0,
    usersUnlocked: 0,
    userIdsUnlocked: [],
  };

  const lockLogs = await db.targetLockLog.findMany({
    where: {
      isInvalidLock: false,
      lockedBySystem: true,
      assignmentId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      reason: true,
      assignment: {
        select: {
          id: true,
          userId: true,
          assignedById: true,
          targetCycle: { select: { createdBy: true } },
        },
      },
    },
  });

  for (const log of lockLogs) {
    if (!log.assignment) continue;

    const assignedUserId = getAssignedUserId(log.assignment);
    const invalid =
      log.userId !== assignedUserId ||
      isNonAssigneeStakeholderOnAssignment(
        log.assignment,
        log.userId,
        log.assignment.targetCycle?.createdBy ?? null,
      );

    if (!invalid) continue;

    await markLockLogInvalid(log.id, log.reason);
    result.invalidLogsMarked += 1;

    logger.warn('Invalid target lock log remediated', {
      logId: log.id,
      lockedUserId: log.userId,
      assignedUserId,
      assignmentId: log.assignment.id,
      action: 'target_lock_invalid_log',
    });

    await unlockUserIfNoValidTargetLock(log.userId, log.workspaceId, result);
  }

  // Database Cleanup Rule: Unlock any supervisor incorrectly locked and remove invalid target dependencies.
  const allLockedUsers = await db.user.findMany({
    where: {
      deletedAt: null,
      isLocked: true,
    },
    select: { id: true, workspaceId: true, targetLockReason: true },
  });

  for (const user of allLockedUsers) {
    if (await isUserActingAsSupervisorOrStakeholder(user.id)) {
      logger.warn('Cleanup: unlocking supervisor account found locked', { userId: user.id });

      // Mark all lock logs for this supervisor as invalid
      const logs = await db.targetLockLog.findMany({
        where: { userId: user.id, isInvalidLock: false },
        select: { id: true, reason: true },
      });
      for (const log of logs) {
        await markLockLogInvalid(log.id, log.reason);
        result.invalidLogsMarked += 1;
      }

      // Remove lock status & restore account access
      await clearTargetLockStateForUser(user.id, user.workspaceId);

      // Deactivate all active target assignments for the supervisor to prevent target balances
      await db.targetAssignment.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });

      // Find and delete all target performance logs for this supervisor
      const assignments = await db.targetAssignment.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      const assignmentIds = assignments.map((a: any) => a.id);
      if (assignmentIds.length > 0) {
        await db.targetPerformanceLog.deleteMany({
          where: { assignmentId: { in: assignmentIds } },
        });
      }

      // Delete target settings to prevent cron-based locking
      await db.targetSetting.deleteMany({
        where: { userId: user.id },
      });

      if (!result.userIdsUnlocked.includes(user.id)) {
        result.usersUnlocked += 1;
        result.userIdsUnlocked.push(user.id);
      }
    }
  }

  const targetLockedUsers = await db.user.findMany({
    where: {
      deletedAt: null,
      targetLockedAt: { not: null },
      isLocked: true,
    },
    select: { id: true, workspaceId: true },
  });

  for (const user of targetLockedUsers) {
    await unlockUserIfNoValidTargetLock(user.id, user.workspaceId, result);
  }

  if (result.invalidLogsMarked > 0 || result.usersUnlocked > 0) {
    logger.info('Target lock remediation completed', result);
  }

  return result;
};

export const ensureTargetLockRemediation = async (): Promise<void> => {
  try {
    await remediateInvalidTargetLocks();
  } catch (error) {
    logger.error('Target lock remediation failed', { error });
  }
};
