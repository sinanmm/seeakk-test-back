import { Prisma, ReportTypeStatus } from '@prisma/client';
import prisma from '../../config/prisma';
import {
  ensureReportTypeSchemaColumns,
  getMissingReportTypeColumns,
} from './reportTypeSchemaGuard';

export const reportTypeSelect = {
  id: true,
  workspaceId: true,
  name: true,
  module: true,
  modules: true,
  baseDataSource: true,
  baseDataSources: true,
  description: true,
  allowedFilters: true,
  status: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: true,
  categories: true,
  trackModules: true,
  enableUserFilter: true,
  enableDateFilter: true,
  trackActivityTypes: true,
  allowExport: true,
  showSummary: true,
  showDetailedLogs: true,
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

export const ensureReportSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      SUM(CASE WHEN table_name = 'report_types' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN table_name = 'report_logs' THEN 1 ELSE 0 END) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('report_types', 'report_logs')
  `;

  if (!rows[0]?.ready) {
    return false;
  }

  await ensureReportTypeSchemaColumns();

  const missingColumns = await getMissingReportTypeColumns();
  return missingColumns.length === 0;
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
  prisma.reportType.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      name: {
        equals: name,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const createReportType = async (data: Prisma.ReportTypeUncheckedCreateInput) =>
  prisma.reportType.create({
    data,
    select: reportTypeSelect,
  });

export const findById = async (workspaceId: string, id: string) =>
  prisma.reportType.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: reportTypeSelect,
  });

export const listReportTypes = async (where: Prisma.ReportTypeWhereInput, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    prisma.reportType.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      select: reportTypeSelect,
    }),
    prisma.reportType.count({ where }),
  ]);

  return { rows, total };
};

export const updateReportType = async (id: string, data: Prisma.ReportTypeUncheckedUpdateInput) =>
  prisma.reportType.update({
    where: { id },
    data,
    select: reportTypeSelect,
  });

export const softDeleteReportType = async (id: string, updatedById?: string | null) =>
  prisma.reportType.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      status: ReportTypeStatus.INACTIVE,
      updatedById: updatedById ?? null,
    },
    select: reportTypeSelect,
  });

export const createReportLog = async (data: Prisma.ReportLogUncheckedCreateInput) =>
  prisma.reportLog.create({ data });

export const listReportLogs = async (where: Prisma.ReportLogWhereInput, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    prisma.reportLog.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        reportType: {
          select: {
            id: true,
            name: true,
            module: true,
            baseDataSource: true,
            status: true,
          },
        },
        generatedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    }),
    prisma.reportLog.count({ where }),
  ]);

  return { rows, total };
};

export const executeDynamicQuery = async <T = Record<string, unknown>>(query: Prisma.Sql): Promise<T[]> =>
  prisma.$queryRaw<T[]>(query);
