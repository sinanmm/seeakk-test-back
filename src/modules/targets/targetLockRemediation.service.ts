import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import {
  getAssignedUserId,
  INVALID_TARGET_LOCK_REASON_PREFIX,
  isNonAssigneeStakeholderOnAssignment,
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
