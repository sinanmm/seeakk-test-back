import { LeadClosureType } from '../../../prisma/generated/client';
import prisma from '../../config/prisma';

export const closedLeadSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  expectedRevenue: true,
  generatedRevenue: true,
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
      COUNT(*) FILTER (WHERE column_name = 'generatedRevenue') > 0
      AND COUNT(*) FILTER (WHERE column_name = 'closedAt') > 0
      AND COUNT(*) FILTER (WHERE column_name = 'closedById') > 0
      AND COUNT(*) FILTER (WHERE column_name = 'closureType') > 0 AS has_required_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
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
