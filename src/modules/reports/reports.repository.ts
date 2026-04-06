import { Prisma } from '../../../prisma/generated/client';
import prisma from '../../config/prisma';
import { reportTypeSelect } from './reportTypes.repository';

export const findReportTypeById = async (workspaceId: string, id: string) =>
  prisma.reportType.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: reportTypeSelect,
  });

export const createReportLog = async (data: {
  workspaceId: string;
  reportTypeId: string;
  generatedById?: string | null;
  filters: Prisma.InputJsonValue;
  resultCount: number;
}) =>
  prisma.reportLog.create({
    data,
  });

export const listReportLogs = async (
  where: {
    workspaceId: string;
    reportTypeId?: string;
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
  });

export const countReportLogs = async (where: {
  workspaceId: string;
  reportTypeId?: string;
  generatedById?: string;
  createdAt?: { gte?: Date; lte?: Date };
}) => prisma.reportLog.count({ where });
