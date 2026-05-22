import prisma from '../../config/prisma';

const db = prisma as any;

export const getTargetDashboardAnalytics = async (workspaceId: string) => {
  const [totalCycles, lockedUsers, activeAssignments, performanceLogs] = await Promise.all([
    db.targetCycle.count({ where: { workspaceId, deletedAt: null, status: 'ACTIVE' } }),
    db.user.count({ where: { workspaceId, isLocked: true, deletedAt: null } }),
    db.targetAssignment.count({ where: { workspaceId, isActive: true } }),
    db.targetPerformanceLog.findMany({
      where: { assignment: { workspaceId, isActive: true } },
      select: {
        status: true,
        completionPercentage: true,
        achievedCount: true,
        achievedRevenue: true,
        assignment: { select: { targetCycle: { select: { targetMetric: true } } } },
      },
    }),
  ]);

  const completed = performanceLogs.filter((log: { status: string }) => log.status === 'COMPLETED').length;
  const incomplete = performanceLogs.filter((log: { status: string }) => log.status === 'FAILED').length;
  const pending = performanceLogs.filter((log: { status: string }) => log.status === 'PENDING').length;

  const leadLogs = performanceLogs.filter(
    (log: any) => log.assignment?.targetCycle?.targetMetric === 'LEADS',
  );
  const revenueLogs = performanceLogs.filter(
    (log: any) => log.assignment?.targetCycle?.targetMetric === 'REVENUE',
  );

  const avgCompletion =
    performanceLogs.length > 0
      ? performanceLogs.reduce((sum: number, log: any) => sum + (log.completionPercentage || 0), 0) /
        performanceLogs.length
      : 0;

  const leadAchievement = leadLogs.reduce((sum: number, log: any) => sum + (log.achievedCount || 0), 0);
  const revenueAchievement = revenueLogs.reduce((sum: number, log: any) => sum + (log.achievedRevenue || 0), 0);

  return {
    totalTargets: totalCycles,
    completedTargets: completed,
    incompleteTargets: incomplete,
    pendingTargets: pending,
    lockedUsers,
    activeAssignments,
    teamCompletionPercent: Math.round(avgCompletion * 10) / 10,
    leadAchievement,
    revenueAchievement,
  };
};

export const exportTargetPerformanceReport = async (workspaceId: string) => {
  const assignments = await db.targetAssignment.findMany({
    where: { workspaceId, isActive: true },
    include: {
      user: { select: { id: true, name: true, email: true } },
      targetCycle: { select: { name: true, targetMetric: true, targetType: true } },
      performances: { include: { period: true } },
    },
  });

  return assignments.map((row: any) => ({
    userName: row.user.name || row.user.email,
    userEmail: row.user.email,
    targetCycle: row.targetCycle.name,
    targetType: row.targetCycle.targetType,
    targetMetric: row.targetCycle.targetMetric,
    periods: row.performances.map((perf: any) => ({
      period: perf.period.label,
      targetCount: perf.targetCount,
      achievedCount: perf.achievedCount,
      achievedRevenue: perf.achievedRevenue,
      completionPercentage: perf.completionPercentage,
      status: perf.status,
    })),
  }));
};
