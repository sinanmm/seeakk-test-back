import { Prisma } from '@prisma/client';
import prisma from '../../../config/prisma';

export const extensionReasonSelect = {
  id: true,
  workspaceId: true,
  reasonName: true,
  description: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const ensureExtensionReasonSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT COUNT(*) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'followup_extension_reasons'
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
  (prisma as any).followUpExtensionReason.findFirst({
    where: {
      workspaceId,
      reasonName: {
        equals: name,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const findById = async (workspaceId: string, id: string) =>
  (prisma as any).followUpExtensionReason.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: extensionReasonSelect,
  });

export const findActiveById = async (workspaceId: string, id: string) =>
  (prisma as any).followUpExtensionReason.findFirst({
    where: {
      id,
      workspaceId,
      isActive: true,
    },
    select: {
      id: true,
      reasonName: true,
      isActive: true,
    },
  });

export const listExtensionReasons = async (where: any, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    (prisma as any).followUpExtensionReason.findMany({
      where,
      skip,
      take,
      orderBy: [{ sortOrder: 'asc' }, { reasonName: 'asc' }],
      select: extensionReasonSelect,
    }),
    (prisma as any).followUpExtensionReason.count({ where }),
  ]);

  return { rows, total };
};

export const listActiveExtensionReasonOptions = async (workspaceId: string) =>
  (prisma as any).followUpExtensionReason.findMany({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { reasonName: 'asc' }],
    select: {
      id: true,
      reasonName: true,
      isActive: true,
      sortOrder: true,
    },
  });

export const createExtensionReason = async (data: any) =>
  (prisma as any).followUpExtensionReason.create({
    data,
    select: extensionReasonSelect,
  });

export const updateExtensionReason = async (id: string, data: any) =>
  (prisma as any).followUpExtensionReason.update({
    where: { id },
    data,
    select: extensionReasonSelect,
  });

export const deleteExtensionReason = async (id: string) =>
  (prisma as any).followUpExtensionReason.delete({
    where: { id },
    select: extensionReasonSelect,
  });

