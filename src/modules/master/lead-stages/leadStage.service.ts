import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import { Prisma } from '@prisma/client';
import {
  ListLeadStagesResponse,
  LeadStageResponse,
  StageTransitionValidationResult,
} from './leadStage.types';
import { validateLeadStageTransitionInputs } from '../stage-rules/stageRule.service';
import {
  CreateLeadStageInput,
  ListLeadStagesQuery,
  ReorderLeadStagesInput,
  UpdateLeadStageInput,
} from './leadStage.validator';

const PIPELINE_CACHE_TTL_SECONDS = 300;
const getPipelineCacheKey = (workspaceId: string): string => `lead_stages:pipeline:${workspaceId}`;
const leadStageDelegate = (prisma as any).leadStage;
const stageRuleDelegate = (prisma as any).stageRule;

const clearPipelineCache = async (workspaceId: string): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(getPipelineCacheKey(workspaceId));
  }
};

const STAGE_RULE_SAFE_SELECT = {
  id: true,
  name: true,
  inputType: true,
  sortOrder: true,
  required: true,
  status: true,
  stageId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const LEAD_STAGE_WITH_RULES_INCLUDE = {
  rules: {
    select: STAGE_RULE_SAFE_SELECT,
  },
} as const;

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

const countLeadUsage = async (stageId: string): Promise<number> =>
  (prisma as any).lead.count({
    where: {
      stageId,
      deletedAt: null,
    },
  });

const remapSingleStage = async (record: any): Promise<LeadStageResponse> => {
  const [mapped] = await mapCreatorNames([record]);
  return mapped as LeadStageResponse;
};

const assertRuleAssignmentsIfProvided = async (
  workspaceId: string,
  ruleAssignments?: Array<{ ruleId: string; required: boolean }>,
): Promise<void> => {
  if (!ruleAssignments || ruleAssignments.length === 0) return;

  const uniqueRuleIds = Array.from(new Set(ruleAssignments.map((rule) => rule.ruleId)));
  const rules = await stageRuleDelegate.findMany({
    where: {
      workspaceId,
      id: { in: uniqueRuleIds },
      deletedAt: null,
    },
    select: { id: true },
  });

  if (rules.length !== uniqueRuleIds.length) {
    const error: any = new Error('One or more stage rules were not found.');
    error.statusCode = 404;
    throw error;
  }
};

const applyStageRuleAssignments = async (
  tx: Prisma.TransactionClient,
  stageId: string,
  ruleAssignments: Array<{ ruleId: string; required: boolean }>,
): Promise<void> => {
  await Promise.all(
    ruleAssignments.map((ruleAssignment) =>
      tx.stageRule.updateMany({
        where: { id: ruleAssignment.ruleId },
        data: {
          stageId,
          required: ruleAssignment.required,
        },
      }),
    ),
  );
};

export const createLeadStage = async (
  workspaceId: string,
  input: CreateLeadStageInput,
  createdBy?: string,
): Promise<LeadStageResponse> => {
  const normalizedInput = {
    ...input,
  };

  const duplicate = await leadStageDelegate.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      name: { equals: normalizedInput.name, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (duplicate) {
    const error: any = new Error(`Lead stage "${normalizedInput.name}" already exists.`);
    error.statusCode = 409;
    throw error;
  }

  await assertRuleAssignmentsIfProvided(workspaceId, normalizedInput.ruleAssignments);

  const created = await prisma.$transaction(
    async (tx: any) => {
      await tx.leadStage.updateMany({
        where: {
          workspaceId,
          deletedAt: null,
          order: { gte: normalizedInput.order },
        },
        data: {
          order: { increment: 1 },
        },
      });

      const stage = await tx.leadStage.create({
        data: {
          name: normalizedInput.name,
          workspaceId,
          color: normalizedInput.color,
          isApprovalRequired: normalizedInput.isApprovalRequired,
          isClosed: normalizedInput.isClosed,
          isLOB: normalizedInput.isLOB,
          order: normalizedInput.order,
          status: normalizedInput.status,
          createdBy,
        },
        include: LEAD_STAGE_WITH_RULES_INCLUDE,
      });

      if (normalizedInput.ruleAssignments && normalizedInput.ruleAssignments.length > 0) {
        await applyStageRuleAssignments(tx, stage.id, normalizedInput.ruleAssignments);
      }

      return tx.leadStage.findUniqueOrThrow({
        where: { id: stage.id },
        include: LEAD_STAGE_WITH_RULES_INCLUDE,
      });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );

  await clearPipelineCache(workspaceId);
  return remapSingleStage(created);
};

export const listLeadStages = async (
  workspaceId: string,
  query: ListLeadStagesQuery,
): Promise<ListLeadStagesResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    deletedAt: null,
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive' as const },
        }
      : {}),
    ...(status ? { status } : {}),
  };

  const [total, records] = await prisma.$transaction([
    leadStageDelegate.count({ where }),
    leadStageDelegate.findMany({
      where,
      include: LEAD_STAGE_WITH_RULES_INCLUDE,
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

export const getPipelineLeadStages = async (workspaceId: string): Promise<LeadStageResponse[]> => {
  if (redisClient.isOpen) {
    const cached = await redisClient.get(getPipelineCacheKey(workspaceId));
    if (cached) {
      return JSON.parse(cached) as LeadStageResponse[];
    }
  }

  const records = await leadStageDelegate.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    include: LEAD_STAGE_WITH_RULES_INCLUDE,
    orderBy: { order: 'asc' },
  });

  const mappedRecords = (await mapCreatorNames(records)) as LeadStageResponse[];

  if (redisClient.isOpen) {
    await redisClient.setEx(getPipelineCacheKey(workspaceId), PIPELINE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const updateLeadStage = async (
  workspaceId: string,
  id: string,
  input: UpdateLeadStageInput,
): Promise<LeadStageResponse> => {
  const existing = await leadStageDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      rules: {
        select: { id: true },
      },
    },
  });

  if (!existing) {
    const error: any = new Error('Lead stage not found.');
    error.statusCode = 404;
    throw error;
  }

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await leadStageDelegate.findFirst({
      where: {
        workspaceId,
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

  if (input.ruleAssignments !== undefined) {
    await assertRuleAssignmentsIfProvided(workspaceId, input.ruleAssignments);
  }

  const normalizedInput = {
    ...input,
  };

  const updated = await prisma.$transaction(
    async (tx: any) => {
      if (normalizedInput.order !== undefined && normalizedInput.order !== existing.order) {
        if (normalizedInput.order > existing.order) {
          await tx.leadStage.updateMany({
            where: {
              workspaceId,
              id: { not: id },
              deletedAt: null,
              order: { gt: existing.order, lte: normalizedInput.order },
            },
            data: {
              order: { decrement: 1 },
            },
          });
        } else {
          await tx.leadStage.updateMany({
            where: {
              workspaceId,
              id: { not: id },
              deletedAt: null,
              order: { gte: normalizedInput.order, lt: existing.order },
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
          ...(normalizedInput.name !== undefined ? { name: normalizedInput.name } : {}),
          ...(normalizedInput.color !== undefined ? { color: normalizedInput.color } : {}),
          ...(normalizedInput.isApprovalRequired !== undefined ? { isApprovalRequired: normalizedInput.isApprovalRequired } : {}),
          ...(normalizedInput.isClosed !== undefined ? { isClosed: normalizedInput.isClosed } : {}),
          ...(normalizedInput.isLOB !== undefined ? { isLOB: normalizedInput.isLOB } : {}),
          ...(normalizedInput.order !== undefined ? { order: normalizedInput.order } : {}),
          ...(normalizedInput.status !== undefined ? { status: normalizedInput.status } : {}),
        },
        include: LEAD_STAGE_WITH_RULES_INCLUDE,
      });

      if (normalizedInput.ruleAssignments !== undefined) {
        await tx.stageRule.updateMany({
        where: {
          workspaceId,
          stageId: id,
          id: { notIn: normalizedInput.ruleAssignments.map((rule) => rule.ruleId) },
          },
          data: { stageId: null },
        });

        if (normalizedInput.ruleAssignments.length > 0) {
          await applyStageRuleAssignments(tx, id, normalizedInput.ruleAssignments);
        }
      }

      return tx.leadStage.findUniqueOrThrow({
        where: { id },
        include: LEAD_STAGE_WITH_RULES_INCLUDE,
      });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );

  await clearPipelineCache(workspaceId);
  return remapSingleStage(updated);
};

export const reorderLeadStages = async (
  workspaceId: string,
  input: ReorderLeadStagesInput,
): Promise<LeadStageResponse[]> => {
  const ids = input.map((item) => item.id);
  const existingCount = await leadStageDelegate.count({
    where: {
      workspaceId,
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
      leadStageDelegate.update({
        where: { id: item.id },
        data: { order: item.order },
      }),
    ),
  );

  const records = await leadStageDelegate.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: LEAD_STAGE_WITH_RULES_INCLUDE,
    orderBy: { order: 'asc' },
  });

  await clearPipelineCache(workspaceId);
  return (await mapCreatorNames(records)) as LeadStageResponse[];
};

export const toggleLeadStageStatus = async (workspaceId: string, id: string): Promise<LeadStageResponse> => {
  const existing = await leadStageDelegate.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!existing) {
    const error: any = new Error('Lead stage not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const updated = await leadStageDelegate.update({
    where: { id },
    data: { status: nextStatus },
    include: LEAD_STAGE_WITH_RULES_INCLUDE,
  });

  await clearPipelineCache(workspaceId);
  return remapSingleStage(updated);
};

export const deleteLeadStage = async (workspaceId: string, id: string): Promise<void> => {
  const existing = await leadStageDelegate.findFirst({
    where: {
      id,
      workspaceId,
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

  await prisma.$transaction(async (tx: any) => {
    await tx.leadStage.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
    });

    await tx.leadStage.updateMany({
      where: {
        workspaceId,
        deletedAt: null,
        order: { gt: existing.order },
      },
      data: {
        order: { decrement: 1 },
      },
    });
  });

  await clearPipelineCache(workspaceId);
};

export const validateLeadStageTransition = async (
  workspaceId: string,
  targetStageId: string,
  leadData: Record<string, unknown>,
): Promise<StageTransitionValidationResult> => {
  const targetStage = await leadStageDelegate.findFirst({
    where: {
      id: targetStageId,
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  if (!targetStage) {
    const error: any = new Error('Target lead stage not found or inactive.');
    error.statusCode = 404;
    throw error;
  }

  return validateLeadStageTransitionInputs(workspaceId, targetStageId, leadData);
};
