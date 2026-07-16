import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import {
  CreateTargetCycleInput,
  ListTargetCyclesQuery,
  UpdateTargetCycleInput,
} from './targetCycle.validation';
import { ListTargetCyclesResponse, TargetCycleResponse } from './targetCycle.types';

const getCacheKey = (workspaceId: string): string => `target_cycles_${workspaceId}`;

type QueryExecutor = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

type CycleRow = {
  id: string;
  name: string;
  workspaceId: string;
  totalDays: number;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type RangeRow = {
  id: string;
  targetCycleId: string;
  startDay: number;
  endDay: number;
  createdAt: Date;
};

type DayRange = {
  startDay: number;
  endDay: number;
};

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const clearTargetCycleCache = async (workspaceId: string): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(getCacheKey(workspaceId));
  }
};

const resolveCreatorDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapCycleCreatorNames = async <T extends { createdBy: string | null }>(
  cycles: T[],
): Promise<T[]> => {
  const creatorIds = Array.from(
    new Set(
      cycles
        .map((cycle) => cycle.createdBy)
        .filter((value): value is string => Boolean(value && value.trim())),
    ),
  );

  if (creatorIds.length === 0) return cycles;

  const users = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  });

  const map = new Map<string, string>();
  users.forEach((user) => {
    map.set(user.id, resolveCreatorDisplayName(user));
  });

  return cycles.map((cycle) => ({
    ...cycle,
    createdBy: cycle.createdBy ? map.get(cycle.createdBy) || cycle.createdBy : null,
  }));
};

const validateRangesAndComputeTotalDays = (ranges: DayRange[]): number => {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    const error: any = new Error('At least one range is required.');
    error.statusCode = 422;
    throw error;
  }

  const sortedRanges = [...ranges].sort((a, b) => a.startDay - b.startDay);

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const previous = sortedRanges[index - 1];
    const current = sortedRanges[index];
    if (current.startDay <= previous.endDay) {
      const error: any = new Error('Ranges cannot overlap.');
      error.statusCode = 422;
      throw error;
    }
  }

  const totalDays = sortedRanges.reduce((sum, range) => sum + (range.endDay - range.startDay + 1), 0);

  if (totalDays < 28 || totalDays > 31) {
    const error: any = new Error('Total should be between 28 to 31.');
    error.statusCode = 422;
    throw error;
  }

  return totalDays;
};

const hasGeneratedDelegates = (): boolean => {
  const targetCycle = (prisma as any).targetCycle;
  const targetCycleRange = (prisma as any).targetCycleRange;
  const targetSetting = (prisma as any).targetSetting;
  return Boolean(
    targetCycle?.findFirst &&
      targetCycle?.findMany &&
      targetCycleRange?.findMany &&
      targetSetting?.count,
  );
};

const assertSchemaReady = async (): Promise<void> => {
  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'target_cycles'
  `;
  const rangesRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'target_cycle_ranges'
  `;

  if (!tableRows[0]?.table_name || !rangesRows[0]?.table_name) {
    const error: any = new Error(
      'Target Cycle DB schema is missing. Run Prisma migration/db push and restart backend.',
    );
    error.statusCode = 503;
    throw error;
  }
};

const ensureNameIsAvailable = async (
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> => {
  const existing = await (prisma as any).targetCycle.findFirst({
    where: {
      workspaceId,
      name,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });

  if (existing) {
    const error: any = new Error(`Target cycle "${name}" already exists.`);
    error.statusCode = 409;
    throw error;
  }
};

const getCycleByIdScoped = async (
  id: string,
  workspaceId: string,
): Promise<CycleRow | null> => {
  return await (prisma as any).targetCycle.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null
    }
  });
};

export const createTargetCycle = async (
  workspaceId: string,
  input: CreateTargetCycleInput,
  createdBy?: string,
): Promise<TargetCycleResponse> => {
  await assertSchemaReady();
  const totalDays = validateRangesAndComputeTotalDays(input.ranges);

  await ensureNameIsAvailable(workspaceId, input.name);

  const createdCycle = await prisma.$transaction(async (tx: any) => {
    const cycle = await (tx as any).targetCycle.create({
      data: {
        name: input.name,
        workspaceId,
        totalDays,
        status: input.status,
        createdBy,
      },
    });

    await (tx as any).targetCycleRange.createMany({
      data: input.ranges.map((range) => ({
        targetCycleId: cycle.id,
        startDay: range.startDay,
        endDay: range.endDay,
      })),
    });

    const fullCycle = await (tx as any).targetCycle.findUnique({
      where: { id: cycle.id },
      include: {
        ranges: {
          orderBy: { startDay: 'asc' },
        },
      },
    });

    if (!fullCycle) {
      const error: any = new Error('Failed to create target cycle.');
      error.statusCode = 500;
      throw error;
    }

    return fullCycle;
  });

  const [mapped] = await mapCycleCreatorNames([createdCycle as TargetCycleResponse]);
  await clearTargetCycleCache(workspaceId);
  return mapped as TargetCycleResponse;
};

export const listTargetCycles = async (
  workspaceId: string,
  query: ListTargetCyclesQuery,
): Promise<ListTargetCyclesResponse> => {
  await assertSchemaReady();

  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;
  const cacheKey = getCacheKey(workspaceId);
  const canUseCache = page === 1 && limit === 10 && !search && !status;

  if (canUseCache && redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ListTargetCyclesResponse;
    }
  }

  let records: TargetCycleResponse[] = [];
  let total = 0;

  const targetCycle = (prisma as any).targetCycle;
  const where = {
    workspaceId,
    deletedAt: null,
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(status ? { status } : {}),
  };

  const [countValue, rows] = await prisma.$transaction([
    targetCycle.count({ where }),
    targetCycle.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        ranges: {
          orderBy: { startDay: 'asc' },
        },
        periods: {
          orderBy: { periodIndex: 'asc' },
          include: {
            metrics: {
              include: {
                stageTargets: {
                  include: {
                    leadStage: { select: { id: true, name: true, color: true } }
                  }
                }
              }
            }
          }
        },
        leadStage: { select: { id: true, name: true, color: true } },
      },
    }),
  ]);

  total = countValue;
  records = rows as TargetCycleResponse[];

  const mappedRecords = await mapCycleCreatorNames(records);

  const response: ListTargetCyclesResponse = {
    data: mappedRecords,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };

  if (canUseCache && redisClient.isOpen) {
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
  }

  return response;
};

export const getTargetCycleById = async (id: string, workspaceId: string): Promise<TargetCycleResponse> => {
  await assertSchemaReady();

  const cycle = await (prisma as any).targetCycle.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      ranges: { orderBy: { startDay: 'asc' } },
      periods: {
        orderBy: { periodIndex: 'asc' },
        include: {
          metrics: { 
            include: {
              stageTargets: {
                include: {
                  leadStage: { select: { id: true, name: true, color: true } }
                }
              }
            }
          }
        }
      },
      leadStage: { select: { id: true, name: true, color: true } },
    },
  });
  if (!cycle) {
    const error: any = new Error('Target cycle not found.');
    error.statusCode = 404;
    throw error;
  }
  const [mapped] = await mapCycleCreatorNames([cycle as TargetCycleResponse]);
  return mapped as TargetCycleResponse;
};

export const updateTargetCycle = async (
  id: string,
  workspaceId: string,
  input: UpdateTargetCycleInput,
): Promise<TargetCycleResponse> => {
  await assertSchemaReady();

  const targetCycleRange = (prisma as any).targetCycleRange;
  const existing = await (prisma as any).targetCycle.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: { id: true, name: true, totalDays: true, status: true },
  });

  if (!existing) {
    const error: any = new Error('Target cycle not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextName = input.name ?? existing.name;
  await ensureNameIsAvailable(workspaceId, nextName, id);

  const targetRanges =
    input.ranges ??
    (await targetCycleRange.findMany({
      where: { targetCycleId: id },
      orderBy: { startDay: 'asc' },
      select: { startDay: true, endDay: true },
    }));

  const totalDays = validateRangesAndComputeTotalDays(targetRanges);

  const updatedCycle = await prisma.$transaction(async (tx: any) => {
    if (input.ranges) {
      await (tx as any).targetCycleRange.deleteMany({ where: { targetCycleId: id } });
      await (tx as any).targetCycleRange.createMany({
        data: input.ranges.map((range) => ({
          targetCycleId: id,
          startDay: range.startDay,
          endDay: range.endDay,
        })),
      });
    }

    await (tx as any).targetCycle.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        totalDays,
      },
    });

    return (tx as any).targetCycle.findUnique({
      where: { id },
      include: { ranges: { orderBy: { startDay: 'asc' } } },
    });
  });

  const [mapped] = await mapCycleCreatorNames([updatedCycle as TargetCycleResponse]);
  await clearTargetCycleCache(workspaceId);
  return mapped as TargetCycleResponse;
};

export const deleteTargetCycle = async (id: string, workspaceId: string): Promise<void> => {
  await assertSchemaReady();

  const existing = await getCycleByIdScoped(id, workspaceId);

  if (!existing) {
    const error: any = new Error('Target cycle not found.');
    error.statusCode = 404;
    throw error;
  }

  const usageCount = await (prisma as any).targetSetting.count({
    where: { workspaceId, targetCycleId: id },
  });

  if (usageCount > 0) {
    const error: any = new Error('Target cycle is used in targets and cannot be deleted.');
    error.statusCode = 400;
    throw error;
  }

  await (prisma as any).targetCycle.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await (prisma as any).targetAssignment.updateMany({
    where: { targetCycleId: id, isActive: true },
    data: { isActive: false },
  });

  await (prisma as any).user.updateMany({
    where: { assignedTargetCycleId: id },
    data: {
      assignedTargetCycleId: null,
      isLocked: false,
      targetLockedAt: null,
      targetLockReason: null,
    },
  });

  await clearTargetCycleCache(workspaceId);
};

