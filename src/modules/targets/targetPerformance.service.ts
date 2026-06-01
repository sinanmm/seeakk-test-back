import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { lockUser } from '../../services/User/accountLockService';
import { canLockUserForTargetFailure, TARGET_LOCK_REASON_CODE } from './targetLockEvaluation.service';

const db = prisma as any;

export const measureLeadAchievement = async (
  userId: string,
  workspaceId: string,
  leadStageId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> =>
  db.lead.count({
    where: {
      workspaceId,
      createdById: userId,
      stageId: leadStageId,
      deletedAt: null,
      isLOB: false,
      createdAt: { gte: startDate, lte: endDate },
    },
  });

export const measureRevenueAchievement = async (
  userId: string,
  workspaceId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> => {
  const aggregate = await db.revenueTransaction.aggregate({
    where: {
      userId,
      workspaceId,
      createdAt: { gte: startDate, lte: endDate },
    },
    _sum: { amount: true },
  });
  return aggregate._sum.amount || 0;
};

export const measureFollowupAchievement = async (
  userId: string,
  workspaceId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> => {
  const logCount = await db.targetFollowupLog.count({
    where: {
      userId,
      workspaceId,
      status: 'COMPLETED',
      completedAt: { gte: startDate, lte: endDate },
    },
  });
  if (logCount > 0) return logCount;

  // Fallback to follow_ups table
  return db.followUp.count({
    where: {
      userId,
      workspaceId,
      status: 'COMPLETED',
      completedAt: { gte: startDate, lte: endDate },
    },
  });
};

export const evaluateAssignmentPeriod = async (
  assignmentId: string,
  periodId: string,
): Promise<{ completed: boolean; percentage: number }> => {
  const assignment = await db.targetAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      targetCycle: { include: { periods: true } },
      user: { select: { id: true, workspaceId: true } },
    },
  });

  if (!assignment?.isActive || !assignment.targetCycle) {
    return { completed: true, percentage: 100 };
  }

  const period = await db.targetCyclePeriod.findUnique({
    where: { id: periodId },
    include: {
      metrics: {
        include: {
          stageTargets: true,
        },
      },
    },
  });

  if (!period) return { completed: true, percentage: 100 };

  if (assignment.graceUntil && new Date(assignment.graceUntil) > new Date()) {
    return { completed: true, percentage: 100 };
  }

  // If there are no configured metrics on the period, default to legacy single-metric evaluation
  if (!period.metrics || period.metrics.length === 0) {
    const { targetMetric, leadStageId } = assignment.targetCycle;
    let achievedCount = 0;
    let achievedRevenue = 0;

    if (targetMetric === 'LEADS' && leadStageId) {
      achievedCount = await measureLeadAchievement(
        assignment.userId,
        assignment.workspaceId,
        leadStageId,
        period.startDate,
        period.endDate,
      );
    } else if (targetMetric === 'REVENUE') {
      achievedRevenue = await measureRevenueAchievement(
        assignment.userId,
        assignment.workspaceId,
        period.startDate,
        period.endDate,
      );
    } else if (targetMetric === 'FOLLOW_UP') {
      achievedCount = await measureFollowupAchievement(
        assignment.userId,
        assignment.workspaceId,
        period.startDate,
        period.endDate,
      );
    }

    const targetCount = period.targetCount || 0;
    const achieved = targetMetric === 'REVENUE' ? achievedRevenue : achievedCount;
    const percentage = targetCount > 0 ? Math.min(100, (achieved / targetCount) * 100) : 100;
    const completed = targetCount <= 0 || achieved >= targetCount;
    const status = completed ? 'COMPLETED' : 'FAILED';

    await db.targetPerformanceLog.upsert({
      where: {
        assignmentId_periodId: { assignmentId, periodId },
      },
      create: {
        assignmentId,
        periodId,
        targetCount,
        achievedCount,
        achievedRevenue,
        followupCount: targetMetric === 'FOLLOW_UP' ? achievedCount : 0,
        revenueAmount: achievedRevenue,
        completionPercentage: percentage,
        status,
        evaluatedAt: new Date(),
      },
      update: {
        achievedCount,
        achievedRevenue,
        followupCount: targetMetric === 'FOLLOW_UP' ? achievedCount : 0,
        revenueAmount: achievedRevenue,
        completionPercentage: percentage,
        status,
        evaluatedAt: new Date(),
      },
    });

    return { completed, percentage };
  }

  // Multi-metric evaluation
  let overallCompleted = true;
  let totalPercentage = 0;
  let leadsAchieved = 0;
  let revenueAchieved = 0;
  let followupsAchieved = 0;
  let legacyTargetCount = 0;

  for (const metric of period.metrics) {
    legacyTargetCount += Math.round(metric.targetValue);
    if (metric.metricType === 'LEADS') {
      let metricCompleted = true;
      let metricPercentage = 0;

      if (metric.stageTargets && metric.stageTargets.length > 0) {
        let stagesCompleted = true;
        let stagesPctSum = 0;
        for (const stageTarget of metric.stageTargets) {
          const achieved = await measureLeadAchievement(
            assignment.userId,
            assignment.workspaceId,
            stageTarget.leadStageId,
            period.startDate,
            period.endDate,
          );
          const target = stageTarget.targetValue || 0;
          const pct = target > 0 ? Math.min(100, (achieved / target) * 100) : 100;
          stagesPctSum += pct;
          if (target > 0 && achieved < target) {
            stagesCompleted = false;
          }
          leadsAchieved += achieved;
        }
        metricCompleted = stagesCompleted;
        metricPercentage = stagesPctSum / metric.stageTargets.length;
      } else {
        const stageId = assignment.targetCycle.leadStageId;
        const achieved = stageId
          ? await measureLeadAchievement(
              assignment.userId,
              assignment.workspaceId,
              stageId,
              period.startDate,
              period.endDate,
            )
          : 0;
        const target = metric.targetValue || 0;
        metricCompleted = target <= 0 || achieved >= target;
        metricPercentage = target > 0 ? Math.min(100, (achieved / target) * 100) : 100;
        leadsAchieved = achieved;
      }

      if (!metricCompleted) {
        overallCompleted = false;
      }
      totalPercentage += metricPercentage;
    } else if (metric.metricType === 'REVENUE') {
      const achieved = await measureRevenueAchievement(
        assignment.userId,
        assignment.workspaceId,
        period.startDate,
        period.endDate,
      );
      const target = metric.targetValue || 0;
      const metricCompleted = target <= 0 || achieved >= target;
      const metricPercentage = target > 0 ? Math.min(100, (achieved / target) * 100) : 100;
      if (!metricCompleted) {
        overallCompleted = false;
      }
      revenueAchieved = achieved;
      totalPercentage += metricPercentage;
    } else if (metric.metricType === 'FOLLOW_UP') {
      const achieved = await measureFollowupAchievement(
        assignment.userId,
        assignment.workspaceId,
        period.startDate,
        period.endDate,
      );
      const target = metric.targetValue || 0;
      const metricCompleted = target <= 0 || achieved >= target;
      const metricPercentage = target > 0 ? Math.min(100, (achieved / target) * 100) : 100;
      if (!metricCompleted) {
        overallCompleted = false;
      }
      followupsAchieved = achieved;
      totalPercentage += metricPercentage;
    }
  }

  const avgPercentage = period.metrics.length > 0 ? Math.min(100, totalPercentage / period.metrics.length) : 100;
  const status = overallCompleted ? 'COMPLETED' : 'FAILED';

  await db.targetPerformanceLog.upsert({
    where: {
      assignmentId_periodId: { assignmentId, periodId },
    },
    create: {
      assignmentId,
      periodId,
      targetCount: legacyTargetCount,
      achievedCount: leadsAchieved,
      achievedRevenue: revenueAchieved,
      followupCount: followupsAchieved,
      revenueAmount: revenueAchieved,
      completionPercentage: avgPercentage,
      status,
      evaluatedAt: new Date(),
    },
    update: {
      achievedCount: leadsAchieved,
      achievedRevenue: revenueAchieved,
      followupCount: followupsAchieved,
      revenueAmount: revenueAchieved,
      completionPercentage: avgPercentage,
      status,
      evaluatedAt: new Date(),
    },
  });

  return { completed: overallCompleted, percentage: avgPercentage };
};

export const lockUserForTargetFailure = async (
  userId: string,
  workspaceId: string,
  assignmentId: string,
  periodId: string,
  reason: string,
) => {
  const assignment = await db.targetAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      userId: true,
      assignedById: true,
      targetCycleId: true,
      isLockExempt: true,
      exemptPeriodId: true,
      exemptUntilPeriodEnd: true,
    },
  });

  if (!assignment) {
    logger.warn('Skipped target lock: assignment not found', { assignmentId, userId, periodId });
    return;
  }

  const period = await db.targetCyclePeriod.findUnique({
    where: { id: periodId },
    select: { id: true, periodIndex: true, endDate: true, label: true },
  });

  if (!period) {
    logger.warn('Skipped target lock: period not found', { assignmentId, userId, periodId });
    return;
  }

  if (userId !== assignment.userId) {
    logger.warn('Skipped target lock: lock subject must be the assigned target user only', {
      requestedUserId: userId,
      assignmentUserId: assignment.userId,
      assignedById: assignment.assignedById ?? null,
      assignmentId,
      periodId,
      action: 'target_lock_wrong_subject',
    });
    return;
  }

  const mayLock = await canLockUserForTargetFailure(assignment, userId, period);
  if (!mayLock) {
    return;
  }

  const lockReason = reason?.trim() || `Target incomplete: ${period.label} goals not met.`;
  const standardizedReason = `${TARGET_LOCK_REASON_CODE}: ${lockReason}`;

  await lockUser(userId, workspaceId, standardizedReason);

  await db.user.update({
    where: { id: userId },
    data: {
      targetLockedAt: new Date(),
      targetLockReason: standardizedReason,
    },
  });

  await db.targetLockLog.create({
    data: {
      userId,
      workspaceId,
      assignmentId,
      periodId,
      lockPeriodId: periodId,
      reason: standardizedReason,
      lockedBySystem: true,
    },
  });

  logger.warn('User locked for incomplete target', {
    userId,
    assignmentId,
    periodId,
    lockReason: standardizedReason,
    action: 'target_locked',
  });
};

export const runTargetLockingEvaluation = async (): Promise<void> => {
  const now = new Date();
  const duePeriods = await db.targetCyclePeriod.findMany({
    where: {
      lockingDate: { lte: now },
      targetCycle: { status: 'ACTIVE', lockingEnabled: true, deletedAt: null },
    },
    include: {
      targetCycle: true,
      performances: {
        where: { status: 'PENDING' },
        include: { assignment: { include: { user: true } } },
      },
    },
  });

  for (const period of duePeriods) {
    const assignments = await db.targetAssignment.findMany({
      where: {
        targetCycleId: period.targetCycleId,
        isActive: true,
        user: { deletedAt: null, isActive: true },
      },
      include: { user: true },
    });

    for (const assignment of assignments) {
      const evaluatedUserId = assignment.userId;
      if (!assignment.user || assignment.user.id !== evaluatedUserId) {
        continue;
      }

      const { completed } = await evaluateAssignmentPeriod(assignment.id, period.id);
      if (!completed && !assignment.user.isLocked) {
        await lockUserForTargetFailure(
          evaluatedUserId,
          assignment.workspaceId,
          assignment.id,
          period.id,
          `Target incomplete: ${period.label} goals not met.`,
        );
      }
    }
  }
};
