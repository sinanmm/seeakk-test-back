import prisma from '../../../config/prisma';
import logger from '../../../utils/logger';
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

const buildBaseWhere = (filters: SummaryFilterDto) => {
  const where: any = { workspaceId: filters.workspaceId, deletedAt: null };

  if (filters.startDate && filters.endDate) {
    where.createdAt = {
      gte: new Date(filters.startDate),
      lte: new Date(filters.endDate),
    };
  }

  // Support array of userIds or single userId
  if (filters.userId) {
    if (Array.isArray(filters.userId) && filters.userId.length > 0) {
      where.createdById = { in: filters.userId };
    } else if (typeof filters.userId === 'string') {
      where.createdById = filters.userId;
    }
  }

  return where;
};

// Activity Timeline
export const getTimeline = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  // Since activities are split across tables (Lead, LeadActivity, TargetLockLog, etc)
  // For now, we will fetch LeadActivities as the main timeline.
  const activities = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { id: true, name: true, phone: true, email: true, stage: { select: { name: true } }, source: { select: { name: true } } } },
      createdBy: { select: { name: true, role: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  const total = await db.leadActivity.count({ where });

  return {
    data: activities,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getOverviewCard = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);

  const [leadsCreated, followupsCompleted, revenueItems] = await Promise.all([
    db.lead.count({ where }),
    db.leadActivity.count({ where: { ...where, activityType: 'FOLLOWUP_COMPLETED' } }), // Assuming FOLLOWUP_COMPLETED or similar
    db.revenueTransaction.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { amount: true },
    }),
  ]);

  return {
    leadsCreated,
    followupsCompleted,
    revenueGenerated: revenueItems._sum.amount || 0,
    // Provide a dynamically generated string
    aiInsight: `During this period, ${leadsCreated} leads were created, and ₹${revenueItems._sum.amount || 0} in revenue was recorded.`
  };
};

export const getLeadsSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

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
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const followups = await db.leadActivity.findMany({
    where: { ...where, activityType: { contains: 'FOLLOWUP' } },
    include: {
      lead: { select: { name: true, phone: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where: { ...where, activityType: { contains: 'FOLLOWUP' } } });

  return { data: followups, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getRevenueSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const revenue = await db.revenueTransaction.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.revenueTransaction.count({ where });

  return { data: revenue, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getStageMovementsSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const movements = await db.leadStageHistory.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      fromStage: { select: { name: true } },
      toStage: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadStageHistory.count({ where });

  return { data: movements, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getAttendanceSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const attendance = await db.attendance.findMany({
    where: { workspaceId: filters.workspaceId, date: { gte: where.createdAt?.gte, lte: where.createdAt?.lte }, userId: where.createdById },
    include: {
      user: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.attendance.count({ where: { workspaceId: filters.workspaceId, date: { gte: where.createdAt?.gte, lte: where.createdAt?.lte }, userId: where.createdById } });

  return { data: attendance, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getExtensionsSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const extensions = await db.leadActivity.findMany({
    where: { ...where, activityType: 'FOLLOWUP_EXTENDED' },
    include: {
      lead: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where: { ...where, activityType: 'FOLLOWUP_EXTENDED' } });

  return { data: extensions, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getTargetsSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const targets = await db.targetPerformance.findMany({
    where: { assignment: { workspaceId: filters.workspaceId, userId: where.createdById } },
    include: {
      assignment: { include: { user: { select: { name: true } }, targetCycle: { select: { name: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.targetPerformance.count({ where: { assignment: { workspaceId: filters.workspaceId, userId: where.createdById } } });

  return { data: targets, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getAuditSummary = async (filters: SummaryFilterDto) => {
  const where = buildBaseWhere(filters);
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;

  const audits = await db.leadActivity.findMany({
    where,
    include: {
      lead: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await db.leadActivity.count({ where });

  return { data: audits, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};
