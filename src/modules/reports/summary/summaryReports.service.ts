import prisma from '../../../config/prisma';
import { Prisma } from '@prisma/client';

const db = prisma as any;

export interface SummaryFilterDto {
  workspaceId: string;
  startDate?: string;
  endDate?: string;
  userId?: string | string[];
  role?: string;
  leadSource?: string;
  leadStage?: string;
  branchId?: string;
  departmentId?: string;
  page?: number;
  limit?: number;
}

const getUserFilter = (userId?: string | string[]) => {
  if (!userId) return undefined;
  if (Array.isArray(userId) && userId.length > 0) return { in: userId };
  if (typeof userId === 'string') return userId;
  return undefined;
};

const getDateFilter = (startDate?: string, endDate?: string) => {
  if (startDate && endDate) {
    return {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }
  return undefined;
};

// Activity Timeline
export const getTimeline = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.performedById = userFilter;

  const activities = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { id: true, name: true, phone: true, email: true, stage: { select: { name: true } }, source: { select: { name: true } } } },
      performedBy: { select: { name: true, role: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  const total = await db.leadActivity.count({ where });

  return {
    data: activities.map((act: any) => ({ ...act, activityType: act.action, createdBy: act.performedBy })),
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export const getOverviewCard = async (filters: SummaryFilterDto) => {
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  const userFilter = getUserFilter(filters.userId);

  const leadWhere: any = { workspaceId: filters.workspaceId, deletedAt: null };
  if (dateFilter) leadWhere.createdAt = dateFilter;
  if (userFilter) leadWhere.createdById = userFilter;

  const followupWhere: any = { workspaceId: filters.workspaceId, action: 'FOLLOWUP_COMPLETED' };
  if (dateFilter) followupWhere.createdAt = dateFilter;
  if (userFilter) followupWhere.performedById = userFilter;

  const revenueWhere: any = { workspaceId: filters.workspaceId };
  if (dateFilter) revenueWhere.createdAt = dateFilter;
  if (userFilter) revenueWhere.userId = userFilter;

  const [leadsCreated, followupsCompleted, revenueItems] = await Promise.all([
    db.lead.count({ where: leadWhere }),
    db.leadActivity.count({ where: followupWhere }),
    db.revenueTransaction.aggregate({
      where: revenueWhere,
      _sum: { amount: true },
    }),
  ]);

  return {
    leadsCreated,
    followupsCompleted,
    revenueGenerated: revenueItems._sum.amount || 0,
    aiInsight: `During this period, ${leadsCreated} leads were created, and ₹${revenueItems._sum.amount || 0} in revenue was recorded.`
  };
};

export const getLeadsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId, deletedAt: null };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.createdById = userFilter;

  const leads = await db.lead.findMany({
    where,
    include: {
      source: { select: { name: true } },
      stage: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.lead.count({ where });

  return { data: leads, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getFollowupsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId, action: { contains: 'FOLLOWUP' } };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.performedById = userFilter;

  const followups = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { name: true, phone: true } },
      performedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where });

  return { 
    data: followups.map((act: any) => ({ ...act, activityType: act.action, createdBy: act.performedBy })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};

export const getRevenueSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.userId = userFilter;

  const revenue = await db.revenueTransaction.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.revenueTransaction.count({ where });

  return { 
    data: revenue.map((r: any) => ({ ...r, createdBy: r.user })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};

export const getStageMovementsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.changedAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.changedById = userFilter;

  const movements = await db.leadStageHistory.findMany({
    where,
    include: {
      lead: { select: { name: true } },
    },
    orderBy: { changedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadStageHistory.count({ where });

  return { 
    data: movements.map((m: any) => ({ ...m, createdAt: m.changedAt, fromStage: { name: m.fromStageName }, toStage: { name: m.toStageName } })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};

export const getAttendanceSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.date = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.userId = userFilter;

  const attendance = await db.attendanceRecord.findMany({
    where,
    include: {
      user: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.attendanceRecord.count({ where });

  return { data: attendance, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getExtensionsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId, action: 'FOLLOWUP_EXTENDED' };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.performedById = userFilter;

  const extensions = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      performedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where });

  return { 
    data: extensions.map((act: any) => ({ ...act, activityType: act.action, createdBy: act.performedBy })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};

export const getTargetsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.userId = userFilter;

  const targets = await db.targetAssignment.findMany({
    where,
    include: {
      user: { select: { name: true } },
      targetCycle: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.targetAssignment.count({ where });

  return { data: targets, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getAuditSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = getDateFilter(filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.performedById = userFilter;

  const audits = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      performedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where });

  return { 
    data: audits.map((act: any) => ({ ...act, activityType: act.action, createdBy: act.performedBy })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};
