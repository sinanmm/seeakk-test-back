import prisma from '../../config/prisma';
import logger from '../../utils/logger';

const db = prisma as any;

export const TARGET_LOCK_REASON_CODE = 'TARGET_LOCKED';

export const TARGET_LOCK_USER_MESSAGE =
  'Your target for the current evaluation period has not been completed. Please contact your supervisor for assistance.';

export const INVALID_TARGET_LOCK_REASON_PREFIX = 'INVALID_LOCK:';

/** `target_assignments.userId` — the only account that may be locked for this assignment. */
export const getAssignedUserId = (assignment: { userId: string }): string => assignment.userId;

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

/**
 * True when `candidateUserId` is only a creator/assigner/supervisor on this row, not the assignee.
 */
export const isNonAssigneeStakeholderOnAssignment = (
  assignment: AssignmentRow,
  candidateUserId: string,
  cycleCreatedBy?: string | null,
): boolean => {
  const assignedUserId = getAssignedUserId(assignment);
  if (candidateUserId === assignedUserId) {
    return false;
  }
  if (assignment.assignedById && assignment.assignedById === candidateUserId) {
    return true;
  }
  if (cycleCreatedBy && cycleCreatedBy === candidateUserId) {
    return true;
  }
  return false;
};

/**
 * Checks if a user is acting as a supervisor, reporting manager, target creator,
 * target assigner, or unlocking authority for anyone else in the system.
 */
export const isUserActingAsSupervisorOrStakeholder = async (
  userId: string,
): Promise<boolean> => {
  // 1. Check if user is a supervisor/reporting manager to anyone in the workspace or globally
  const hasSubordinates = await db.user.findFirst({
    where: { supervisorId: userId, deletedAt: null },
    select: { id: true },
  });
  if (hasSubordinates) return true;

  // 2. Check if user has assigned target to someone else
  const hasAssignedTargets = await db.targetAssignment.findFirst({
    where: { assignedById: userId, NOT: { userId } },
    select: { id: true },
  });
  if (hasAssignedTargets) return true;

  // 3. Check if user is a supervisor on any target assignment for someone else
  const isSupervisorOnAssignment = await db.targetAssignment.findFirst({
    where: { supervisorId: userId, NOT: { userId } },
    select: { id: true },
  });
  if (isSupervisorOnAssignment) return true;

  // 4. Check if user is a target creator
  const hasCreatedCycle = await db.targetCycle.findFirst({
    where: { createdBy: userId },
    select: { id: true },
  });
  if (hasCreatedCycle) return true;

  // 5. Check if user has unlocked any user
  const hasUnlockedUser = await db.targetUnlockLog.findFirst({
    where: { unlockedById: userId },
    select: { id: true },
  });
  if (hasUnlockedUser) return true;

  // 6. Check if user is referenced in TargetAssignment's lastUnlockedBy
  const isLastUnlocker = await db.targetAssignment.findFirst({
    where: { lastUnlockedBy: userId },
    select: { id: true },
  });
  if (isLastUnlocker) return true;

  return false;
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
  cycleCreatedBy?: string | null,
): Promise<boolean> => {
  const assignedUserId = getAssignedUserId(assignment);

  if (evaluatedUserId !== assignedUserId) {
    assertLockSubjectMatchesAssignment(assignment, evaluatedUserId);
    return false;
  }

  // Supervisor Exclusion Rule: Supervisors must never be locked.
  if (await isUserActingAsSupervisorOrStakeholder(evaluatedUserId)) {
    logger.warn('Skipped target lock: user is supervisor or stakeholder on target cycle/assignments', {
      evaluatedUserId,
      assignmentId: assignment.id,
      action: 'target_lock_supervisor_protected',
    });
    return false;
  }

  if (isNonAssigneeStakeholderOnAssignment(assignment, evaluatedUserId, cycleCreatedBy)) {
    logger.warn('Skipped target lock: user is assigner/creator, not the assigned target owner', {
      assignmentId: assignment.id,
      assignedUserId,
      evaluatedUserId,
      assignedById: assignment.assignedById ?? null,
      cycleCreatedBy: cycleCreatedBy ?? null,
      action: 'target_lock_stakeholder_protected',
    });
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
  assignedUserId: string,
  periodId: string,
  unlockedById: string,
): Promise<void> => {
  const period = await db.targetCyclePeriod.findUnique({
    where: { id: periodId },
    select: { id: true, endDate: true },
  });

  if (!period) return;

  const assignment = await db.targetAssignment.findFirst({
    where: { id: assignmentId, userId: assignedUserId, isActive: true },
    select: { id: true },
  });

  if (!assignment) {
    logger.warn('Skipped target lock exemption: assignment not owned by unlocked user', {
      assignmentId,
      assignedUserId,
      unlockedById,
      action: 'target_unlock_exemption_skipped',
    });
    return;
  }

  await db.targetAssignment.update({
    where: { id: assignmentId, userId: assignedUserId },
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
  // Exclude supervisor/stakeholder accounts from target lock displays completely
  if (await isUserActingAsSupervisorOrStakeholder(userId)) {
    return null;
  }

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
