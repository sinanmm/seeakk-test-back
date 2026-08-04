import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';

const { sql, join } = Prisma as any;

export const ensureBulkAssignSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      SUM(CASE WHEN table_name = 'leads' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN table_name = 'lead_activities' THEN 1 ELSE 0 END) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('leads', 'lead_activities')
  `;

  return Boolean(rows[0]?.ready);
};

export const getRolePermissionKeys = async (roleId: string): Promise<string[]> => {
  const rows = await (prisma as any).rolePermission.findMany({
    where: { roleId },
    include: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return rows.map((row: any) => row.permission.key);
};

export const getTeamUserIds = async (workspaceId: string, supervisorId: string): Promise<string[]> => {
  const rows = await prisma.user.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      supervisorId,
    },
    select: {
      id: true,
    },
  });

  return rows.map((row: { id: string }) => row.id);
};

export const findAssignableUser = async (workspaceId: string, userId: string) =>
  prisma.user.findFirst({
    where: {
      id: userId,
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      isActive: true,
    },
  });

export const findAssignableUsers = async (workspaceId: string, userIds: string[]) => {
  if (userIds.length === 0) return [];

  return prisma.user.findMany({
    where: {
      id: { in: userIds },
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      isActive: true,
    },
  });
};

export const countMatchingLeads = async (where: any): Promise<number> =>
  (prisma as any).lead.count({ where });

export const findMatchingLeadIds = async (where: any, limit: number): Promise<string[]> => {
  const rows = await (prisma as any).lead.findMany({
    where,
    take: limit,
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return rows.map((row: { id: string }) => row.id);
};

export const findMatchingLeadPreviewRows = async (where: any, limit: number) =>
  (prisma as any).lead.findMany({
    where,
    take: limit,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      nextFollowUpAt: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
        },
      },
      stage: {
        select: {
          id: true,
          name: true,
        },
      },
      source: {
        select: {
          id: true,
          name: true,
        },
      },
      lifecycle: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

export const bulkAssignLeads = async (input: {
  assignments: Array<{ leadId: string; assignTo: string }>;
  workspaceId: string;
  actorId: string;
  filters: Record<string, unknown>;
  assignmentType: 'SINGLE' | 'ROUND_ROBIN';
  assigneeLabelMap: Record<string, string>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ updatedCount: number; failedLeadIds: string[] }> => {
  const { assignments, workspaceId, actorId, filters, assignmentType, assigneeLabelMap, ipAddress, userAgent } = input;

  if (assignments.length === 0) return { updatedCount: 0, failedLeadIds: [] };

  const result = await prisma.$transaction(async (tx: any) => {
    const activeLeadRows = await (tx as any).lead.findMany({
      where: {
        id: { in: assignments.map((assignment: { leadId: string }) => assignment.leadId) },
        workspaceId,
        deletedAt: null,
        isClosed: false,
        isLOB: false,
      },
      select: { id: true },
    });

    const activeLeadIds = activeLeadRows.map((row: { id: string }) => row.id);
    if (activeLeadIds.length === 0) {
      return {
        updatedCount: 0,
        failedLeadIds: assignments.map((assignment: { leadId: string }) => assignment.leadId),
      };
    }

    const activeLeadIdSet = new Set(activeLeadIds);
    const validAssignments = assignments.filter((assignment: { leadId: string }) => activeLeadIdSet.has(assignment.leadId));
    const failedLeadIds = assignments
      .map((assignment: { leadId: string }) => assignment.leadId)
      .filter((leadId: string) => !activeLeadIdSet.has(leadId));

    if (validAssignments.length === 0) {
      return { updatedCount: 0, failedLeadIds };
    }

    const updatedRows = validAssignments
      .map((assignment: any) => ({
        id: assignment.leadId,
        assignedToId: assignment.assignTo,
      }));

    const groups: Record<string, string[]> = {};
    for (const row of updatedRows) {
      if (!groups[row.assignedToId]) {
        groups[row.assignedToId] = [];
      }
      groups[row.assignedToId].push(row.id);
    }

    for (const [assignToId, leadIds] of Object.entries(groups)) {
      await tx.lead.updateMany({
        where: {
          id: { in: leadIds },
          workspaceId,
          deletedAt: null,
          isClosed: false,
          isLOB: false,
        },
        data: {
          assignedToId: assignToId,
        },
      });

      await tx.followUp.updateMany({
        where: {
          leadId: { in: leadIds },
          workspaceId,
          status: 'PENDING',
        },
        data: {
          userId: assignToId,
        },
      });
    }

    await (tx as any).leadActivity.createMany({
      data: updatedRows.map((row: any) => ({
        leadId: row.id,
        performedById: actorId,
        workspaceId,
        action: 'BULK_ASSIGNED',
        metadata: {
          assignedTo: row.assignedToId,
          assigneeLabel: assigneeLabelMap[row.assignedToId] ?? 'Unknown user',
          bulk: true,
          assignmentType,
        },
      })),
    });

    await (tx as any).auditLog.create({
      data: {
        userId: actorId,
        workspaceId,
        action: 'BULK_ASSIGN',
        entityType: 'Lead',
        details: {
          assignmentType,
          assignedToIds: Array.from(new Set(updatedRows.map((row: any) => row.assignedToId).filter(Boolean))),
          assigneeLabels: assigneeLabelMap,
          totalLeads: updatedRows.length,
          filters,
          leadIds: updatedRows.map((row: any) => row.id),
          failedLeadIds,
        } as any,
        ipAddress,
        userAgent,
      },
    });

    return {
      updatedCount: updatedRows.length,
      failedLeadIds,
    };
  }, {
    maxWait: 15_000,
    timeout: 60_000,
  });

  return result;
};

