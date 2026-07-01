import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { mergeWorkspaceLeadFilters } from '../leads/leadQueryScope';

const DASHBOARD_AUDIT_ACTIONS = [
  'LEAD_CREATED',
  'LEAD_ASSIGNED',
  'LEAD_STAGE_CHANGED',
  'LEAD_CLOSED',
  'LEAD_LOB_APPLIED',
  'BULK_ASSIGN',
  'LEAD_STAGE_APPROVAL_REQUESTED',
  'LEAD_STAGE_APPROVAL_APPROVED',
  'LEAD_STAGE_APPROVAL_DENIED',
] as const;

export const ensureDashboardSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      SUM(CASE WHEN table_name = 'leads' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN table_name = 'users' THEN 1 ELSE 0 END) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('leads', 'users')
  `;

  return Boolean(rows[0]?.ready);
};

export const countLeads = async (
  workspaceId: string,
  where: Prisma.LeadWhereInput = {},
  leadAccess: Prisma.LeadWhereInput = {},
) =>
  prisma.lead.count({
    where: mergeWorkspaceLeadFilters(workspaceId, leadAccess, where),
  });

export const countUsers = async (workspaceId: string, where: Prisma.UserWhereInput = {}) =>
  prisma.user.count({
    where: {
      workspaceId,
      deletedAt: null,
      ...where,
    },
  });

export const findLeadCreationTimestamps = async (
  workspaceId: string,
  startDate: Date,
  leadAccess: Prisma.LeadWhereInput = {},
) =>
  prisma.lead.findMany({
    where: mergeWorkspaceLeadFilters(workspaceId, leadAccess, {
      createdAt: {
        gte: startDate,
      },
    }),
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      createdAt: true,
    },
  });

export const groupLeadsByStage = async (workspaceId: string, leadAccess: Prisma.LeadWhereInput = {}) =>
  (prisma as any).lead.groupBy({
    by: ['stageId'],
    where: mergeWorkspaceLeadFilters(workspaceId, leadAccess, {}),
    _count: {
      _all: true,
    },
  });

export const findLeadStages = async (workspaceId: string) =>
  prisma.leadStage.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: {
      order: 'asc',
    },
    select: {
      id: true,
      name: true,
      color: true,
      order: true,
      isClosed: true,
      isLOB: true,
    },
  });

export const findRecentLeadAuditLogs = async (workspaceId: string, take: number) =>
  prisma.auditLog.findMany({
    where: {
      workspaceId,
      action: {
        in: [...DASHBOARD_AUDIT_ACTIONS],
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take,
    select: {
      id: true,
      userId: true,
      action: true,
      entityType: true,
      entityId: true,
      details: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
        },
      },
    },
  });

export const findLeadsByIds = async (
  workspaceId: string,
  leadIds: string[],
  leadAccess: Prisma.LeadWhereInput = {},
) => {
  if (leadIds.length === 0) return [];

  return prisma.lead.findMany({
    where: mergeWorkspaceLeadFilters(workspaceId, leadAccess, {
      id: {
        in: leadIds,
      },
    }),
    select: {
      id: true,
      name: true,
    },
  });
};

export const findTodayFollowUps = async (
  workspaceId: string,
  userId: string,
  startDate: Date,
  endDate: Date,
  take: number,
) =>
  prisma.followUp.findMany({
    where: {
      workspaceId,
      userId,
      status: 'PENDING',
      scheduledAt: {
        gte: startDate,
        lte: endDate,
      },
      lead: {
        deletedAt: null,
      },
    },
    orderBy: {
      scheduledAt: 'asc',
    },
    take,
    select: {
      id: true,
      type: true,
      scheduledAt: true,
      lead: {
        select: {
          name: true,
        },
      },
    },
  });
