import { LeadApprovalState, Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import * as dashboardRepository from './dashboard.repository';
import { getStageBreakdown as getLOBStageBreakdown } from '../leads/lobAnalysis.service';
import { buildAccessWhere, buildActiveUsersScopedWhere, resolveVisibleLeadUserScope } from '../leads/leads.service';
import type { DashboardSummaryQueryInput, RevenueAnalyticsQueryInput } from './dashboard.validation';
import logger from '../../utils/logger';

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

const appendLeadAnd = (where: Prisma.LeadWhereInput, condition: Prisma.LeadWhereInput): Prisma.LeadWhereInput => ({
  ...where,
  AND: [
    ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND as Prisma.LeadWhereInput] : []),
    condition,
  ],
});

const buildDateRangeWhere = (dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined => {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: startOfDay(new Date(dateFrom)) } : {}),
    ...(dateTo ? { lte: endOfDay(new Date(dateTo)) } : {}),
  };
};

const buildDashboardLeadFilters = (query: DashboardSummaryQueryInput | RevenueAnalyticsQueryInput): Prisma.LeadWhereInput => {
  let where: Prisma.LeadWhereInput = {};

  if (query.userId) where.assignedToId = query.userId;
  if (query.officeId) where = appendLeadAnd(where, { assignedTo: { officeId: query.officeId } });
  if (query.stageId) where.stageId = query.stageId;
  if (query.sourceId) where.sourceId = query.sourceId;

  const createdAt = buildDateRangeWhere(query.dateFrom, query.dateTo);
  if (createdAt) where.createdAt = createdAt;

  if (query.status === 'OPEN') {
    where.isClosed = false;
  } else if (query.status === 'CLOSED') {
    where.isClosed = true;
    where.isLOB = false;
  } else if (query.status === 'LOB') {
    where.isLOB = true;
  } else if (query.status === 'ACTIVE') {
    where.isClosed = false;
    where.isLOB = false;
  } else if (query.status === 'ARCHIVED') {
    where.deletedAt = { not: null };
  }

  return where;
};

const getApprovedAdvanceByLead = async (workspaceId: string, leadIds: string[]): Promise<Map<string, number>> => {
  if (leadIds.length === 0) return new Map();
  const advanceGroups = await (prisma as any).advancePayment.groupBy({
    by: ['leadId'],
    where: {
      workspaceId,
      leadId: { in: leadIds },
      status: 'APPROVED',
    },
    _sum: { amount: true },
  });
  return new Map(advanceGroups.map((item: any) => [item.leadId, Number(item._sum.amount || 0)]));
};

const findRevenueEligibleLeads = async (
  workspaceId: string,
  leadAccess: Prisma.LeadWhereInput,
  dashboardFilters: Prisma.LeadWhereInput,
) => {
  return (prisma as any).lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      AND: [
        leadAccess,
        dashboardFilters,
        {
          stage: {
            is: {
              isClosed: true,
              isLOB: false,
              deletedAt: null,
            },
          },
          isLOB: false,
          closureType: { notIn: ['LOST', 'CANCELLED'] },
        },
      ],
    },
    select: {
      id: true,
      totalAmount: true,
      closedAt: true,
      updatedAt: true,
    },
  });
};

const calculateDashboardRevenue = async (
  workspaceId: string,
  leadAccess: Prisma.LeadWhereInput,
  dashboardFilters: Prisma.LeadWhereInput,
  dateWindow?: { gte?: Date; lte?: Date },
): Promise<{ sum: number; count: number }> => {
  const rows = await findRevenueEligibleLeads(workspaceId, leadAccess, dashboardFilters);
  if (rows.length === 0) return { sum: 0, count: 0 };
  const leadIds = rows.map((lead: any) => lead.id);
  const approvedByLead = await getApprovedAdvanceByLead(workspaceId, leadIds);

  return rows.reduce((acc: { sum: number; count: number }, lead: any) => {
    const approved = Number(approvedByLead.get(lead.id) || 0);
    const totalAmount = Number(lead.totalAmount || 0);
    const balance = Math.max(0, totalAmount - approved);
    const closedTime = (lead.closedAt || lead.updatedAt) as Date | null;
    const inWindow = !dateWindow || !closedTime || (
      (!dateWindow.gte || closedTime >= dateWindow.gte) &&
      (!dateWindow.lte || closedTime <= dateWindow.lte)
    );
    if (balance === 0 && inWindow) {
      acc.sum += totalAmount;
      acc.count += 1;
    }
    return acc;
  }, { sum: 0, count: 0 });
};

type ExpectedRevenueAggregate = {
  amount: number;
  matchingLeadCount: number;
  positiveBalanceLeadCount: number;
};

const buildExpectedRevenueSqlConditions = (
  workspaceId: string,
  visibleLeadUserScope: string[] | 'ALL',
  query: DashboardSummaryQueryInput,
): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."workspaceId" = ${workspaceId}`,
    Prisma.sql`l."deletedAt" IS NULL`,
    Prisma.sql`l."isClosed" = false`,
    Prisma.sql`l."isLOB" = false`,
    Prisma.sql`l."closureType" IS DISTINCT FROM 'CANCELLED'::"LeadClosureType"`,
  ];

  if (visibleLeadUserScope !== 'ALL') {
    if (visibleLeadUserScope.length === 0) {
      conditions.push(Prisma.sql`false`);
    } else {
      conditions.push(Prisma.sql`(l."assignedToId" IN (${Prisma.join(visibleLeadUserScope)}) OR l."createdById" IN (${Prisma.join(visibleLeadUserScope)}))`);
    }
  }

  if (query.userId) conditions.push(Prisma.sql`l."assignedToId" = ${query.userId}`);
  if (query.officeId) {
    conditions.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM "users" office_user
        WHERE office_user."id" = l."assignedToId"
          AND office_user."officeId" = ${query.officeId}
          AND office_user."deletedAt" IS NULL
      )
    `);
  }
  if (query.stageId) conditions.push(Prisma.sql`l."stageId" = ${query.stageId}`);
  if (query.sourceId) conditions.push(Prisma.sql`l."sourceId" = ${query.sourceId}`);

  const createdAt = buildDateRangeWhere(query.dateFrom, query.dateTo);
  if (createdAt?.gte) conditions.push(Prisma.sql`l."createdAt" >= ${createdAt.gte}`);
  if (createdAt?.lte) conditions.push(Prisma.sql`l."createdAt" <= ${createdAt.lte}`);

  if (query.status === 'CLOSED' || query.status === 'LOB' || query.status === 'ARCHIVED') {
    conditions.push(Prisma.sql`false`);
  } else if (query.status === 'ACTIVE' || query.status === 'OPEN') {
    conditions.push(Prisma.sql`l."isClosed" = false`);
  }

  return conditions;
};

const toSafeNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof (value as { toString?: () => string }).toString === 'function') {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const calculateExpectedRevenue = async (
  workspaceId: string,
  visibleLeadUserScope: string[] | 'ALL',
  query: DashboardSummaryQueryInput,
): Promise<ExpectedRevenueAggregate> => {
  const conditions = buildExpectedRevenueSqlConditions(workspaceId, visibleLeadUserScope, query);
  const rows = await prisma.$queryRaw<Array<{
    matchingLeadCount: bigint | number | string | null;
    positiveBalanceLeadCount: bigint | number | string | null;
    expectedRevenue: unknown;
  }>>`
    WITH lead_balances AS (
      SELECT
        l."id",
        COALESCE(l."totalAmount", 0)::numeric
          - COALESCE(approved_payments."approvedAmount", 0)::numeric AS "balanceAmount"
      FROM "leads" l
      LEFT JOIN (
        SELECT
          ap."leadId",
          SUM(COALESCE(ap."amount", 0))::numeric AS "approvedAmount"
        FROM "advance_payments" ap
        WHERE ap."workspaceId" = ${workspaceId}
          AND ap."status" = 'APPROVED'
        GROUP BY ap."leadId"
      ) approved_payments ON approved_payments."leadId" = l."id"
      WHERE ${Prisma.join(conditions, ' AND ')}
    )
    SELECT
      COUNT(*) AS "matchingLeadCount",
      COUNT(*) FILTER (WHERE "balanceAmount" > 0) AS "positiveBalanceLeadCount",
      COALESCE(SUM("balanceAmount") FILTER (WHERE "balanceAmount" > 0), 0)::numeric AS "expectedRevenue"
    FROM lead_balances
  `;

  const row = rows[0] || { matchingLeadCount: 0, positiveBalanceLeadCount: 0, expectedRevenue: 0 };
  return {
    amount: toSafeNumber(row.expectedRevenue),
    matchingLeadCount: toSafeNumber(row.matchingLeadCount),
    positiveBalanceLeadCount: toSafeNumber(row.positiveBalanceLeadCount),
  };
};

const calculateTotalAdvance = async (
  workspaceId: string,
  leadAccess: Prisma.LeadWhereInput,
): Promise<number> => {
  const result = await (prisma as any).advancePayment.aggregate({
    where: {
      workspaceId,
      status: 'APPROVED',
      lead: {
        workspaceId,
        deletedAt: null,
        AND: [leadAccess],
      },
    },
    _sum: {
      amount: true,
    },
  });
  return Number(result._sum?.amount || 0);
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

  let leadAccess: Prisma.LeadWhereInput = {};
  let visibleLeadUserScope: string[] | 'ALL' = [];
  try {
    leadAccess = await buildAccessWhere(workspaceId, actor);
    visibleLeadUserScope = await resolveVisibleLeadUserScope(workspaceId, actor);
  } catch (err) {
    leadAccess = { id: { in: [] } };
    visibleLeadUserScope = [];
  }
  const dashboardFilters = buildDashboardLeadFilters(query);
  const scopedLeadAccess: Prisma.LeadWhereInput =
    Object.keys(dashboardFilters).length > 0
      ? { AND: [leadAccess, dashboardFilters] }
      : leadAccess;
  logger.info('Dashboard summary filters applied', {
    workspaceId,
    actorId: actor.id,
    query,
    dashboardFilters,
    visibleLeadUserScope: visibleLeadUserScope === 'ALL' ? 'ALL' : { count: visibleLeadUserScope.length },
  });

  const activeUserWhere = await buildActiveUsersScopedWhere(workspaceId, actor);
  if (query.officeId) {
    (activeUserWhere as Prisma.UserWhereInput).officeId = query.officeId;
  }
  if (query.userId) {
    (activeUserWhere as Prisma.UserWhereInput).id = query.userId;
  }

  const results = await Promise.allSettled([
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: todayStart, lte: todayEnd } }, scopedLeadAccess),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } }, scopedLeadAccess),
    dashboardRepository.countLeads(workspaceId, {}, scopedLeadAccess),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: currentThirtyDayStart, lte: todayEnd } }, scopedLeadAccess),
    dashboardRepository.countLeads(workspaceId, { createdAt: { gte: previousThirtyDayStart, lte: previousThirtyDayEnd } }, scopedLeadAccess),
    dashboardRepository.countLeads(workspaceId, { isClosed: true, isLOB: false }, scopedLeadAccess),
    dashboardRepository.countLeads(
      workspaceId,
      {
        isClosed: true,
        isLOB: false,
        OR: [
          { closedAt: { gte: currentWeekStart, lte: todayEnd } },
          { closedAt: null, updatedAt: { gte: currentWeekStart, lte: todayEnd } },
        ],
      },
      scopedLeadAccess,
    ),
    dashboardRepository.countLeads(
      workspaceId,
      {
        isClosed: true,
        isLOB: false,
        OR: [
          { closedAt: { gte: previousWeekStart, lte: previousWeekEnd } },
          { closedAt: null, updatedAt: { gte: previousWeekStart, lte: previousWeekEnd } },
        ],
      },
      scopedLeadAccess,
    ),
    dashboardRepository.countUsers(workspaceId, { isActive: true, ...activeUserWhere }),
    dashboardRepository.countUsers(workspaceId, {
      isActive: true,
      createdAt: { gte: currentWeekStart, lte: todayEnd },
      ...activeUserWhere,
    }),
    dashboardRepository.countUsers(workspaceId, {
      isActive: true,
      createdAt: { gte: previousWeekStart, lte: previousWeekEnd },
      ...activeUserWhere,
    }),
    dashboardRepository.findLeadCreationTimestamps(workspaceId, growthStartDate, scopedLeadAccess),
    dashboardRepository.groupLeadsByStage(workspaceId, scopedLeadAccess, {}),
    dashboardRepository.findLeadStages(workspaceId),
    dashboardRepository.findRecentLeadAuditLogs(workspaceId, 60),
    dashboardRepository.findTodayFollowUps(workspaceId, todayStart, todayEnd, 5, scopedLeadAccess),
    getLOBStageBreakdown(workspaceId, actor, {}, scopedLeadAccess),
    dashboardRepository.countLeads(
      workspaceId,
      {
        approvalState: LeadApprovalState.PENDING,
      },
      scopedLeadAccess,
    ),
    calculateExpectedRevenue(workspaceId, visibleLeadUserScope, query),
    calculateDashboardRevenue(workspaceId, scopedLeadAccess, {}),
    calculateDashboardRevenue(workspaceId, scopedLeadAccess, {}, { gte: currentWeekStart, lte: todayEnd }),
    calculateDashboardRevenue(workspaceId, scopedLeadAccess, {}, { gte: previousWeekStart, lte: previousWeekEnd }),
    calculateTotalAdvance(workspaceId, scopedLeadAccess),
  ]);

  const getValue = <T>(index: number, fallback: T): T => {
    const result = results[index];
    if (result.status === 'fulfilled') return result.value as T;
    logger.error(`Dashboard sub-query failed at index ${index}`, { error: (result as PromiseRejectedResult).reason });
    return fallback;
  };

  const expectedRevenueResult = results[18];
  if (expectedRevenueResult.status === 'rejected') {
    logger.error('Dashboard Expected Revenue query failed', {
      workspaceId,
      actorId: actor.id,
      query,
      error: expectedRevenueResult.reason,
    });
    throw expectedRevenueResult.reason;
  }

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
  const rawAuditLogs = getValue<any[]>(14, []);
  const followUps = getValue<any[]>(15, []);
  const lobStageBreakdown = getValue<any>(16, { labels: [], lob_counts: [], total_reference: 0 });
  const pendingApprovals = getValue<number>(17, 0);
  const expectedRevenue = getValue<ExpectedRevenueAggregate>(18, {
    amount: 0,
    matchingLeadCount: 0,
    positiveBalanceLeadCount: 0,
  });
  const revenue = getValue<{ sum: number; count: number }>(19, { sum: 0, count: 0 });
  const revenueThisWeek = getValue<{ sum: number; count: number }>(20, { sum: 0, count: 0 });
  const revenueLastWeek = getValue<{ sum: number; count: number }>(21, { sum: 0, count: 0 });
  const totalAdvance = getValue<number>(22, 0);
  logger.info('Dashboard summary aggregates calculated', {
    workspaceId,
    actorId: actor.id,
    totalLeadCount,
    totalClosedLeadCount,
    pendingApprovals,
    revenueLeadCount: revenue.count,
    revenueSum: revenue.sum,
    expectedRevenue: expectedRevenue.amount,
    expectedRevenueMatchingLeadCount: expectedRevenue.matchingLeadCount,
    expectedRevenuePositiveBalanceLeadCount: expectedRevenue.positiveBalanceLeadCount,
    totalAdvance,
    followUpCount: followUps.length,
  });

  const auditLeadEntityIds = Array.from(
    new Set(
      rawAuditLogs
        .filter((item) => item.entityType === 'Lead' && item.entityId)
        .map((item) => String(item.entityId)),
    ),
  );
  const auditLeadRows =
    auditLeadEntityIds.length > 0
      ? await dashboardRepository.findLeadsByIds(workspaceId, auditLeadEntityIds, scopedLeadAccess)
      : [];
  const auditVisibleLeadIds = new Set(auditLeadRows.map((lead) => lead.id));
  const recentAuditLogs = rawAuditLogs
    .filter(
      (item) =>
        item.entityType !== 'Lead' ||
        !item.entityId ||
        auditVisibleLeadIds.has(String(item.entityId)),
    )
    .slice(0, 6);
  const visibleAuditLeadIds = new Set(
    recentAuditLogs
      .filter((item) => item.entityType === 'Lead' && item.entityId)
      .map((item) => String(item.entityId)),
  );
  const leadNamesById = new Map(
    auditLeadRows
      .filter((lead) => visibleAuditLeadIds.has(lead.id))
      .map((lead) => [lead.id, lead.name]),
  );

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

  const pipelineStages = visibleStages;
  const totalPipelineLeads = visibleStages.reduce((sum, stage) => sum + stage.count, 0);
  const denominator = totalLeadCount > 0 ? totalLeadCount : (totalPipelineLeads > 0 ? totalPipelineLeads : 1);

  const closedStage = visibleStages.find((s) => s.name.toLowerCase() === 'closed');
  const missingStages = stages
    .filter((s) => !stageCountMap.has(s.id))
    .map((s) => s.name);

  logger.info('Pipeline Stages Diagnostic Log', {
    workspaceId,
    actorId: actor.id,
    'Lead Stages Loaded': stages.length,
    'Dashboard Stage Counts': visibleStages.map((s) => ({ name: s.name, count: s.count })),
    'Total Leads': totalLeadCount,
    'Grouped Counts': Object.fromEntries(stageCountMap),
    'Missing Stages': missingStages,
    'Closed Stage Found': Boolean(closedStage),
    'Closed Lead Count': closedStage ? closedStage.count : 0,
    'Pipeline Response': pipelineStages.map((stage) => ({
      name: stage.name,
      count: stage.count,
      percent: denominator > 0 ? Math.min(100, Math.round((stage.count / denominator) * 100)) : 0,
      color: stage.color,
    })),
  });

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
        title: 'Expected Revenue',
        value: expectedRevenue.amount,
        growth: `${formatNumber(expectedRevenue.positiveBalanceLeadCount)} active balances`,
        trend: 'up',
        iconName: 'IndianRupee',
        format: 'currency',
      },
      {
        title: 'Revenue',
        value: revenue.sum,
        growth: `${formatNumber(revenueThisWeek.count)} paid closings this week`,
        trend: getTrend(revenueThisWeek.sum, revenueLastWeek.sum),
        iconName: 'IndianRupee',
        format: 'currency',
      },
      {
        title: 'Total Advance',
        value: totalAdvance,
        growth: 'Approved advances',
        trend: 'up',
        iconName: 'IndianRupee',
        format: 'currency',
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
      percent: denominator > 0 ? Math.min(100, Math.round((stage.count / denominator) * 100)) : 0,
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
    lob: (lobStageBreakdown.labels as string[]).map((label: string, index: number) => ({
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
    pendingApprovals,
    expectedRevenue: expectedRevenue.amount,
    formatted: {
      totalLeads: formatNumber(totalLeadCount),
      closedLeads: formatNumber(totalClosedLeadCount),
      activeUsers: formatNumber(activeUserCount),
      todaysLeads: formatNumber(todayLeadCount),
    },
  };
};

export const getRevenueAnalytics = async (
  workspaceId: string,
  actor: Actor,
  query: RevenueAnalyticsQueryInput,
) => {
  await ensureModuleReady();

  const isPrivileged = actor.role?.name === 'superadmin' || actor.role?.name === 'admin';
  let permissions: string[] = [];
  if (actor.roleId) {
    const rp = await prisma.rolePermission.findMany({
      where: { roleId: actor.roleId },
      include: { permission: { select: { key: true } } },
    });
    permissions = rp.map((item: any) => item.permission.key);
  }

  const hasTotalRevenue = isPrivileged || permissions.includes('VIEW_TOTAL_REVENUE');
  const hasOwnRevenue = isPrivileged || permissions.includes('VIEW_OWN_REVENUE');

  if (!hasTotalRevenue && !hasOwnRevenue) {
    throw createServiceError('You do not have permission to view revenue analytics.', 403);
  }

  let userIds: string[] | undefined = undefined;

  if (hasOwnRevenue && !hasTotalRevenue) {
    userIds = [actor.id];
  } else {
    if (query.userId) {
      userIds = [query.userId];
    }

    if (query.supervisorId) {
      const subordinates = await prisma.user.findMany({
        where: { workspaceId, supervisorId: query.supervisorId, deletedAt: null },
        select: { id: true },
      });
      const subordinateIds = subordinates.map((s) => s.id);
      userIds = userIds ? userIds.filter((id) => subordinateIds.includes(id)) : subordinateIds;
    }

    if (query.officeId) {
      const officeUsers = await prisma.user.findMany({
        where: { workspaceId, officeId: query.officeId, deletedAt: null },
        select: { id: true },
      });
      const officeUserIds = officeUsers.map((u) => u.id);
      userIds = userIds ? userIds.filter((id) => officeUserIds.includes(id)) : officeUserIds;
    }
  }

  const baseWhere: any = {
    workspaceId,
  };

  if (userIds) {
    baseWhere.userId = { in: userIds };
  }

  if (query.stageId) {
    baseWhere.closedStageId = query.stageId;
  }

  const revenueLeadFilters = buildDashboardLeadFilters(query);
  delete (revenueLeadFilters as any).stageId;
  if (Object.keys(revenueLeadFilters).length > 0) {
    baseWhere.lead = {
      deletedAt: null,
      ...revenueLeadFilters,
      stage: {
        is: {
          isClosed: true,
          isLOB: false,
        },
      },
    };
  } else {
    baseWhere.lead = {
      deletedAt: null,
      stage: {
        is: {
          isClosed: true,
          isLOB: false,
        },
      },
    };
  }

  if (query.dateFrom || query.dateTo) {
    baseWhere.createdAt = {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
    };
  }

  const transactions = await (prisma as any).revenueTransaction.findMany({
    where: baseWhere,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      closedStage: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const monthStart = startOfMonth(now);
  const yearStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);

  let totalRevenue = 0;
  let todayRevenue = 0;
  let thisMonthRevenue = 0;
  let thisYearRevenue = 0;

  transactions.forEach((tx: any) => {
    totalRevenue += tx.amount;
    const time = tx.createdAt.getTime();
    if (time >= todayStart.getTime() && time <= todayEnd.getTime()) {
      todayRevenue += tx.amount;
    }
    if (time >= monthStart.getTime()) {
      thisMonthRevenue += tx.amount;
    }
    if (time >= yearStart.getTime()) {
      thisYearRevenue += tx.amount;
    }
  });

  // Daily series (last 30 days)
  const dailySeriesMap = new Map<string, number>();
  const dailyLabels: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayDate = startOfDay(addDays(now, -i));
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(dayDate);
    const key = dayDate.toISOString().slice(0, 10);
    dailyLabels.push(label);
    dailySeriesMap.set(key, 0);
  }

  transactions.forEach((tx: any) => {
    const key = tx.createdAt.toISOString().slice(0, 10);
    if (dailySeriesMap.has(key)) {
      dailySeriesMap.set(key, dailySeriesMap.get(key)! + tx.amount);
    }
  });

  const dailyRevenue = Array.from(dailySeriesMap.entries()).map(([key, amount], index) => ({
    name: dailyLabels[index] || key,
    revenue: amount,
  }));

  // Monthly series (last 12 months)
  const monthlySeriesMap = new Map<string, number>();
  const monthlyLabels: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const monthDate = startOfMonth(addMonths(now, -i));
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(monthDate);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    monthlyLabels.push(label);
    monthlySeriesMap.set(key, 0);
  }

  transactions.forEach((tx: any) => {
    const key = `${tx.createdAt.getFullYear()}-${String(tx.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (monthlySeriesMap.has(key)) {
      monthlySeriesMap.set(key, monthlySeriesMap.get(key)! + tx.amount);
    }
  });

  const monthlyRevenue = Array.from(monthlySeriesMap.entries()).map(([key, amount], index) => ({
    name: monthlyLabels[index] || key,
    revenue: amount,
  }));

  // Yearly series (last 5 years)
  const yearlySeriesMap = new Map<number, number>();
  const currentYear = now.getFullYear();
  for (let i = 4; i >= 0; i--) {
    yearlySeriesMap.set(currentYear - i, 0);
  }

  transactions.forEach((tx: any) => {
    const year = tx.createdAt.getFullYear();
    if (yearlySeriesMap.has(year)) {
      yearlySeriesMap.set(year, yearlySeriesMap.get(year)! + tx.amount);
    }
  });

  const yearlyRevenue = Array.from(yearlySeriesMap.entries()).map(([year, amount]) => ({
    name: String(year),
    revenue: amount,
  }));

  // Revenue by User
  const userMap = new Map<string, { id: string; name: string; email: string; amount: number }>();
  transactions.forEach((tx: any) => {
    const uId = tx.userId;
    const name = resolveDisplayName(tx.user);
    if (!userMap.has(uId)) {
      userMap.set(uId, { id: uId, name, email: tx.user.email || '', amount: 0 });
    }
    userMap.get(uId)!.amount += tx.amount;
  });
  const revenueByUser = Array.from(userMap.values()).sort((a, b) => b.amount - a.amount);

  // Revenue by Lead Stage
  const stageMap = new Map<string, { id: string; name: string; color: string; amount: number }>();
  transactions.forEach((tx: any) => {
    const sId = tx.closedStageId;
    const name = tx.closedStage?.name || 'Closed Stage';
    const color = tx.closedStage?.color || '#10b981';
    if (!stageMap.has(sId)) {
      stageMap.set(sId, { id: sId, name, color, amount: 0 });
    }
    stageMap.get(sId)!.amount += tx.amount;
  });
  const revenueByStage = Array.from(stageMap.values()).sort((a, b) => b.amount - a.amount);

  // Revenue Conversion Trends (monthly breakdown)
  const trendsMap = new Map<string, { month: string; revenue: number; count: number }>();
  for (let i = 11; i >= 0; i--) {
    const monthDate = startOfMonth(addMonths(now, -i));
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(monthDate);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    trendsMap.set(key, { month: label, revenue: 0, count: 0 });
  }

  transactions.forEach((tx: any) => {
    const key = `${tx.createdAt.getFullYear()}-${String(tx.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (trendsMap.has(key)) {
      const entry = trendsMap.get(key)!;
      entry.revenue += tx.amount;
      entry.count += 1;
    }
  });
  const revenueConversionTrends = Array.from(trendsMap.values());

  const topPerformers = revenueByUser.slice(0, 5);

  return {
    kpis: {
      totalRevenue,
      todayRevenue,
      thisMonthRevenue,
      thisYearRevenue,
    },
    graphs: {
      dailyRevenue,
      monthlyRevenue,
      yearlyRevenue,
    },
    metrics: {
      revenueByUser,
      revenueByStage,
      revenueConversionTrends,
      topPerformers,
    },
  };
};
