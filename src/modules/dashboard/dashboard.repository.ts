import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';

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
      COUNT(*) FILTER (WHERE table_name = 'leads') > 0
      AND COUNT(*) FILTER (WHERE table_name = 'users') > 0
      AND COUNT(*) FILTER (WHERE table_name = 'lead_stages') > 0
      AND COUNT(*) FILTER (WHERE table_name = 'follow_ups') > 0
      AND COUNT(*) FILTER (WHERE table_name = 'audit_logs') > 0
      AND COUNT(*) FILTER (WHERE table_name = 'lead_lob_logs') > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('leads', 'users', 'lead_stages', 'follow_ups', 'audit_logs', 'lead_lob_logs')
  `;

  return Boolean(rows[0]?.ready);
};

export const countLeads = async (workspaceId: string, where: Prisma.LeadWhereInput = {}) =>
  prisma.lead.count({
    where: {
      workspaceId,
      deletedAt: null,
      ...where,
    },
  });

export const countUsers = async (workspaceId: string, where: Prisma.UserWhereInput = {}) =>
  prisma.user.count({
    where: {
      workspaceId,
      deletedAt: null,
      ...where,
    },
  });

export const findLeadCreationTimestamps = async (workspaceId: string, startDate: Date) =>
  prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      createdAt: {
        gte: startDate,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      createdAt: true,
    },
  });

export const groupLeadsByStage = async (workspaceId: string) =>
  (prisma as any).lead.groupBy({
    by: ['stageId'],
    where: {
      workspaceId,
      deletedAt: null,
    },
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

export const findLeadsByIds = async (workspaceId: string, leadIds: string[]) => {
  if (leadIds.length === 0) return [];

  return prisma.lead.findMany({
    where: {
      workspaceId,
      id: {
        in: leadIds,
      },
    },
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
