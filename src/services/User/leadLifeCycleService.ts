import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import type {
  CreateLeadLifeCycleInput,
  ListLeadLifeCyclesQuery,
  UpdateLeadLifeCycleInput,
} from '../../validations/leadLifeCycleValidation';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const createValidationError = (
  message: string,
  context?: Record<string, unknown>,
): Error & { statusCode: number } => {
  logger.warn('Validation issue', { module: 'lead-life-cycle', ...(context || {}), message });
  return createServiceError(message, 422);
};

type LifecycleTransitionInput = CreateLeadLifeCycleInput['transitions'][number];

const resolveCreatorDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapLifecycleCreatorNames = async <
  T extends {
    createdBy: string | null;
  },
>(
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

const mapSingleLifecycleCreatorName = async <T extends { createdBy: string | null }>(
  record: T,
): Promise<Omit<T, 'createdBy'> & { createdBy: string | null; createdById: string | null }> => {
  const [mapped] = await mapLifecycleCreatorNames([record]);
  return mapped;
};

const hasGeneratedDelegates = (): boolean => {
  const lifeCycle = (prisma as any).leadLifeCycle;
  const transition = (prisma as any).leadLifeCycleTransition;

  return Boolean(
    lifeCycle?.findFirst &&
      lifeCycle?.findMany &&
      lifeCycle?.create &&
      transition?.createMany,
  );
};

const assertSchemaReady = async (): Promise<void> => {
  const lifeCycleTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'lead_life_cycles'
  `;

  const transitionTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'lead_life_cycle_transitions'
  `;

  if (!lifeCycleTable[0]?.table_name || !transitionTable[0]?.table_name) {
    throw createServiceError(
      'Lead Life Cycle DB schema is missing. Run Prisma migration/db push and restart backend.',
      503,
    );
  }

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Lead Life Cycle module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const normalizeTransitions = (transitions: LifecycleTransitionInput[]): Array<{
  fromStageId: string;
  toStageId: string;
  numberOfDays: number;
  expiryAction: 'AUTO_LOB' | 'WARN_AND_CHOOSE';
  warningDays: number;
  sortOrder: number;
}> => {
  if (transitions.length === 0) {
    throw createValidationError('At least one transition is required.');
  }

  const providedSortOrders = new Set<number>();
  for (const transition of transitions) {
    if (transition.sortOrder !== undefined) {
      if (providedSortOrders.has(transition.sortOrder)) {
        throw createValidationError(`Duplicate sortOrder ${transition.sortOrder} is not allowed.`, {
          sortOrder: transition.sortOrder,
        });
      }
      providedSortOrders.add(transition.sortOrder);
    }
  }

  let nextSortOrder = 1;
  const seenTransitions = new Set<string>();

  return transitions.map((transition) => {
    const fromStageId = transition.fromStageId.trim();
    const toStageId = transition.toStageId.trim();

    if (fromStageId === toStageId) {
      throw createValidationError('fromStageId and toStageId cannot be the same.', {
        fromStageId,
        toStageId,
      });
    }

    if (transition.numberOfDays <= 0) {
      throw createValidationError('numberOfDays must be greater than 0.', {
        fromStageId,
        toStageId,
      });
    }

    const pairKey = `${fromStageId}::${toStageId}`;
    if (seenTransitions.has(pairKey)) {
      throw createValidationError(
        `Duplicate transition from stage ${fromStageId} to ${toStageId} is not allowed.`,
      );
    }
    seenTransitions.add(pairKey);

    let sortOrder = transition.sortOrder;
    if (sortOrder === undefined) {
      while (providedSortOrders.has(nextSortOrder)) {
        nextSortOrder += 1;
      }
      sortOrder = nextSortOrder;
      providedSortOrders.add(sortOrder);
      nextSortOrder += 1;
    }

    return {
      fromStageId,
      toStageId,
      numberOfDays: transition.numberOfDays,
      expiryAction: transition.expiryAction,
      warningDays: transition.warningDays,
      sortOrder,
    };
  });
};

const ensureUniqueLifecycleName = async (
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> => {
  const existing = await (prisma as any).leadLifeCycle.findFirst({
    where: {
      workspaceId,
      name: { equals: name},
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw createServiceError(`Lead life cycle "${name}" already exists in this workspace.`, 409);
  }
};

const ensureStagesExist = async (stageIds: string[]): Promise<void> => {
  const uniqueStageIds = Array.from(new Set(stageIds));

  const rows = await prisma.leadStage.findMany({
    where: {
      id: { in: uniqueStageIds },
      deletedAt: null,
    },
    select: { id: true },
  });

  if (rows.length !== uniqueStageIds.length) {
    throw createValidationError('One or more stage ids are invalid.', { stageIds: uniqueStageIds });
  }
};

const countLifecycleUsage = async (workspaceId: string, lifecycleId: string): Promise<number> => {
  const leadDelegate = (prisma as any).lead;

  if (leadDelegate?.count) {
    return leadDelegate.count({
      where: {
        workspaceId,
        lifecycleId,
        deletedAt: null,
      },
    });
  }

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  if (!tableRows[0]?.table_name) return 0;

  const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count
     FROM leads
     WHERE workspaceId = ?
       AND lifecycleId = ?
       AND deletedAt IS NULL`,
    workspaceId,
    lifecycleId,
  );

  return Number(result[0]?.count || 0);
};

export const getLeadStageOptions = async () => {
  const rows = await prisma.leadStage.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      color: true,
      order: true,
    },
  });

  logger.info('Lead stage options fetched for lifecycle dropdown', {
    module: 'lead-life-cycle',
    count: rows.length,
  });

  return rows;
};

export const createLifeCycle = async (
  workspaceId: string,
  input: CreateLeadLifeCycleInput,
  createdBy?: string,
) => {
  await assertSchemaReady();

  const name = input.name.trim();
  if (!name) {
    throw createValidationError('Lifecycle name is required.');
  }

  await ensureUniqueLifecycleName(workspaceId, name);

  const transitions = normalizeTransitions(input.transitions);
  await ensureStagesExist(
    transitions.flatMap((transition) => [transition.fromStageId, transition.toStageId]),
  );

  const lifeCycle = await prisma.$transaction(async (tx: any) => {
    if (input.isDefault) {
      await (tx as any).leadLifeCycle.updateMany({
        where: { workspaceId },
        data: { isDefault: false },
      });
    }

    const created = await (tx as any).leadLifeCycle.create({
      data: {
        name,
        workspaceId,
        isDefault: input.isDefault,
        createdBy: createdBy ?? null,
      },
    });

    await (tx as any).leadLifeCycleTransition.createMany({
      data: transitions.map((transition) => ({
        lifecycleId: created.id,
        fromStageId: transition.fromStageId,
        toStageId: transition.toStageId,
        numberOfDays: transition.numberOfDays,
        expiryAction: transition.expiryAction,
        warningDays: transition.warningDays,
        sortOrder: transition.sortOrder,
        workspaceId,
      })),
    });

    return (tx as any).leadLifeCycle.findUnique({
      where: { id: created.id },
      include: {
        transitions: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  });

  if (!lifeCycle) {
    throw createServiceError('Failed to create lead life cycle.', 500);
  }

  logger.info('Lifecycle created', {
    lifecycleId: lifeCycle.id,
    workspaceId,
    isDefault: lifeCycle.isDefault,
  });

  return mapSingleLifecycleCreatorName(lifeCycle);
};

export const listLifeCycles = async (workspaceId: string, query: ListLeadLifeCyclesQuery) => {
  await assertSchemaReady();

  const { page, limit, search } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(search
      ? {
          name: { contains: search},
        }
      : {}),
  };

  const [total, lifeCycles] = await prisma.$transaction([
    (prisma as any).leadLifeCycle.count({ where }),
    (prisma as any).leadLifeCycle.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        transitions: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    }),
  ]);

  const mappedLifeCycles = await mapLifecycleCreatorNames(lifeCycles);

  return {
    lifeCycles: mappedLifeCycles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getLifeCycleById = async (id: string, workspaceId: string) => {
  await assertSchemaReady();

  const lifeCycle = await (prisma as any).leadLifeCycle.findFirst({
    where: {
      id,
      workspaceId,
    },
    include: {
      transitions: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!lifeCycle) {
    throw createServiceError('Lead life cycle not found in this workspace.', 404);
  }

  return mapSingleLifecycleCreatorName(lifeCycle);
};

export const updateLifeCycle = async (
  id: string,
  workspaceId: string,
  input: UpdateLeadLifeCycleInput,
) => {
  await assertSchemaReady();

  const existing = await (prisma as any).leadLifeCycle.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  });

  if (!existing) {
    throw createServiceError('Lead life cycle not found in this workspace.', 404);
  }

  const name = input.name.trim();
  if (!name) {
    throw createValidationError('Lifecycle name is required.');
  }

  await ensureUniqueLifecycleName(workspaceId, name, id);

  const transitions = normalizeTransitions(input.transitions);
  await ensureStagesExist(
    transitions.flatMap((transition) => [transition.fromStageId, transition.toStageId]),
  );

  const updated = await prisma.$transaction(async (tx: any) => {
    if (input.isDefault) {
      await (tx as any).leadLifeCycle.updateMany({
        where: { workspaceId },
        data: { isDefault: false },
      });
    }

    await (tx as any).leadLifeCycle.update({
      where: { id },
      data: {
        name,
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });

    await (tx as any).leadLifeCycleTransition.deleteMany({
      where: { lifecycleId: id, workspaceId },
    });

    await (tx as any).leadLifeCycleTransition.createMany({
      data: transitions.map((transition) => ({
        lifecycleId: id,
        fromStageId: transition.fromStageId,
        toStageId: transition.toStageId,
        numberOfDays: transition.numberOfDays,
        expiryAction: transition.expiryAction,
        warningDays: transition.warningDays,
        sortOrder: transition.sortOrder,
        workspaceId,
      })),
    });

    return (tx as any).leadLifeCycle.findUnique({
      where: { id },
      include: {
        transitions: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  });

  if (!updated) {
    throw createServiceError('Lead life cycle not found in this workspace.', 404);
  }

  logger.info('Lifecycle updated', {
    lifecycleId: id,
    workspaceId,
    isDefault: updated.isDefault,
    updatedFields: Object.keys(input),
  });

  return mapSingleLifecycleCreatorName(updated);
};

export const deleteLifeCycle = async (id: string, workspaceId: string) => {
  await assertSchemaReady();

  const existing = await (prisma as any).leadLifeCycle.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: { id: true },
  });

  if (!existing) {
    throw createServiceError('Lead life cycle not found in this workspace.', 404);
  }

  const usageCount = await countLifecycleUsage(workspaceId, id);
  if (usageCount > 0) {
    logger.warn('Validation issue', {
      lifecycleId: id,
      workspaceId,
      reason: 'Lifecycle in use by leads',
      usageCount,
    });
    throw createServiceError('Lead life cycle is used in leads and cannot be deleted.', 400);
  }

  await (prisma as any).leadLifeCycle.delete({
    where: { id },
  });

  logger.info('Lifecycle deleted', {
    lifecycleId: id,
    workspaceId,
  });
};

