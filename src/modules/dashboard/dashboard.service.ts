import { LeadApprovalState } from '@prisma/client';
import * as dashboardRepository from './dashboard.repository';
import { getStageBreakdown as getLOBStageBreakdown } from '../leads/lobAnalysis.service';
import type { DashboardSummaryQueryInput } from './dashboard.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type DashboardRange = DashboardSummaryQueryInput['range'];
type DashboardTrend = 'up' | 'down';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string => {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.username?.trim()) return user.username.trim();
  if (user?.email?.trim()) return user.email.trim();
  return 'System';
};

const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const startOfWeek = (value = new Date()) => {
  const date = startOfDay(value);
  const day = date.getDay();
  const distanceFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - distanceFromMonday);
  return date;
};

const startOfMonth = (value = new Date()) => {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (value: Date, amount: number) => {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
};

const addMonths = (value: Date, amount: number) => {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount);
  return date;
};

const formatNumber = (value: number): string => new Intl.NumberFormat('en-US').format(value);

const formatTime = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);

const formatScheduleLabel = (value: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(value);

const timeAgo = (value: Date): string => {
  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
};

const getTrend = (current: number, previous: number): DashboardTrend => (current >= previous ? 'up' : 'down');

const getTodayLeadDeltaLabel = (todayCount: number, yesterdayCount: number): string => {
  if (todayCount === yesterdayCount) return 'Matched yesterday';
  const delta = todayCount - yesterdayCount;
  return `${delta > 0 ? '+' : ''}${delta} vs yesterday`;
};

const humanizeAuditAction = (action: string): string => {
  const map: Record<string, string> = {
    LEAD_CREATED: 'created lead',
    LEAD_ASSIGNED: 'assigned lead',
    LEAD_STAGE_CHANGED: 'updated stage',
    LEAD_CLOSED: 'closed lead',
    LEAD_LOB_APPLIED: 'moved lead to LOB',
    BULK_ASSIGN: 'bulk assigned leads',
    LEAD_STAGE_APPROVAL_REQUESTED: 'requested approval',
    LEAD_STAGE_APPROVAL_APPROVED: 'approved stage change',
    LEAD_STAGE_APPROVAL_DENIED: 'denied stage change',
  };

  return map[action] || action.toLowerCase().replace(/_/g, ' ');
};

const getActivityStatus = (action: string): 'assigned' | 'pending' | 'closed' => {
  if (action === 'LEAD_STAGE_APPROVAL_REQUESTED') return 'pending';
  if (['LEAD_CLOSED', 'LEAD_LOB_APPLIED', 'LEAD_STAGE_APPROVAL_APPROVED'].includes(action)) return 'closed';
  return 'assigned';
};

const getGrowthStartDate = (range: DashboardRange): Date => {
  const now = new Date();

  if (range === '12m') {
    return startOfMonth(addMonths(now, -11));
  }

  if (range === '30d') {
    return startOfDay(addDays(now, -29));
  }

  return startOfDay(addDays(now, -6));
};

const buildLeadGrowthSeries = (
  timestamps: Array<{ createdAt: Date }>,
  range: DashboardRange,
): Array<{ name: string; leads: number }> => {
  if (range === '12m') {
    const periods = Array.from({ length: 12 }, (_, index) => {
      const monthDate = startOfMonth(addMonths(new Date(), index - 11));
      const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(monthDate);
      return { key, label, count: 0 };
    });

    const indexByKey = new Map(periods.map((item, index) => [item.key, index]));
    timestamps.forEach(({ createdAt }) => {
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      const periodIndex = indexByKey.get(key);
      if (periodIndex !== undefined) periods[periodIndex].count += 1;
    });

    return periods.map((item) => ({ name: item.label, leads: item.count }));
  }

  const totalDays = range === '30d' ? 30 : 7;
  const periods = Array.from({ length: totalDays }, (_, index) => {
    const dayDate = startOfDay(addDays(new Date(), index - (totalDays - 1)));
    const key = dayDate.toISOString().slice(0, 10);
    const label = range === '30d'
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(dayDate)
      : new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(dayDate);

    return { key, label, count: 0 };
  });

  const indexByKey = new Map(periods.map((item, index) => [item.key, index]));
  timestamps.forEach(({ createdAt }) => {
    const key = createdAt.toISOString().slice(0, 10);
    const periodIndex = indexByKey.get(key);
    if (periodIndex !== undefined) periods[periodIndex].count += 1;
  });

  return periods.map((item) => ({ name: item.label, leads: item.count }));
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await dashboardRepository.ensureDashboardSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Dashboard module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

export const getDashboardSummary = async (
  workspaceId: string,
  actor: Actor,
  query: DashboardSummaryQueryInput,
) => {
  await ensureModuleReady();

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(addDays(now, -1));
  const yesterdayEnd = endOfDay(addDays(now, -1));
  const currentWeekStart = startOfWeek(now);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEnd = endOfDay(addDays(currentWeekStart, -1));
  const currentThirtyDayStart = startOfDay(addDays(now, -29));
  const previousThirtyDayStart = startOfDay(addDays(now, -59));
  const previousThirtyDayEnd = endOfDay(addDays(now, -30));
  const growthStartDate = getGrowthStartDate(query.range);

  const results = await Promise.allSettled([
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: todayStart, lte: todayEnd } }),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } }),
    dashboardRepository.countLeads(workspaceId),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: currentThirtyDayStart, lte: todayEnd } }),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: previousThirtyDayStart, lte: previousThirtyDayEnd } }),
    dashboardRepository.countLeads(workspaceId, { isClosed: true }),
    dashboardRepository.countLeads(workspaceId, {
      isClosed: true,
      OR: [
        { closedAt: { gte: currentWeekStart, lte: todayEnd } },
        { closedAt: null, updatedAt: { gte: currentWeekStart, lte: todayEnd } },
      ],
    }),
    dashboardRepository.countLeads(workspaceId, {
      isClosed: true,
      OR: [
        { closedAt: { gte: previousWeekStart, lte: previousWeekEnd } },
        { closedAt: null, updatedAt: { gte: previousWeekStart, lte: previousWeekEnd } },
      ],
    }),
    dashboardRepository.countUsers(workspaceId, { isActive: true }),
    dashboardRepository.countUsers(workspaceId, {
      isActive: true,
      createdAt: { gte: currentWeekStart, lte: todayEnd },
    }),
    dashboardRepository.countUsers(workspaceId, {
      isActive: true,
      createdAt: { gte: previousWeekStart, lte: previousWeekEnd },
    }),
    dashboardRepository.findLeadCreationTimestamps(workspaceId, growthStartDate),
    dashboardRepository.groupLeadsByStage(workspaceId),
    dashboardRepository.findLeadStages(workspaceId),
    dashboardRepository.findRecentLeadAuditLogs(workspaceId, 6),
    dashboardRepository.findTodayFollowUps(workspaceId, actor.id, todayStart, todayEnd, 5),
    getLOBStageBreakdown(workspaceId, actor, {}),
  ]);

  const getValue = <T>(index: number, fallback: T): T => {
    const result = results[index];
    if (result.status === 'fulfilled') return result.value as T;
    logger.error(`Dashboard sub-query failed at index ${index}`, { error: (result as PromiseRejectedResult).reason });
    return fallback;
  };

  const todayLeadCount = getValue(0, 0);
  const yesterdayLeadCount = getValue(1, 0);
  const totalLeadCount = getValue(2, 0);
  const recentLeadCount = getValue(3, 0);
  const previousRecentLeadCount = getValue(4, 0);
  const totalClosedLeadCount = getValue(5, 0);
  const closedThisWeekCount = getValue(6, 0);
  const closedLastWeekCount = getValue(7, 0);
  const activeUserCount = getValue(8, 0);
  const activeUsersJoinedThisWeek = getValue(9, 0);
  const activeUsersJoinedLastWeek = getValue(10, 0);
  const leadGrowthTimestamps = getValue<any[]>(11, []);
  const stageCounts = getValue<any[]>(12, []);
  const stages = getValue<any[]>(13, []);
  const recentAuditLogs = getValue<any[]>(14, []);
  const followUps = getValue<any[]>(15, []);
  const lobStageBreakdown = getValue<any>(16, { labels: [], lob_counts: [], total_reference: 0 });

  const leadIds = Array.from(
    new Set(
      recentAuditLogs
        .filter((item) => item.entityType === 'Lead' && item.entityId)
        .map((item) => String(item.entityId)),
    ),
  );
  const leadRows = await dashboardRepository.findLeadsByIds(workspaceId, leadIds);
  const leadNamesById = new Map(leadRows.map((lead) => [lead.id, lead.name]));

  const stageCountMap = new Map<string, number>();
  stageCounts.forEach((row: any) => {
    if (row.stageId) {
      stageCountMap.set(row.stageId, row._count?._all || 0);
    }
  });

  const visibleStages = stages
    .map((stage) => ({
      name: stage.name,
      count: stageCountMap.get(stage.id) || 0,
      color: stage.color || '#10B981',
      order: stage.order,
    }))
    .sort((left, right) => left.order - right.order);

  const nonZeroStages = visibleStages.filter((stage) => stage.count > 0);
  const pipelineStages = nonZeroStages.length > 0 ? nonZeroStages : visibleStages.slice(0, 4);
  const highestStageCount = Math.max(...pipelineStages.map((stage) => stage.count), 1);

  return {
    kpis: [
      {
        title: "Today's Leads",
        value: todayLeadCount,
        growth: getTodayLeadDeltaLabel(todayLeadCount, yesterdayLeadCount),
        trend: getTrend(todayLeadCount, yesterdayLeadCount),
        iconName: 'Target',
      },
      {
        title: 'Total Leads',
        value: totalLeadCount,
        growth: `${recentLeadCount} added in last 30 days`,
        trend: getTrend(recentLeadCount, previousRecentLeadCount),
        iconName: 'Users',
      },
      {
        title: 'Closed Leads',
        value: totalClosedLeadCount,
        growth: `${closedThisWeekCount} closed this week`,
        trend: getTrend(closedThisWeekCount, closedLastWeekCount),
        iconName: 'CheckCircle2',
      },
      {
        title: 'Active Users',
        value: activeUserCount,
        growth: `${activeUsersJoinedThisWeek} joined this week`,
        trend: getTrend(activeUsersJoinedThisWeek, activeUsersJoinedLastWeek),
        iconName: 'TrendingUp',
      },
    ],
    leadGrowth: buildLeadGrowthSeries(leadGrowthTimestamps, query.range),
    pipeline: pipelineStages.map((stage) => ({
      name: stage.name,
      count: stage.count,
      percent: Math.round((stage.count / highestStageCount) * 100),
      color: stage.color,
    })),
    activities: recentAuditLogs.map((item) => {
      const target = item.entityType === 'Lead' && item.entityId
        ? leadNamesById.get(item.entityId) || 'Lead'
        : item.entityType || 'Workspace';

      return {
        id: item.id,
        user: resolveDisplayName(item.user),
        action: humanizeAuditAction(item.action),
        target: target || 'Unknown',
        time: timeAgo(item.createdAt),
        avatar: null,
        status: getActivityStatus(item.action),
      };
    }),
    lob: lobStageBreakdown.labels.map((label, index) => ({
      name: label,
      lost: lobStageBreakdown.lob_counts[index] || 0,
    })),
    meetings: followUps.map((item) => ({
      id: item.id,
      title: `${item.type} - ${item.lead?.name || 'Unknown Lead'}`,
      time: formatTime(item.scheduledAt),
      type: /video|meet|zoom/i.test(item.type) ? 'video' : 'call',
    })),
    scheduleDateLabel: formatScheduleLabel(now),
    range: query.range,
    pendingApprovals: await dashboardRepository.countLeads(workspaceId, {
      approvalState: LeadApprovalState.PENDING,
    }),
    formatted: {
      totalLeads: formatNumber(totalLeadCount),
      closedLeads: formatNumber(totalClosedLeadCount),
      activeUsers: formatNumber(activeUserCount),
      todaysLeads: formatNumber(todayLeadCount),
    },
  };
};
