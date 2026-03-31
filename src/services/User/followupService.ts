import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import type {
  CalendarQueryInput,
  CalendarView,
  CompleteFollowUpInput,
  CreateFollowUpInput,
  FollowUpStatus,
  HistoryQueryInput,
  TodayFollowUpsQueryInput,
} from '../../validations/followupValidation';

const FOLLOWUP_PENDING = 'PENDING';
const FOLLOWUP_COMPLETED = 'COMPLETED';
const TODAY_CACHE_TTL_SECONDS = 60;

type FollowUpRecord = {
  id: string;
  leadId: string;
  userId: string;
  workspaceId: string;
  type: string;
  description: string | null;
  status: string;
  scheduledAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    email: string;
  };
  images: Array<{
    id: string;
    url: string;
    createdAt: Date;
  }>;
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const normalizeRoleKey = (role?: string | null): string =>
  (role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const isManagerialRole = (role?: string | null): boolean => {
  const normalized = normalizeRoleKey(role);
  return normalized === 'admin' || normalized === 'superadmin' || normalized === 'manager';
};

const hasGeneratedDelegates = (): boolean => {
  const followUp = (prisma as any).followUp;
  const followUpImage = (prisma as any).followUpImage;
  return Boolean(
    followUp?.findFirst &&
      followUp?.findMany &&
      followUp?.create &&
      followUp?.update &&
      followUpImage?.createMany,
  );
};

const assertModuleReady = async (): Promise<void> => {
  const followUpTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.follow_ups')::text AS table_name
  `;
  const followUpImageTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.follow_up_images')::text AS table_name
  `;

  if (!followUpTable[0]?.table_name || !followUpImageTable[0]?.table_name) {
    throw createServiceError(
      'Follow-up module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Follow-up module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const resolveDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapFollowUpRecord = (record: FollowUpRecord) => ({
  ...record,
  scheduledAt: record.scheduledAt.toISOString(),
  completedAt: record.completedAt ? record.completedAt.toISOString() : null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  user: {
    ...record.user,
    displayName: resolveDisplayName(record.user),
  },
  images: record.images.map((image) => ({
    ...image,
    createdAt: image.createdAt.toISOString(),
  })),
});

const buildFollowUpInclude = {
  user: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  images: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      url: true,
      createdAt: true,
    },
  },
} as const;

const getWorkspaceTimeZone = async (workspaceId: string): Promise<string> => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { timeZone: true },
  });

  if (workspace?.timeZone && moment.tz.zone(workspace.timeZone)) {
    return workspace.timeZone;
  }

  return 'UTC';
};

const getDayRangeForWorkspace = async (workspaceId: string, date = new Date()) => {
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const zonedDate = moment.tz(date, timeZone);
  return {
    timeZone,
    start: zonedDate.clone().startOf('day').toDate(),
    end: zonedDate.clone().endOf('day').toDate(),
    cacheDateKey: zonedDate.format('YYYY-MM-DD'),
  };
};

const resolveTargetUserId = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  requestedUserId?: string,
): Promise<string> => {
  if (!requestedUserId || requestedUserId === actor.id) {
    return actor.id;
  }

  if (!isManagerialRole(actor.role?.name)) {
    throw createServiceError('You are not allowed to access follow-ups for another user.', 403);
  }

  const targetUser = await prisma.user.findFirst({
    where: {
      id: requestedUserId,
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  if (!targetUser) {
    throw createServiceError('Requested user was not found in this workspace.', 404);
  }

  return targetUser.id;
};

const getLeadTableColumns = async (): Promise<{
  leadTableExists: boolean;
  idColumn: string | null;
  workspaceColumn: string | null;
}> => {
  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.leads')::text AS table_name
  `;

  if (!tableRows[0]?.table_name) {
    return { leadTableExists: false, idColumn: null, workspaceColumn: null };
  }

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
  `;

  const idColumn = ['id', 'leadId', 'lead_id'].find((column) =>
    columnRows.some((row) => row.column_name === column),
  ) || null;
  const workspaceColumn = ['workspaceId', 'workspace_id'].find((column) =>
    columnRows.some((row) => row.column_name === column),
  ) || null;

  return {
    leadTableExists: true,
    idColumn,
    workspaceColumn,
  };
};

const ensureLeadExistsInWorkspace = async (leadId: string, workspaceId: string): Promise<void> => {
  const columns = await getLeadTableColumns();

  if (!columns.leadTableExists || !columns.idColumn || !columns.workspaceColumn) {
    throw createServiceError('Lead module is not ready. Database table "leads" is missing or invalid.', 503);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "${columns.idColumn}" AS id
     FROM "leads"
     WHERE "${columns.idColumn}" = $1
       AND "${columns.workspaceColumn}" = $2
     LIMIT 1`,
    leadId,
    workspaceId,
  );

  if (rows.length === 0) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }
};

const buildTodayCacheKey = (workspaceId: string, userId: string, cacheDateKey: string): string =>
  `followups:today:${workspaceId}:${userId}:${cacheDateKey}`;

const invalidateTodayCache = async (
  workspaceId: string,
  userId: string,
  dates: string[],
): Promise<void> => {
  if (!redisClient.isOpen || dates.length === 0) return;

  const uniqueKeys = Array.from(new Set(dates.map((date) => buildTodayCacheKey(workspaceId, userId, date))));
  if (uniqueKeys.length > 0) {
    await redisClient.del(uniqueKeys);
  }
};

const buildFollowUpWhere = (params: {
  workspaceId: string;
  userId?: string;
  status?: FollowUpStatus;
  startDate?: Date;
  endDate?: Date;
}) => ({
  workspaceId: params.workspaceId,
  ...(params.userId ? { userId: params.userId } : {}),
  ...(params.status ? { status: params.status } : {}),
  ...(params.startDate || params.endDate
    ? {
        scheduledAt: {
          ...(params.startDate ? { gte: params.startDate } : {}),
          ...(params.endDate ? { lte: params.endDate } : {}),
        },
      }
    : {}),
});

const groupCalendarItems = (
  view: CalendarView,
  records: ReturnType<typeof mapFollowUpRecord>[],
  timeZone: string,
) => {
  if (view === 'list' || view === 'day') {
    return {
      view,
      items: records,
    };
  }

  const grouped = records.reduce<Record<string, ReturnType<typeof mapFollowUpRecord>[]>>((acc, record) => {
    const key = moment.tz(record.scheduledAt, timeZone).format('YYYY-MM-DD');
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(record);
    return acc;
  }, {});

  return {
    view,
    groups: Object.entries(grouped)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, items]) => ({
        date,
        items,
      })),
  };
};

export const createFollowUp = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  input: CreateFollowUpInput,
) => {
  await assertModuleReady();

  await ensureLeadExistsInWorkspace(input.leadId, workspaceId);

  const userId = await resolveTargetUserId(workspaceId, actor);

  const created = await (prisma as any).followUp.create({
    data: {
      leadId: input.leadId.trim(),
      userId,
      workspaceId,
      type: input.type,
      description: input.description?.trim() || null,
      status: FOLLOWUP_PENDING,
      scheduledAt: input.scheduledAt,
    },
    include: buildFollowUpInclude,
  });

  const scheduleDateKey = moment(input.scheduledAt).utc().format('YYYY-MM-DD');
  const todayRange = await getDayRangeForWorkspace(workspaceId);
  await invalidateTodayCache(workspaceId, userId, [scheduleDateKey, todayRange.cacheDateKey]);

  logger.info('Follow-up created', {
    module: 'follow-up',
    followUpId: created.id,
    workspaceId,
    userId,
    leadId: input.leadId,
    type: input.type,
  });

  return mapFollowUpRecord(created as FollowUpRecord);
};

export const getCalendarData = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: CalendarQueryInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);

  const where = buildFollowUpWhere({
    workspaceId,
    userId: targetUserId,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  const records = await (prisma as any).followUp.findMany({
    where,
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    include: buildFollowUpInclude,
  });

  const mapped = (records as FollowUpRecord[]).map(mapFollowUpRecord);

  return {
    timeZone,
    ...groupCalendarItems(query.view, mapped, timeZone),
  };
};

export const getTodayFollowUps = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: TodayFollowUpsQueryInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const { start, end, cacheDateKey, timeZone } = await getDayRangeForWorkspace(workspaceId);
  const cacheKey = buildTodayCacheKey(workspaceId, targetUserId, cacheDateKey);

  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const records = await (prisma as any).followUp.findMany({
    where: buildFollowUpWhere({
      workspaceId,
      userId: targetUserId,
      status: FOLLOWUP_PENDING,
      startDate: start,
      endDate: end,
    }),
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    include: buildFollowUpInclude,
  });

  const payload = {
    timeZone,
    items: (records as FollowUpRecord[]).map(mapFollowUpRecord),
  };

  if (redisClient.isOpen) {
    await redisClient.setEx(cacheKey, TODAY_CACHE_TTL_SECONDS, JSON.stringify(payload));
  }

  return payload;
};

export const completeFollowUp = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  id: string,
  input: CompleteFollowUpInput,
) => {
  await assertModuleReady();

  const existing = await (prisma as any).followUp.findFirst({
    where: {
      id,
      workspaceId,
    },
    include: buildFollowUpInclude,
  });

  if (!existing) {
    throw createServiceError('Follow-up not found in this workspace.', 404);
  }

  if (existing.userId !== actor.id && !isManagerialRole(actor.role?.name)) {
    throw createServiceError('You are not allowed to complete another user\'s follow-up.', 403);
  }

  if (existing.status === FOLLOWUP_COMPLETED) {
    throw createServiceError('Follow-up has already been completed.', 409);
  }

  const completedAt = new Date();

  const completed = await prisma.$transaction(async (tx) => {
    const updated = await (tx as any).followUp.update({
      where: { id: existing.id },
      data: {
        status: FOLLOWUP_COMPLETED,
        completedAt,
        description: input.description.trim(),
      },
      include: buildFollowUpInclude,
    });

    if (input.images.length > 0) {
      await (tx as any).followUpImage.createMany({
        data: input.images.map((url) => ({
          followUpId: existing.id,
          url: url.trim(),
        })),
      });
    }

    return (tx as any).followUp.findUnique({
      where: { id: existing.id },
      include: buildFollowUpInclude,
    });
  });

  const todayRange = await getDayRangeForWorkspace(workspaceId);
  const scheduledDateKey = moment(existing.scheduledAt).utc().format('YYYY-MM-DD');
  await invalidateTodayCache(workspaceId, existing.userId, [scheduledDateKey, todayRange.cacheDateKey]);

  logger.info('Follow-up completed', {
    module: 'follow-up',
    followUpId: existing.id,
    workspaceId,
    userId: existing.userId,
  });

  return mapFollowUpRecord(completed as FollowUpRecord);
};

export const getHistory = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: HistoryQueryInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const skip = (query.page - 1) * query.limit;

  const where = buildFollowUpWhere({
    workspaceId,
    userId: targetUserId,
    status: query.status,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  const [total, records] = await prisma.$transaction([
    (prisma as any).followUp.count({ where }),
    (prisma as any).followUp.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      include: buildFollowUpInclude,
    }),
  ]);

  return {
    items: (records as FollowUpRecord[]).map(mapFollowUpRecord),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};
