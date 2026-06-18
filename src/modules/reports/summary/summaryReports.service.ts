import prisma from '../../../config/prisma';
import { Prisma } from '@prisma/client';
import moment from 'moment-timezone';
import { getWorkspaceTimeZone } from '../../../services/User/followupService';

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

const getDateFilter = async (workspaceId: string, startDate?: string, endDate?: string) => {
  if (startDate && endDate) {
    const tz = await getWorkspaceTimeZone(workspaceId);
    return {
      gte: moment.tz(startDate, tz).startOf('day').toDate(),
      lte: moment.tz(endDate, tz).endOf('day').toDate(),
    };
  }
  return undefined;
};

// Activity Timeline
export const getTimeline = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  if (filters.startDate && filters.endDate) {
    where.date = {
      gte: moment.utc(filters.startDate).toDate(),
      lte: moment.utc(filters.endDate).toDate(),
    };
  }
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
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

export const getLeadUpdates = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId, action: 'LEAD_UPDATED' };
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.performedById = userFilter;

  const updates = await db.leadActivity.findMany({
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
    data: updates.map((act: any) => ({ ...act, activityType: act.action, createdBy: act.performedBy })), 
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  };
};

export const getApprovalsSummary = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const where: any = { workspaceId: filters.workspaceId };
  // Only use dateFilter if we can match requestedAt/approvedAt
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
  if (dateFilter) where.createdAt = dateFilter;
  const userFilter = getUserFilter(filters.userId);
  if (userFilter) where.requestedById = userFilter;

  // Assume LeadStageApproval is standard
  const approvals = await db.leadStageApproval.findMany({
    where,
    include: {
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lead: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadStageApproval.count({ where });

  return { data: approvals, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getCompanySummary = async (filters: SummaryFilterDto) => {
  const dateFilter = await getDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
  
  const leadWhere: any = { workspaceId: filters.workspaceId, deletedAt: null };
  if (dateFilter) leadWhere.createdAt = dateFilter;

  const revenueWhere: any = { workspaceId: filters.workspaceId };
  if (dateFilter) revenueWhere.createdAt = dateFilter;

  // Group leads by User
  const leadsByUser = await db.lead.groupBy({
    by: ['createdById'],
    where: leadWhere,
    _count: { id: true },
  });

  // Group revenue by User
  const revenueByUser = await db.revenueTransaction.groupBy({
    by: ['userId'],
    where: revenueWhere,
    _sum: { amount: true },
  });

  // Fetch users details
  const users = await db.user.findMany({
    where: { workspaceId: filters.workspaceId },
    select: { id: true, name: true, role: { select: { name: true } }, department: { select: { name: true } }, office: { select: { name: true } } },
  });

  const userStats = users.map((u: any) => {
    const leads = leadsByUser.find((l: any) => l.createdById === u.id)?._count.id || 0;
    const rev = revenueByUser.find((r: any) => r.userId === u.id)?._sum.amount || 0;
    return {
      userId: u.id,
      name: u.name,
      role: u.role?.name || '-',
      department: u.department?.name || '-',
      branch: u.office?.name || '-',
      leadsCreated: leads,
      revenueGenerated: rev,
    };
  });

  return {
    userStats: userStats.sort((a: any, b: any) => b.revenueGenerated - a.revenueGenerated),
  };
};
