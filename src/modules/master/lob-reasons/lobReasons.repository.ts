import { LOBReasonStatus, Prisma } from '@prisma/client';
import prisma from '../../../config/prisma';

export const lobReasonSelect = {
  id: true,
  workspaceId: true,
  name: true,
  status: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  updatedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
} as const;

export const ensureLOBReasonSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT COUNT(*) FILTER (WHERE table_name = 'lob_reasons') > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('lob_reasons')
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

export const findByName = async (workspaceId: string, name: string, excludeId?: string) =>
  prisma.lOBReason.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      name: {
        equals: name,
        mode: 'insensitive',
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const findById = async (workspaceId: string, id: string) =>
  prisma.lOBReason.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: lobReasonSelect,
  });

export const findActiveById = async (workspaceId: string, id: string) =>
  prisma.lOBReason.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
      status: LOBReasonStatus.ACTIVE,
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

export const listLOBReasons = async (where: Prisma.LOBReasonWhereInput, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    prisma.lOBReason.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      select: lobReasonSelect,
    }),
    prisma.lOBReason.count({ where }),
  ]);

  return { rows, total };
};

export const listActiveLOBReasonOptions = async (workspaceId: string) =>
  prisma.lOBReason.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: LOBReasonStatus.ACTIVE,
    },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

export const createLOBReason = async (data: Prisma.LOBReasonUncheckedCreateInput) =>
  prisma.lOBReason.create({
    data,
    select: lobReasonSelect,
  });

export const updateLOBReason = async (id: string, data: Prisma.LOBReasonUncheckedUpdateInput) =>
  prisma.lOBReason.update({
    where: { id },
    data,
    select: lobReasonSelect,
  });

export const softDeleteLOBReason = async (id: string, updatedById?: string | null) =>
  prisma.lOBReason.update({
    where: { id },
    data: {
      status: LOBReasonStatus.INACTIVE,
      deletedAt: new Date(),
      updatedById: updatedById ?? null,
    },
    select: lobReasonSelect,
  });

export const countActiveLeadUsage = async (workspaceId: string, reasonId: string): Promise<number> =>
  prisma.leadLOBLog.count({
    where: {
      workspaceId,
      reasonId,
      lead: {
        workspaceId,
        deletedAt: null,
      },
    },
  });
