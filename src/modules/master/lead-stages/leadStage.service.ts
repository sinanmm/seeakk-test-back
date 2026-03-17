import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import {
  ListLeadStagesResponse,
  LeadStageResponse,
  StageTransitionValidationResult,
} from './leadStage.types';
import {
  CreateLeadStageInput,
  ListLeadStagesQuery,
  ReorderLeadStagesInput,
  UpdateLeadStageInput,
} from './leadStage.validator';

const PIPELINE_CACHE_KEY = 'lead_stages:pipeline';
const PIPELINE_CACHE_TTL_SECONDS = 300;

const clearPipelineCache = async (): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(PIPELINE_CACHE_KEY);
  }
};

const resolveCreatorDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapCreatorNames = async <T extends { createdBy: string | null }>(
  records: T[],
): Promise<Array<Omit<T, 'createdBy'> & { createdBy: string | null; createdById: string | null }>> => {
  const creatorIds = Array.from(
    new Set(records.map((record) => record.createdBy).filter((value): value is string => Boolean(value && value.trim()))),
  );

  if (creatorIds.length === 0) {
    return records.map((record) => ({
      ...record,
      createdById: record.createdBy,
      createdBy: null,
    }));
  }

  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  });

  const creatorMap = new Map<string, string>();
  creators.forEach((creator) => {
    creatorMap.set(creator.id, resolveCreatorDisplayName(creator));
  });

  return records.map((record) => ({
    ...record,
    createdById: record.createdBy,
    createdBy: record.createdBy ? creatorMap.get(record.createdBy) || record.createdBy : null,
  }));
};

const countLeadUsage = async (stageId: string): Promise<number> => {
  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.leads')::text AS table_name
  `;

  const hasLeadsTable = Boolean(tableRows[0]?.table_name);
  if (!hasLeadsTable) return 0;

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
  `;

  const hasCamelColumn = columnRows.some((column) => column.column_name === 'stageId');
  const hasSnakeColumn = columnRows.some((column) => column.column_name === 'stage_id');

  if (!hasCamelColumn && !hasSnakeColumn) return 0;

  const filterColumn = hasCamelColumn ? '"stageId"' : '"stage_id"';
  const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "leads" WHERE ${filterColumn} = $1`,
    stageId,
  );

  return Number(result[0]?.count ?? 0);
};

const normalizeRuleValue = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const remapSingleStage = async (record: any): Promise<LeadStageResponse> => {
  const [mapped] = await mapCreatorNames([record]);
  return mapped as LeadStageResponse;
};

export const createLeadStage = async (
  input: CreateLeadStageInput,
  createdBy?: string,
): Promise<LeadStageResponse> => {
  const duplicate = await prisma.leadStage.findFirst({
    where: {
      deletedAt: null,
      name: { equals: input.name, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (duplicate) {
    const error: any = new Error(`Lead stage "${input.name}" already exists.`);
    error.statusCode = 409;
    throw error;
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.leadStage.updateMany({
      where: {
        deletedAt: null,
        order: { gte: input.order },
      },
      data: {
        order: { increment: 1 },
      },
    });

    const stage = await tx.leadStage.create({
      data: {
        name: input.name,
        color: input.color,
        isApprovalRequired: input.isApprovalRequired,
        isClosed: input.isClosed,
        isLOB: input.isLOB,
        order: input.order,
        status: input.status,
        createdBy,
      },
    });

    if (input.rules.length > 0) {
      await tx.stageRule.createMany({
        data: input.rules.map((rule) => ({
          stageId: stage.id,
          field: rule.field,
          condition: rule.condition,
          value: normalizeRuleValue(rule.value),
          isMandatory: rule.isMandatory,
        })),
      });
    }

    return tx.leadStage.findUniqueOrThrow({
      where: { id: stage.id },
      include: {
        rules: true,
      },
    });
  });

  await clearPipelineCache();
  return remapSingleStage(created);
};

export const listLeadStages = async (query: ListLeadStagesQuery): Promise<ListLeadStagesResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive' as const },
        }
      : {}),
    ...(status ? { status } : {}),
  };

  const [total, records] = await prisma.$transaction([
    prisma.leadStage.count({ where }),
    prisma.leadStage.findMany({
      where,
      include: {
        rules: true,
      },
      skip,
      take: limit,
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    }),
  ]);

  const mappedRecords = await mapCreatorNames(records);

  return {
    data: mappedRecords as LeadStageResponse[],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getPipelineLeadStages = async (): Promise<LeadStageResponse[]> => {
  if (redisClient.isOpen) {
    const cached = await redisClient.get(PIPELINE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as LeadStageResponse[];
    }
  }

  const records = await prisma.leadStage.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
    },
    include: {
      rules: true,
    },
    orderBy: { order: 'asc' },
  });

  const mappedRecords = (await mapCreatorNames(records)) as LeadStageResponse[];

  if (redisClient.isOpen) {
    await redisClient.setEx(PIPELINE_CACHE_KEY, PIPELINE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const updateLeadStage = async (id: string, input: UpdateLeadStageInput): Promise<LeadStageResponse> => {
  const existing = await prisma.leadStage.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead stage not found.');
    error.statusCode = 404;
    throw error;
  }

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await prisma.leadStage.findFirst({
      where: {
        id: { not: id },
        deletedAt: null,
        name: { equals: input.name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (duplicate) {
      const error: any = new Error(`Lead stage "${input.name}" already exists.`);
      error.statusCode = 409;
      throw error;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.order !== undefined && input.order !== existing.order) {
      if (input.order > existing.order) {
        await tx.leadStage.updateMany({
          where: {
            id: { not: id },
            deletedAt: null,
            order: { gt: existing.order, lte: input.order },
          },
          data: {
            order: { decrement: 1 },
          },
        });
      } else {
        await tx.leadStage.updateMany({
          where: {
            id: { not: id },
            deletedAt: null,
            order: { gte: input.order, lt: existing.order },
          },
          data: {
            order: { increment: 1 },
          },
        });
      }
    }

    await tx.leadStage.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.isApprovalRequired !== undefined ? { isApprovalRequired: input.isApprovalRequired } : {}),
        ...(input.isClosed !== undefined ? { isClosed: input.isClosed } : {}),
        ...(input.isLOB !== undefined ? { isLOB: input.isLOB } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    if (input.rules !== undefined) {
      await tx.stageRule.deleteMany({
        where: { stageId: id },
      });

      if (input.rules.length > 0) {
        await tx.stageRule.createMany({
          data: input.rules.map((rule) => ({
            stageId: id,
            field: rule.field,
            condition: rule.condition,
            value: normalizeRuleValue(rule.value),
            isMandatory: rule.isMandatory,
          })),
        });
      }
    }

    return tx.leadStage.findUniqueOrThrow({
      where: { id },
      include: {
        rules: true,
      },
    });
  });

  await clearPipelineCache();
  return remapSingleStage(updated);
};

export const reorderLeadStages = async (input: ReorderLeadStagesInput): Promise<LeadStageResponse[]> => {
  const ids = input.map((item) => item.id);
  const existingCount = await prisma.leadStage.count({
    where: {
      id: { in: ids },
      deletedAt: null,
    },
  });

  if (existingCount !== ids.length) {
    const error: any = new Error('One or more lead stages were not found.');
    error.statusCode = 404;
    throw error;
  }

  await prisma.$transaction(
    input.map((item) =>
      prisma.leadStage.update({
        where: { id: item.id },
        data: { order: item.order },
      }),
    ),
  );

  const records = await prisma.leadStage.findMany({
    where: {
      deletedAt: null,
    },
    include: {
      rules: true,
    },
    orderBy: { order: 'asc' },
  });

  await clearPipelineCache();
  return (await mapCreatorNames(records)) as LeadStageResponse[];
};

export const toggleLeadStageStatus = async (id: string): Promise<LeadStageResponse> => {
  const existing = await prisma.leadStage.findFirst({
    where: {
      id,
      deletedAt: null,
    },
  });

  if (!existing) {
    const error: any = new Error('Lead stage not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const updated = await prisma.leadStage.update({
    where: { id },
    data: { status: nextStatus },
    include: {
      rules: true,
    },
  });

  await clearPipelineCache();
  return remapSingleStage(updated);
};

export const deleteLeadStage = async (id: string): Promise<void> => {
  const existing = await prisma.leadStage.findFirst({
    where: {
      id,
      deletedAt: null,
    },
  });

  if (!existing) {
    const error: any = new Error('Lead stage not found.');
    error.statusCode = 404;
    throw error;
  }

  const usedInLeads = await countLeadUsage(id);
  if (usedInLeads > 0) {
    const error: any = new Error('Stage is used in leads and cannot be deleted.');
    error.statusCode = 400;
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.leadStage.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
    });

    await tx.leadStage.updateMany({
      where: {
        deletedAt: null,
        order: { gt: existing.order },
      },
      data: {
        order: { decrement: 1 },
      },
    });
  });

  await clearPipelineCache();
};

export const validateLeadStageTransition = async (
  targetStageId: string,
  leadData: Record<string, unknown>,
): Promise<StageTransitionValidationResult> => {
  const targetStage = await prisma.leadStage.findFirst({
    where: {
      id: targetStageId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    include: {
      rules: true,
    },
  });

  if (!targetStage) {
    const error: any = new Error('Target lead stage not found or inactive.');
    error.statusCode = 404;
    throw error;
  }

  const missingFields = targetStage.rules
    .filter((rule) => rule.isMandatory || rule.condition.toLowerCase() === 'required')
    .map((rule) => rule.field)
    .filter((field) => {
      const value = leadData[field];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      return false;
    });

  if (missingFields.length > 0) {
    const error: any = new Error(`Required fields missing: ${missingFields.join(', ')}`);
    error.statusCode = 400;
    error.details = { missingFields };
    throw error;
  }

  return {
    isValid: true,
    missingFields: [],
  };
};
