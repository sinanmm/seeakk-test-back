import prisma from '../../config/prisma';
import { unlockUser } from '../../services/User/accountLockService';
import { applyTargetLockExemptionAfterUnlock } from './targetLockEvaluation.service';

const db = prisma as any;

const hasUnlockPermission = (permissions: string[] = []) =>
  permissions.some((key) =>
    ['USERS_UNLOCK', 'unlock_target_locked_users', 'SYSTEM_CONFIG', 'manage_target_cycles'].includes(key),
  );

export const listLockedStaff = async (workspaceId: string) => {
  const users = await db.user.findMany({
    where: { workspaceId, isLocked: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      isLocked: true,
      targetLockedAt: true,
      targetLockReason: true,
      supervisorId: true,
      supervisor: { select: { id: true, name: true, email: true } },
      assignedTargetCycle: {
        select: {
          id: true,
          name: true,
          targetMetric: true,
          targetType: true,
        },
      },
      targetAssignments: {
        where: { isActive: true },
        take: 1,
        include: {
          performances: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: { period: true },
          },
        },
      },
    },
    orderBy: { targetLockedAt: 'desc' },
  });

  return Promise.all(users.map(async (user: any) => {
    const latestPerf = user.targetAssignments[0]?.performances[0];
    
    // Check lock logs and unlock logs for badges
    const latestLock = await db.targetLockLog.findFirst({
      where: { userId: user.id, workspaceId },
      orderBy: { lockedAt: 'desc' },
    });
    const latestUnlock = await db.targetUnlockLog.findFirst({
      where: { userId: user.id, workspaceId },
      orderBy: { unlockedAt: 'desc' },
    });

    const isEscalatedLock = latestLock?.reason?.includes('Escalated lock') ?? false;
    const hasUsedSelfUnlock = await db.targetUnlockLog.findFirst({
      where: {
        userId: user.id,
        unlockedById: user.id,
        exemptPeriodId: latestLock?.lockPeriodId || latestLock?.periodId,
      },
    }).then(Boolean);
    const unlockedBySystem = latestUnlock?.unlockedById === 'system';

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      targetLockedAt: user.targetLockedAt,
      targetLockReason: user.targetLockReason,
      supervisor: user.supervisor,
      targetCycle: user.assignedTargetCycle,
      completionPercentage: latestPerf?.completionPercentage ?? 0,
      pendingTargetBalance: latestPerf
        ? Math.max(0, (latestPerf.targetCount || 0) - (latestPerf.achievedCount || 0))
        : 0,
      lastPeriodLabel: latestPerf?.period?.label || null,
      isEscalatedLock,
      hasUsedSelfUnlock,
      unlockedBySystem,
      lastUnlockType: latestUnlock?.reason === 'SELF_UNLOCK' ? 'SELF_UNLOCK' : (latestUnlock ? 'ADMIN' : null),
    };
  }));
};

export const unlockTargetLockedUser = async (
  workspaceId: string,
  userId: string,
  actor: { id: string; roleName?: string | null; permissions?: string[] },
  reason?: string,
) => {
  const targetUser = await db.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, isLocked: true, supervisorId: true },
  });

  if (!targetUser) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404 });
  }
  if (!targetUser.isLocked) {
    throw Object.assign(new Error('User account is not locked.'), { statusCode: 409 });
  }

  const latestLock = await db.targetLockLog.findFirst({
    where: { userId, workspaceId },
    orderBy: { lockedAt: 'desc' },
    select: { periodId: true, lockPeriodId: true },
  });

  const exemptPeriodId = latestLock?.lockPeriodId || latestLock?.periodId || null;

  const actorIsSupervisor = Boolean(targetUser.supervisorId && targetUser.supervisorId === actor.id);
  const actorIsAuthorizedAdmin = hasUnlockPermission(actor.permissions);
  const isSelfUnlockAttempt = actor.id === userId;

  let allowUnlock = actorIsSupervisor || actorIsAuthorizedAdmin;

  if (isSelfUnlockAttempt && !allowUnlock) {
    // Check if self unlock was already used for this period
    const hasUsedSelfUnlock = await db.targetUnlockLog.findFirst({
      where: {
        userId,
        unlockedById: userId,
        exemptPeriodId,
      },
    });

    if (!hasUsedSelfUnlock) {
      allowUnlock = true;
      reason = 'SELF_UNLOCK';
    } else {
      throw Object.assign(
        new Error('You have already used your self-unlock for this target cycle. Please contact your supervisor.'),
        { statusCode: 403, errorCode: 'SELF_UNLOCK_ALREADY_USED' }
      );
    }
  }

  if (!allowUnlock) {
    throw Object.assign(
      new Error('Only the assigned supervisor or an authorized admin can unlock this account.'),
      { statusCode: 403, errorCode: 'TARGET_UNLOCK_FORBIDDEN' },
    );
  }

  const assignment = await db.targetAssignment.findFirst({
    where: { userId, workspaceId, isActive: true },
    select: { id: true },
  });

  await unlockUser(userId, workspaceId, actor);

  await db.user.update({
    where: { id: userId },
    data: { targetLockedAt: null, targetLockReason: null, isActive: true },
  });

  let exemptUntilPeriodEnd: Date | null = null;
  if (exemptPeriodId) {
    const exemptPeriod = await db.targetCyclePeriod.findUnique({
      where: { id: exemptPeriodId },
      select: { endDate: true },
    });
    exemptUntilPeriodEnd = exemptPeriod?.endDate ?? null;
  }

  if (assignment?.id && exemptPeriodId) {
    await applyTargetLockExemptionAfterUnlock(assignment.id, userId, exemptPeriodId, actor.id);
  }

  await db.targetUnlockLog.create({
    data: {
      userId,
      workspaceId,
      assignmentId: assignment?.id,
      unlockedById: actor.id,
      reason: reason || 'Manual unlock by supervisor/admin',
      exemptPeriodId,
      exemptUntilPeriodEnd,
    },
  });

  return db.user.findUnique({ where: { id: userId } });
};

export const extendTargetGracePeriod = async (
  workspaceId: string,
  userId: string,
  actor: { id: string; permissions?: string[] },
  graceUntil: string,
) => {
  if (!hasUnlockPermission(actor.permissions)) {
    const user = await db.user.findFirst({ where: { id: userId, workspaceId }, select: { supervisorId: true } });
    if (!user?.supervisorId || user.supervisorId !== actor.id) {
      throw Object.assign(new Error('Not authorized to extend grace period.'), { statusCode: 403 });
    }
  }

  const date = new Date(graceUntil);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Invalid grace period date.'), { statusCode: 422 });
  }

  await db.targetAssignment.updateMany({
    where: { userId, workspaceId, isActive: true },
    data: { graceUntil: date },
  });

  if (await db.user.findFirst({ where: { id: userId, isLocked: true } })) {
    await unlockTargetLockedUser(workspaceId, userId, actor, 'Grace period extension');
  }

  return { graceUntil: date };
};
