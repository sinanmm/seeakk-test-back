import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { lockUser } from '../../services/User/accountLockService';

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

export const evaluateAssignmentPeriod = async (
  assignmentId: string,
  periodId: string,
): Promise<{ completed: boolean; percentage: number }> => {
  const assignment = await db.targetAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      targetCycle: { include: { periods: true } },
      user: { select: { id: true, workspaceId: true, graceUntil: true } },
    },
  });

  if (!assignment?.isActive || !assignment.targetCycle) {
    return { completed: true, percentage: 100 };
  }

  const period = assignment.targetCycle.periods.find((p: { id: string }) => p.id === periodId);
  if (!period) return { completed: true, percentage: 100 };

  if (assignment.user.graceUntil && new Date(assignment.user.graceUntil) > new Date()) {
    return { completed: true, percentage: 100 };
  }

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
      completionPercentage: percentage,
      status,
      evaluatedAt: new Date(),
    },
    update: {
      achievedCount,
      achievedRevenue,
      completionPercentage: percentage,
      status,
      evaluatedAt: new Date(),
    },
  });

  return { completed, percentage };
};

export const lockUserForTargetFailure = async (
  userId: string,
  workspaceId: string,
  assignmentId: string,
  periodId: string,
  reason: string,
) => {
  await lockUser(userId, workspaceId, reason);

  await db.user.update({
    where: { id: userId },
    data: {
      targetLockedAt: new Date(),
      targetLockReason: reason,
    },
  });

  await db.targetLockLog.create({
    data: {
      userId,
      workspaceId,
      assignmentId,
      periodId,
      reason,
      lockedBySystem: true,
    },
  });

  logger.warn('User locked for incomplete target', { userId, assignmentId, periodId });
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
      const { completed } = await evaluateAssignmentPeriod(assignment.id, period.id);
      if (!completed && assignment.user && !assignment.user.isLocked) {
        const metricLabel = period.targetCycle.targetMetric === 'REVENUE' ? 'revenue' : 'lead';
        await lockUserForTargetFailure(
          assignment.userId,
          assignment.workspaceId,
          assignment.id,
          period.id,
          `Target incomplete: ${period.label} ${metricLabel} goal not met.`,
        );
      }
    }
  }
};
