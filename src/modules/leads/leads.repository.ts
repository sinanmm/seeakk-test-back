import { LeadClosureType } from '@prisma/client';
import prisma from '../../config/prisma';

export const closedLeadSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  companyName: true,
  address: true,
  expectedRevenue: true,
  generatedRevenue: true,
  earnedRevenue: true,
  revenueApprovedById: true,
  revenueApprovedAt: true,
  assignedToId: true,
  stageId: true,
  lifecycleId: true,
  sourceId: true,
  workspaceId: true,
  createdById: true,
  isClosed: true,
  isLOB: true,
  closedAt: true,
  closedById: true,
  closureType: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      isActive: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  closedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  source: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  stage: {
    select: {
      id: true,
      name: true,
      color: true,
      isClosed: true,
      isLOB: true,
    },
  },
  lifecycle: {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  },
} as const;

export type ClosedLeadRecord = Awaited<ReturnType<typeof findLeadById>>;

export const ensureClosedLeadSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ has_required_columns: boolean }>>`
    SELECT
      SUM(CASE WHEN column_name = 'generatedRevenue' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN column_name = 'closedAt' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN column_name = 'closedById' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN column_name = 'closureType' THEN 1 ELSE 0 END) > 0 AS has_required_columns
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'leads'
  `;

  return Boolean(rows[0]?.has_required_columns);
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

  return rows.map((row) => row.id);
};

/** All users in the reporting tree under `rootSupervisorId` (direct and indirect reports). */
export const getRecursiveTeamUserIds = async (
  workspaceId: string,
  rootSupervisorId: string,
): Promise<string[]> => {
  const collected = new Set<string>();
  let frontier = [rootSupervisorId];

  while (frontier.length > 0) {
    const rows = await prisma.user.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        supervisorId: { in: frontier },
      },
      select: { id: true },
    });

    const next: string[] = [];
    for (const row of rows) {
      if (!collected.has(row.id)) {
        collected.add(row.id);
        next.push(row.id);
      }
    }
    frontier = next;
  }

  return Array.from(collected);
};

export const findLeadById = async (workspaceId: string, id: string) =>
  (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: closedLeadSelect,
  });

export const listClosedLeads = async (where: any, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    (prisma as any).lead.findMany({
      where,
      skip,
      take,
      orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }],
      select: closedLeadSelect,
    }),
    (prisma as any).lead.count({ where }),
  ]);

  return { rows, total };
};

export const reconcileClosedLeadFlags = async (workspaceId: string): Promise<number> => {
  await (prisma as any).lead.updateMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [{ isLOB: true }, { stage: { is: { isLOB: true } } }],
    },
    data: {
      isLOB: true,
      isClosed: false,
    },
  });

  const staleClosedLeads = await (prisma as any).lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      isLOB: false,
      isClosed: false,
      stage: {
        is: {
          isClosed: true,
          isLOB: false,
        },
      },
    },
    select: {
      id: true,
      updatedAt: true,
      createdById: true,
      closedAt: true,
      closedById: true,
    },
  });

  if (staleClosedLeads.length === 0) {
    return 0;
  }

  await prisma.$transaction(
    staleClosedLeads.map((lead: any) =>
      (prisma as any).lead.update({
        where: { id: lead.id },
        data: {
          isClosed: true,
          closedAt: lead.closedAt || lead.updatedAt || new Date(),
          closedById: lead.closedById || lead.createdById || null,
        },
      }),
    ),
  );

  return staleClosedLeads.length;
};

export const exportClosedLeads = async (where: any) =>
  (prisma as any).lead.findMany({
    where,
    orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }],
    select: closedLeadSelect,
  });

export const updateLeadClosure = async (
  id: string,
  data: {
    isClosed?: boolean;
    isLOB?: boolean;
    closedAt?: Date | null;
    closedById?: string | null;
    generatedRevenue?: number;
    closureType?: LeadClosureType | null;
  },
) =>
  (prisma as any).lead.update({
    where: { id },
    data,
    select: closedLeadSelect,
  });

