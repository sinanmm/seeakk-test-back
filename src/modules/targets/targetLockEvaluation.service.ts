import prisma from '../../config/prisma';
import logger from '../../utils/logger';

const db = prisma as any;

export const TARGET_LOCK_REASON_CODE = 'TARGET_LOCKED';

export const TARGET_LOCK_USER_MESSAGE =
  'Your target for the current evaluation period has not been completed. Please contact your supervisor for assistance.';

type AssignmentRow = {
  id: string;
  userId: string;
  assignedById?: string | null;
  targetCycleId: string;
  isLockExempt?: boolean;
  exemptPeriodId?: string | null;
  exemptUntilPeriodEnd?: Date | null;
};

type PeriodRow = {
  id: string;
  periodIndex: number;
  endDate: Date;
  label?: string;
};

/**
 * Only the user assigned to the target cycle may be locked for that assignment.
 * Never lock target creators, assigners, or supervisors based on someone else's assignment.
 */
/**
 * Example: Supervisor John assigns target to David.
 * - assignment.userId = David → may be locked if David fails
 * - assignedById = John → must NEVER be locked from David's assignment row
 */
export const assertLockSubjectMatchesAssignment = (
  assignment: AssignmentRow,
  evaluatedUserId: string,
): boolean => {
  if (assignment.userId !== evaluatedUserId) {
    logger.warn('Skipped target lock: evaluated user does not match assignment subject', {
      assignmentId: assignment.id,
      assignmentUserId: assignment.userId,
      evaluatedUserId,
      assignedById: assignment.assignedById ?? null,
      action: 'target_lock_subject_mismatch',
    });
    return false;
  }

  return true;
};

export const clearExpiredLockExemption = async (
  assignment: AssignmentRow,
  currentPeriod: PeriodRow,
): Promise<AssignmentRow> => {
  if (!assignment.isLockExempt || !assignment.exemptPeriodId) {
    return assignment;
  }

  const exemptPeriod = await db.targetCyclePeriod.findUnique({
    where: { id: assignment.exemptPeriodId },
    select: { id: true, periodIndex: true, endDate: true },
  });

  if (!exemptPeriod) {
    await db.targetAssignment.update({
      where: { id: assignment.id },
      data: {
        isLockExempt: false,
        exemptPeriodId: null,
        exemptUntilPeriodEnd: null,
      },
    });
    return { ...assignment, isLockExempt: false, exemptPeriodId: null, exemptUntilPeriodEnd: null };
  }

  if (currentPeriod.periodIndex > exemptPeriod.periodIndex) {
    await db.targetAssignment.update({
      where: { id: assignment.id },
      data: {
        isLockExempt: false,
        exemptPeriodId: null,
        exemptUntilPeriodEnd: null,
      },
    });
    logger.info('Cleared target lock exemption — new evaluation period started', {
      assignmentId: assignment.id,
      userId: assignment.userId,
      previousExemptPeriodId: exemptPeriod.id,
      currentPeriodId: currentPeriod.id,
      action: 'target_lock_exemption_expired',
    });
    return { ...assignment, isLockExempt: false, exemptPeriodId: null, exemptUntilPeriodEnd: null };
  }

  return assignment;
};

/**
 * Post-unlock: skip re-locking for the same target period until the next period begins.
 */
export const shouldSkipLockForExemptPeriod = (
  assignment: AssignmentRow,
  period: PeriodRow,
): boolean => {
  if (!assignment.isLockExempt) return false;

  if (assignment.exemptPeriodId && assignment.exemptPeriodId === period.id) {
    return true;
  }

  if (assignment.exemptUntilPeriodEnd) {
    const exemptEnd = new Date(assignment.exemptUntilPeriodEnd).getTime();
    const periodEnd = new Date(period.endDate).getTime();
    if (periodEnd <= exemptEnd) {
      return true;
    }
  }

  return false;
};

export const canLockUserForTargetFailure = async (
  assignment: AssignmentRow,
  evaluatedUserId: string,
  period: PeriodRow,
): Promise<boolean> => {
  if (!assertLockSubjectMatchesAssignment(assignment, evaluatedUserId)) {
    return false;
  }

  const refreshed = await clearExpiredLockExemption(assignment, period);

  if (shouldSkipLockForExemptPeriod(refreshed, period)) {
    logger.info('Skipped target lock: user has active exemption for this period', {
      assignmentId: refreshed.id,
      userId: evaluatedUserId,
      periodId: period.id,
      exemptPeriodId: refreshed.exemptPeriodId,
      action: 'target_lock_exemption_active',
    });
    return false;
  }

  return true;
};

export const applyTargetLockExemptionAfterUnlock = async (
  assignmentId: string,
  periodId: string,
  unlockedById: string,
): Promise<void> => {
  const period = await db.targetCyclePeriod.findUnique({
    where: { id: periodId },
    select: { id: true, endDate: true },
  });

  if (!period) return;

  await db.targetAssignment.update({
    where: { id: assignmentId },
    data: {
      isLockExempt: true,
      exemptPeriodId: period.id,
      exemptUntilPeriodEnd: period.endDate,
      lastUnlockDate: new Date(),
      lastUnlockedBy: unlockedById,
    },
  });
};

export const getTargetLockDisplayForUser = async (userId: string, workspaceId: string) => {
  const user = await db.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: {
      id: true,
      isLocked: true,
      targetLockedAt: true,
      targetLockReason: true,
      assignedTargetCycle: { select: { id: true, name: true } },
      targetAssignments: {
        where: { isActive: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
        include: {
          performances: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: { period: { select: { label: true } } },
          },
        },
      },
      targetLockLogs: {
        orderBy: { lockedAt: 'desc' },
        take: 1,
        select: { reason: true, lockedAt: true, lockPeriodId: true, periodId: true },
      },
    },
  });

  if (!user?.targetLockedAt && !user?.isLocked) {
    return null;
  }

  const latestPerf = user.targetAssignments[0]?.performances[0];
  const targetCount = latestPerf?.targetCount || 0;
  const achievedCount = latestPerf?.achievedCount || 0;
  const pendingTargetBalance = Math.max(0, targetCount - achievedCount);

  return {
    lockType: 'TARGET' as const,
    title: 'Your Account is Locked',
    message: TARGET_LOCK_USER_MESSAGE,
    lockReason: user.targetLockReason || user.targetLockLogs[0]?.reason || TARGET_LOCK_REASON_CODE,
    targetCycleName: user.assignedTargetCycle?.name || null,
    completionPercentage: latestPerf?.completionPercentage ?? 0,
    pendingTargetBalance,
    lockDate: user.targetLockedAt || user.targetLockLogs[0]?.lockedAt || null,
    lastPeriodLabel: latestPerf?.period?.label || null,
  };
};
