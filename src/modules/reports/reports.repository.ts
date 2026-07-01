import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { reportTypeSelect } from './reportTypes.repository';

export const reportSelect = Prisma.validator<Prisma.ReportSelect>()({
  id: true,
  workspaceId: true,
  reportName: true,
  reportTypeId: true,
  reportDate: true,
  isActive: true,
  isGenerated: true,
  generatedFileUrl: true,
  generatedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  reportType: {
    select: {
      id: true,
      name: true,
      module: true,
      baseDataSource: true,
      baseDataSources: true,
      modules: true,
      status: true,
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
  filters: {
    select: {
      id: true,
      filterKey: true,
      filterValue: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
});

export const ensureReportInstanceSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      SUM(CASE WHEN table_name = 'reports' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN table_name = 'report_filters' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN table_name = 'report_logs' THEN 1 ELSE 0 END) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('reports', 'report_filters', 'report_logs')
  `;

  return Boolean(rows[0]?.ready);
};

export const findReportTypeById = async (workspaceId: string, id: string) =>
  prisma.reportType.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: reportTypeSelect,
  });

export const createReportLog = async (data: Prisma.ReportLogUncheckedCreateInput) =>
  prisma.reportLog.create({
    data,
  });

export const listReportLogs = async (
  where: {
    workspaceId: string;
    reportTypeId?: string;
    reportId?: string;
    generatedById?: string;
    createdAt?: { gte?: Date; lte?: Date };
  },
  skip: number,
  take: number,
) =>
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
      baseDataSources: true,
      modules: true,
          status: true,
        },
      },
      report: {
        select: {
          id: true,
          reportName: true,
          reportDate: true,
          isGenerated: true,
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
  });

export const countReportLogs = async (where: {
  workspaceId: string;
  reportTypeId?: string;
  reportId?: string;
  generatedById?: string;
  createdAt?: { gte?: Date; lte?: Date };
}) => prisma.reportLog.count({ where });

export const executeDynamicQuery = async <T = Record<string, unknown>>(query: Prisma.Sql): Promise<T[]> =>
  prisma.$queryRaw<T[]>(query);

export const createReport = async (data: Prisma.ReportUncheckedCreateInput, filters: Array<{ filterKey: string; filterValue: string }>) =>
  prisma.$transaction(async (tx: any) => {
    const report = await tx.report.create({
      data,
      select: reportSelect,
    });

    if (filters.length > 0) {
      await tx.reportFilter.createMany({
        data: filters.map((filter) => ({
          reportId: report.id,
          filterKey: filter.filterKey,
          filterValue: filter.filterValue,
        })),
      });
    }

    return tx.report.findUniqueOrThrow({
      where: { id: report.id },
      select: reportSelect,
    });
  });

export const listReports = async (where: Prisma.ReportWhereInput, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    prisma.report.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      select: reportSelect,
    }),
    prisma.report.count({ where }),
  ]);

  return { rows, total };
};

export const findReportById = async (workspaceId: string, id: string) =>
  prisma.report.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: reportSelect,
  });

export const updateReport = async (id: string, data: Prisma.ReportUncheckedUpdateInput) =>
  prisma.report.update({
    where: { id },
    data,
    select: reportSelect,
  });

export const replaceReportDefinition = async (
  id: string,
  data: Prisma.ReportUncheckedUpdateInput,
  filters: Array<{ filterKey: string; filterValue: string }>,
) =>
  prisma.$transaction(async (tx: any) => {
    await tx.report.update({
      where: { id },
      data,
    });

    await tx.reportFilter.deleteMany({
      where: { reportId: id },
    });

    if (filters.length > 0) {
      await tx.reportFilter.createMany({
        data: filters.map((filter) => ({
          reportId: id,
          filterKey: filter.filterKey,
          filterValue: filter.filterValue,
        })),
      });
    }

    return tx.report.findUniqueOrThrow({
      where: { id },
      select: reportSelect,
    });
  });
