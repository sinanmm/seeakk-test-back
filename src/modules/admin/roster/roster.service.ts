import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import type {
  BulkDepartmentAssignResult,
  RosterEntryDTO,
  RosterUsersListResponse,
} from './roster.types';
import type {
  BulkAssignDepartmentInput,
  CreateRosterEntryInput,
  ListRosterUsersQuery,
  UpdateRosterEntryInput,
} from './roster.validator';

const MAX_DATE = new Date('9999-12-31T23:59:59.999Z');
const ROSTER_CACHE_PREFIX = 'roster_user_';
const ROSTER_CACHE_TTL_SECONDS = 300;

const getRosterEntryModel = () => {
  const model = (prisma as any).rosterEntry;
  if (!model) {
    const error: any = new Error(
      'Roster module is not ready. Prisma client is out of sync for RosterEntry. Run prisma migrate/db push + prisma generate, then restart backend.',
    );
    error.statusCode = 503;
    throw error;
  }
  return model;
};

const clearRosterCacheForUser = async (userId: string): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(`${ROSTER_CACHE_PREFIX}${userId}`);
  }
};

const clearRosterCacheForUsers = async (userIds: string[]): Promise<void> => {
  if (!redisClient.isOpen || userIds.length === 0) return;
  await Promise.all(userIds.map((userId) => redisClient.del(`${ROSTER_CACHE_PREFIX}${userId}`)));
};

const resolveCreatorDisplayName = (user: { name: string | null; username?: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapCreatorNames = async <T extends { createdBy: string | null }>(
  records: T[],
): Promise<T[]> => {
  const creatorIds = Array.from(
    new Set(records.map((record) => record.createdBy).filter((value): value is string => Boolean(value))),
  );

  if (creatorIds.length === 0) return records;

  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, name: true, username: true, email: true },
  });

  const creatorMap = new Map<string, string>();
  creators.forEach((creator) => creatorMap.set(creator.id, resolveCreatorDisplayName(creator)));

  return records.map((record) => ({
    ...record,
    createdBy: record.createdBy ? creatorMap.get(record.createdBy) || record.createdBy : null,
  }));
};

const toDayBounds = (date: Date): { start: Date; end: Date } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const assertUserInWorkspace = async (
  userId: string,
  workspaceId: string,
  options?: { activeOnly?: boolean },
): Promise<void> => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      workspaceId,
      deletedAt: null,
      ...(options?.activeOnly ? { isActive: true } : {}),
    } as any,
    select: { id: true },
  });

  if (!user) {
    const error: any = new Error('User not found in workspace.');
    error.statusCode = 404;
    throw error;
  }
};

const assertNoOverlap = async (params: {
  userId: string;
  startDate: Date;
  endDate: Date | null;
  excludeId?: string;
}): Promise<void> => {
  const rosterEntryModel = getRosterEntryModel();
  const effectiveEnd = params.endDate ?? MAX_DATE;

  const conflict = await rosterEntryModel.findFirst({
    where: {
      userId: params.userId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      AND: [
        { startDate: { lte: effectiveEnd } },
        {
          OR: [{ endDate: null }, { endDate: { gte: params.startDate } }],
        },
      ],
    },
    select: { id: true },
  });

  if (conflict) {
    const error: any = new Error('Roster date range overlaps with an existing active roster entry.');
    error.statusCode = 409;
    throw error;
  }
};

const assertHolidayUniqueness = async (params: {
  userId: string;
  rosterType: 'HOLIDAY' | 'WEEKLY_OFF' | 'SHIFT' | 'SPECIAL_WORKING_DAY';
  startDate: Date;
  excludeId?: string;
}): Promise<void> => {
  const rosterEntryModel = getRosterEntryModel();
  if (params.rosterType !== 'HOLIDAY') return;

  const { start, end } = toDayBounds(params.startDate);
  const duplicate = await rosterEntryModel.findFirst({
    where: {
      userId: params.userId,
      rosterType: 'HOLIDAY',
      status: 'ACTIVE',
      deletedAt: null,
      startDate: { gte: start, lte: end },
      ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    const error: any = new Error('Holiday already exists for this date and user.');
    error.statusCode = 409;
    throw error;
  }
};

const assertPastDateAllowed = (startDate: Date): void => {
  const allowPastDates = process.env.ROSTER_ALLOW_PAST_DATES === 'true';
  if (allowPastDates) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entryDate = new Date(startDate);
  entryDate.setHours(0, 0, 0, 0);
  if (entryDate < today) {
    const error: any = new Error('Past date roster entries are not allowed.');
    error.statusCode = 400;
    throw error;
  }
};

const buildShiftFields = (input: {
  rosterType: 'HOLIDAY' | 'WEEKLY_OFF' | 'SHIFT' | 'SPECIAL_WORKING_DAY';
  shiftSession?: 'DAY' | 'NIGHT' | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
}) => {
  if (input.rosterType !== 'SHIFT') {
    return {
      shiftSession: null,
      shiftStartTime: null,
      shiftEndTime: null,
    };
  }

  return {
    shiftSession: input.shiftSession ?? null,
    shiftStartTime: input.shiftStartTime ?? null,
    shiftEndTime: input.shiftEndTime ?? null,
  };
};

export const createRosterEntry = async (
  input: CreateRosterEntryInput,
  workspaceId: string,
  createdBy?: string,
): Promise<RosterEntryDTO> => {
  const rosterEntryModel = getRosterEntryModel();
  await assertUserInWorkspace(input.userId, workspaceId, { activeOnly: true });
  assertPastDateAllowed(input.startDate);
  await assertNoOverlap({
    userId: input.userId,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
  });
  await assertHolidayUniqueness({
    userId: input.userId,
    rosterType: input.rosterType,
    startDate: input.startDate,
  });

  const created = await rosterEntryModel.create({
    data: {
      userId: input.userId,
      rosterType: input.rosterType,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      ...buildShiftFields(input),
      status: input.status,
      createdBy: createdBy ?? null,
    },
  });

  await clearRosterCacheForUser(input.userId);
  const [mapped] = await mapCreatorNames([created as RosterEntryDTO]);
  return mapped;
};

export const listRosterUsers = async (
  query: ListRosterUsersQuery,
  workspaceId: string,
): Promise<RosterUsersListResponse> => {
  const skip = (query.page - 1) * query.limit;
  const where: any = {
    workspaceId,
    deletedAt: null,
    isActive: query.status ? query.status === 'ACTIVE' : true,
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.supervisorId ? { supervisorId: query.supervisorId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive'} },
            { email: { contains: query.search, mode: 'insensitive'} },
          ],
        }
      : {}),
  };

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        department: { select: { name: true } },
        supervisor: { select: { name: true, email: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  return {
    data: users.map((user) => ({
      id: user.id,
      name: user.name?.trim() || user.email,
      email: user.email,
      department: user.department?.name || null,
      supervisor: user.supervisor?.name || user.supervisor?.email || null,
      status: user.isActive ? 'ACTIVE' : 'INACTIVE',
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1,
    },
  };
};

export const getUserRosterEntries = async (
  userId: string,
  workspaceId: string,
): Promise<RosterEntryDTO[]> => {
  const rosterEntryModel = getRosterEntryModel();
  await assertUserInWorkspace(userId, workspaceId);

  const cacheKey = `${ROSTER_CACHE_PREFIX}${userId}`;
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as RosterEntryDTO[];
      const mappedCached = await mapCreatorNames(parsed);
      // Refresh cached payload to keep creator names human-readable.
      await redisClient.setEx(cacheKey, ROSTER_CACHE_TTL_SECONDS, JSON.stringify(mappedCached));
      return mappedCached;
    }
  }

  const entries = (await rosterEntryModel.findMany({
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  })) as RosterEntryDTO[];

  const mappedEntries = await mapCreatorNames(entries);

  if (redisClient.isOpen) {
    await redisClient.setEx(cacheKey, ROSTER_CACHE_TTL_SECONDS, JSON.stringify(mappedEntries));
  }

  return mappedEntries;
};

export const updateRosterEntry = async (
  id: string,
  input: UpdateRosterEntryInput,
  workspaceId: string,
): Promise<RosterEntryDTO> => {
  const rosterEntryModel = getRosterEntryModel();
  const existing = await rosterEntryModel.findFirst({
    where: {
      id,
      deletedAt: null,
      user: { workspaceId, deletedAt: null },
    },
    include: { user: { select: { id: true } } },
  });

  if (!existing) {
    const error: any = new Error('Roster entry not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextStartDate = input.startDate ?? existing.startDate;
  const nextEndDate = input.endDate !== undefined ? input.endDate : existing.endDate;
  const nextRosterType = input.rosterType ?? existing.rosterType;
  assertPastDateAllowed(nextStartDate);

  await assertNoOverlap({
    userId: existing.userId,
    startDate: nextStartDate,
    endDate: nextEndDate,
    excludeId: existing.id,
  });
  await assertHolidayUniqueness({
    userId: existing.userId,
    rosterType: nextRosterType,
    startDate: nextStartDate,
    excludeId: existing.id,
  });

  const updated = await rosterEntryModel.update({
    where: { id: existing.id },
    data: {
      ...(input.rosterType !== undefined ? { rosterType: input.rosterType } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...buildShiftFields({
        rosterType: nextRosterType,
        shiftSession:
          input.shiftSession !== undefined ? input.shiftSession : (existing.shiftSession as 'DAY' | 'NIGHT' | null),
        shiftStartTime:
          input.shiftStartTime !== undefined ? input.shiftStartTime : (existing.shiftStartTime as string | null),
        shiftEndTime:
          input.shiftEndTime !== undefined ? input.shiftEndTime : (existing.shiftEndTime as string | null),
      }),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await clearRosterCacheForUser(existing.userId);
  const [mapped] = await mapCreatorNames([updated as RosterEntryDTO]);
  return mapped;
};

export const deleteRosterEntry = async (
  id: string,
  workspaceId: string,
): Promise<void> => {
  const rosterEntryModel = getRosterEntryModel();
  const existing = await rosterEntryModel.findFirst({
    where: {
      id,
      deletedAt: null,
      user: { workspaceId, deletedAt: null },
    },
    select: { id: true, userId: true },
  });

  if (!existing) {
    const error: any = new Error('Roster entry not found.');
    error.statusCode = 404;
    throw error;
  }

  await rosterEntryModel.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });

  await clearRosterCacheForUser(existing.userId);
};

export const bulkAssignDepartment = async (
  input: BulkAssignDepartmentInput,
  workspaceId: string,
  createdBy?: string,
): Promise<BulkDepartmentAssignResult> => {
  const rosterEntryModel = getRosterEntryModel();
  const department = await (prisma as any).department.findFirst({
    where: { id: input.departmentId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    const error: any = new Error('Department not found in workspace.');
    error.statusCode = 404;
    throw error;
  }

  assertPastDateAllowed(input.startDate);

  const users = await prisma.user.findMany({
    where: {
      workspaceId,
      departmentId: input.departmentId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  if (users.length === 0) {
    return { totalUsers: 0, createdCount: 0, skippedCount: 0, skippedUserIds: [] };
  }

  const userIds = users.map((user) => user.id);
  const effectiveEnd = input.endDate ?? MAX_DATE;

  const overlappingEntries = await rosterEntryModel.findMany({
    where: {
      userId: { in: userIds },
      deletedAt: null,
      status: 'ACTIVE',
      AND: [
        { startDate: { lte: effectiveEnd } },
        { OR: [{ endDate: null }, { endDate: { gte: input.startDate } }] },
      ],
    },
    select: { userId: true },
  });

  const skippedSet = new Set<string>(overlappingEntries.map((entry: { userId: string }) => entry.userId));

  if (input.rosterType === 'HOLIDAY') {
    const { start, end } = toDayBounds(input.startDate);
    const duplicateHolidays = await rosterEntryModel.findMany({
      where: {
        userId: { in: userIds },
        rosterType: 'HOLIDAY',
        status: 'ACTIVE',
        deletedAt: null,
        startDate: { gte: start, lte: end },
      },
      select: { userId: true },
    });
    duplicateHolidays.forEach((entry: { userId: string }) => skippedSet.add(entry.userId));
  }

  const createUserIds = userIds.filter((userId) => !skippedSet.has(userId));
  if (createUserIds.length > 0) {
    await rosterEntryModel.createMany({
      data: createUserIds.map((userId) => ({
        userId,
        rosterType: input.rosterType,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        ...buildShiftFields(input),
        status: input.status,
        createdBy: createdBy ?? null,
      })),
    });
  }

  await clearRosterCacheForUsers(userIds);

  return {
    totalUsers: userIds.length,
    createdCount: createUserIds.length,
    skippedCount: skippedSet.size,
    skippedUserIds: Array.from(skippedSet),
  };
};
