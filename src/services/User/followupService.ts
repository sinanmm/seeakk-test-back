import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { normalizeFollowUpType } from '../../constants/followUpType';
import logger from '../../utils/logger';
import type {
  CalendarQueryInput,
  CalendarView,
  CompleteFollowUpInput,
  CreateFollowUpInput,
  FollowUpStatus,
  HistoryQueryInput,
  ReminderAlertsQueryInput,
  SnoozeFollowUpInput,
  TodayFollowUpsQueryInput,
  AdvancedCalendarSummaryInput,
  AdvancedCalendarDetailsInput,
} from '../../validations/followupValidation';

const FOLLOWUP_PENDING = 'PENDING';
const FOLLOWUP_COMPLETED = 'COMPLETED';
const FOLLOWUP_MISSED = 'MISSED';
const TODAY_CACHE_TTL_SECONDS = 60;
const MISSED_AFTER_MINUTES = Number(process.env.FOLLOWUP_MISSED_AFTER_MINUTES || 0);
const FOLLOWUP_SCHEMA_CHECK_TTL_MS = 60_000;
let followupSchemaCheckValidUntil = 0;

type FollowUpRecord = {
  id: string;
  leadId: string;
  userId: string;
  workspaceId: string;
  type: string;
  description: string | null;
  completionDescription: string | null;
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
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  images: Array<{
    id: string;
    url: string;
    createdAt: Date;
  }>;
};

type ReminderFollowUpRecord = {
  id: string;
  leadId: string;
  userId: string;
  type: string;
  description: string | null;
  scheduledAt: Date;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    email: string;
  };
  lead: {
    id: string;
    name: string;
  };
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
  if (Date.now() < followupSchemaCheckValidUntil) {
    return;
  }

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

  const requiredFollowUpsColumns = [
    'id',
    'leadId',
    'userId',
    'workspaceId',
    'type',
    'description',
    'completionDescription',
    'status',
    'scheduledAt',
    'completedAt',
    'createdAt',
    'updatedAt',
  ] as const;
  const requiredFollowUpImageColumns = ['id', 'followUpId', 'url', 'createdAt'] as const;
  const requiredWorkspacesColumns = ['id', 'timeZone'] as const;
  const requiredLeadsColumns = ['id', 'name'] as const;

  const [
    followUpsColumns,
    followUpImagesColumns,
    workspacesColumns,
    leadsColumns,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text AS column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'follow_ups'
    `,
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text AS column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'follow_up_images'
    `,
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text AS column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workspaces'
    `,
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text AS column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'leads'
    `,
  ]);

  const getMissingColumns = (rows: Array<{ column_name: string }>, requiredColumns: readonly string[]) => {
    const present = new Set(rows.map((row) => row.column_name.toLowerCase()));
    return requiredColumns.filter((col) => !present.has(col.toLowerCase()));
  };

  const missingFollowUps = getMissingColumns(followUpsColumns, requiredFollowUpsColumns);
  const missingFollowUpImages = getMissingColumns(followUpImagesColumns, requiredFollowUpImageColumns);
  const missingWorkspaces = getMissingColumns(workspacesColumns, requiredWorkspacesColumns);
  const missingLeads = getMissingColumns(leadsColumns, requiredLeadsColumns);

  const missingParts: string[] = [];
  if (missingFollowUps.length > 0) {
    missingParts.push(`follow_ups(${missingFollowUps.join(', ')})`);
  }
  if (missingFollowUpImages.length > 0) {
    missingParts.push(`follow_up_images(${missingFollowUpImages.join(', ')})`);
  }
  if (missingWorkspaces.length > 0) {
    missingParts.push(`workspaces(${missingWorkspaces.join(', ')})`);
  }
  if (missingLeads.length > 0) {
    missingParts.push(`leads(${missingLeads.join(', ')})`);
  }

  if (missingParts.length > 0) {
    throw createServiceError(
      `Follow-up module is not ready: missing required schema columns ${missingParts.join('; ')}.` +
        ' On the server that uses this DATABASE_URL, run `npx prisma migrate deploy`, then restart the API.',
      503,
    );
  }

  followupSchemaCheckValidUntil = Date.now() + FOLLOWUP_SCHEMA_CHECK_TTL_MS;
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string } | null): string => {
  if (!user) return '';
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email || '';
};

const mapFollowUpRecord = (record: FollowUpRecord) => ({
  ...record,
  type: normalizeFollowUpType(record.type),
  scheduledAt: record.scheduledAt.toISOString(),
  completedAt: record.completedAt ? record.completedAt.toISOString() : null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  user: {
    ...record.user,
    displayName: resolveDisplayName(record.user),
  },
  lead: {
    ...record.lead,
  },
  images: record.images.map((image) => ({
    ...image,
    createdAt: image.createdAt.toISOString(),
  })),
});

const mapReminderFollowUpRecord = (record: ReminderFollowUpRecord) => ({
  id: record.id,
  leadId: record.leadId,
  leadName: record.lead?.name || 'Lead',
  userId: record.userId,
  type: normalizeFollowUpType(record.type),
  description: record.description,
  scheduledAt: record.scheduledAt.toISOString(),
  minutesUntil: Math.ceil((record.scheduledAt.getTime() - Date.now()) / 60_000),
  user: {
    ...record.user,
    displayName: resolveDisplayName(record.user),
  },
});

const buildFollowUpInclude = {
  lead: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  },
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

const buildReminderInclude = {
  user: buildFollowUpInclude.user,
  lead: {
    select: {
      id: true,
      name: true,
    },
  },
  images: {
    select: {
      id: true,
      url: true,
      createdAt: true,
    },
    take: 0,
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

export const syncLeadNextFollowUpPointer = async (leadId: string, workspaceId: string): Promise<void> => {
  const nextPending = await (prisma as any).followUp.findFirst({
    where: {
      leadId,
      workspaceId,
      status: FOLLOWUP_PENDING,
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: { scheduledAt: true },
  });

  await (prisma as any).lead.update({
    where: { id: leadId },
    data: {
      nextFollowUpAt: nextPending?.scheduledAt ?? null,
    },
  });
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
    columnRows.some((row: { column_name: string }) => row.column_name === column),
  ) || null;
  const workspaceColumn = ['workspaceId', 'workspace_id'].find((column) =>
    columnRows.some((row: { column_name: string }) => row.column_name === column),
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

  const { idColumn, workspaceColumn } = columns;
  if (!idColumn || !workspaceColumn) {
    throw createServiceError('Lead module columns are missing.', 500);
  }

  const rows = (await (prisma as any).$queryRawUnsafe(
    `SELECT "${idColumn}" AS id
     FROM "leads"
     WHERE "${idColumn}" = $1
       AND "${workspaceColumn}" = $2
     LIMIT 1`,
    leadId,
    workspaceId,
  )) as Array<{ id: string }>;

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

  const keysToDelete = Array.from(new Set(dates.map((date) => buildTodayCacheKey(workspaceId, userId, date))));
  if (keysToDelete.length > 0) {
    // Standard Redis del can take an array in node-redis v4
    await redisClient.del(keysToDelete);
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

  const leadForSchedule = await prisma.lead.findFirst({
    where: { id: input.leadId.trim(), workspaceId, deletedAt: null },
    select: {
      lifecycleId: true,
      isClosed: true,
      isLOB: true,
      stageExpiresAt: true,
      stage: { select: { isClosed: true, isLOB: true } },
    },
  });

  if (leadForSchedule?.lifecycleId) {
    const { validateMandatoryFollowUpSchedule } = await import('./mandatoryFollowupContinuation.service');
    validateMandatoryFollowUpSchedule(leadForSchedule, input.scheduledAt);
  }

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
  await syncLeadNextFollowUpPointer(input.leadId.trim(), workspaceId);

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

export const getAdvancedCalendarSummary = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: AdvancedCalendarSummaryInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);

  const groupDate = (date: Date) => moment.tz(date, timeZone).format('YYYY-MM-DD');

  const [stages, leadsCreated, stageHistory, followUps] = await Promise.all([
    (prisma as any).leadStage.findMany({
      where: { workspaceId },
      select: { id: true, color: true },
    }),
    (prisma as any).lead.findMany({
      where: {
        workspaceId,
        createdById: targetUserId,
        createdAt: { gte: query.startDate, lte: query.endDate },
        deletedAt: null,
      },
      select: { createdAt: true },
    }),
    (prisma as any).leadStageHistory.findMany({
      where: {
        workspaceId,
        changedById: targetUserId,
        changedAt: { gte: query.startDate, lte: query.endDate },
      },
      select: { changedAt: true, toStageId: true, toStageName: true },
    }),
    (prisma as any).followUp.findMany({
      where: buildFollowUpWhere({
        workspaceId,
        userId: targetUserId,
        startDate: query.startDate,
        endDate: query.endDate,
      }),
      select: {
        scheduledAt: true,
        lead: { select: { stageId: true, stage: { select: { name: true, color: true } } } },
      },
    }),
  ]);

  const stageColorMap = Object.fromEntries(stages.map((s: any) => [s.id, s.color]));

  const summaryByDate: Record<string, {
    leadsCreated: number;
    totalFollowUps: number;
    stageTransitions: Record<string, { count: number; name: string; color: string }>;
    stageFollowUps: Record<string, { count: number; name: string; color: string }>;
  }> = {};

  const ensureDate = (d: string) => {
    if (!summaryByDate[d]) {
      summaryByDate[d] = {
        leadsCreated: 0,
        totalFollowUps: 0,
        stageTransitions: {},
        stageFollowUps: {},
      };
    }
  };

  leadsCreated.forEach((l: any) => {
    const d = groupDate(l.createdAt);
    ensureDate(d);
    summaryByDate[d].leadsCreated += 1;
  });

  followUps.forEach((f: any) => {
    const d = groupDate(f.scheduledAt);
    ensureDate(d);
    summaryByDate[d].totalFollowUps += 1;

    const stageId = f.lead?.stageId;
    if (stageId) {
      if (!summaryByDate[d].stageFollowUps[stageId]) {
        summaryByDate[d].stageFollowUps[stageId] = {
          count: 0,
          name: f.lead.stage?.name || 'Unknown Stage',
          color: f.lead.stage?.color || '#cbd5e1',
        };
      }
      summaryByDate[d].stageFollowUps[stageId].count += 1;
    }
  });

  stageHistory.forEach((h: any) => {
    const stageId = h.toStageId;
    if (stageId) {
      const d = groupDate(h.changedAt);
      ensureDate(d);
      if (!summaryByDate[d].stageTransitions[stageId]) {
        summaryByDate[d].stageTransitions[stageId] = {
          count: 0,
          name: h.toStageName || 'Unknown Stage',
          color: stageColorMap[stageId] || '#cbd5e1',
        };
      }
      summaryByDate[d].stageTransitions[stageId].count += 1;
    }
  });

  const formattedSummary = Object.entries(summaryByDate).map(([date, data]) => ({
    date,
    leadsCreated: data.leadsCreated,
    totalFollowUps: data.totalFollowUps,
    stageTransitions: Object.entries(data.stageTransitions).map(([id, info]) => ({
      stageId: id,
      ...info,
    })),
    stageFollowUps: Object.entries(data.stageFollowUps).map(([id, info]) => ({
      stageId: id,
      ...info,
    })),
  }));

  return {
    timeZone,
    summary: formattedSummary,
  };
};

export const getAdvancedCalendarDetails = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: AdvancedCalendarDetailsInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const skip = (query.page - 1) * query.limit;

  const targetDateStr = moment.utc(query.date).format('YYYY-MM-DD');
  const startOfDay = moment.tz(targetDateStr, timeZone).startOf('day').toDate();
  const endOfDay = moment.tz(targetDateStr, timeZone).endOf('day').toDate();

  let items = [];
  let total = 0;

  if (query.type === 'LEADS_CREATED') {
    const where = {
      workspaceId,
      createdById: targetUserId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      deletedAt: null,
    };
    [total, items] = await Promise.all([
      (prisma as any).lead.count({ where }),
      (prisma as any).lead.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: { stage: { select: { name: true, color: true } }, assignedTo: { select: { name: true } } },
      }),
    ]);
  } else if (query.type === 'STAGE_CREATED') {
    const where = {
      workspaceId,
      stageHistory: {
        some: {
          changedById: targetUserId,
          changedAt: { gte: startOfDay, lte: endOfDay },
          toStageId: query.stageId,
        },
      },
      deletedAt: null,
    };
    [total, items] = await Promise.all([
      (prisma as any).lead.count({ where }),
      (prisma as any).lead.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        include: { stage: { select: { name: true, color: true } }, assignedTo: { select: { name: true } } },
      }),
    ]);
  } else if (query.type === 'TOTAL_FOLLOWUPS' || query.type === 'STAGE_FOLLOWUPS') {
    const where: any = {
      workspaceId,
      userId: targetUserId,
      scheduledAt: { gte: startOfDay, lte: endOfDay },
    };
    if (query.type === 'STAGE_FOLLOWUPS') {
      where.lead = { stageId: query.stageId };
    }
    [total, items] = await Promise.all([
      (prisma as any).followUp.count({ where }),
      (prisma as any).followUp.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { scheduledAt: 'asc' },
        include: buildFollowUpInclude,
      }),
    ]);
    items = items.map((i: any) => mapFollowUpRecord(i));
  }

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
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
    if (typeof cached === 'string' && cached.length > 0) {
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

export const getReminderAlerts = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: ReminderAlertsQueryInput,
) => {
  await assertModuleReady();

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  if (MISSED_AFTER_MINUTES > 0) {
    const cutoff = new Date(Date.now() - MISSED_AFTER_MINUTES * 60_000);
    await (prisma as any).followUp.updateMany({
      where: {
        workspaceId,
        userId: targetUserId,
        status: FOLLOWUP_PENDING,
        scheduledAt: { lt: cutoff },
      },
      data: {
        status: FOLLOWUP_MISSED,
      },
    });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - query.includePastMinutes * 60_000);
  const windowEnd = new Date(now.getTime() + query.minutesAhead * 60_000);

  const records = await (prisma as any).followUp.findMany({
    where: buildFollowUpWhere({
      workspaceId,
      userId: targetUserId,
      status: FOLLOWUP_PENDING,
      startDate: windowStart,
      endDate: windowEnd,
    }),
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    include: buildReminderInclude,
    take: 50,
  });

  const items = (records as ReminderFollowUpRecord[]).map(mapReminderFollowUpRecord);

  return {
    timeZone,
    generatedAt: now.toISOString(),
    window: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      minutesAhead: query.minutesAhead,
      includePastMinutes: query.includePastMinutes,
    },
    items,
  };
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

  const completed = await prisma.$transaction(async (tx: any) => {
    const updated = await (tx as any).followUp.update({
      where: { id: existing.id },
      data: {
        status: FOLLOWUP_COMPLETED,
        completedAt,
        completionDescription: input.description.trim(),
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

  await syncLeadNextFollowUpPointer(existing.leadId, workspaceId);

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

export const snoozeFollowUp = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  id: string,
  input: SnoozeFollowUpInput,
) => {
  await assertModuleReady();

  const existing = await (prisma as any).followUp.findFirst({
    where: { id, workspaceId },
    include: buildFollowUpInclude,
  });

  if (!existing) {
    throw createServiceError('Follow-up not found in this workspace.', 404);
  }
  if (existing.userId !== actor.id && !isManagerialRole(actor.role?.name)) {
    throw createServiceError('You are not allowed to snooze another user\'s follow-up.', 403);
  }
  if (existing.status === FOLLOWUP_COMPLETED) {
    throw createServiceError('Completed follow-ups cannot be snoozed.', 409);
  }
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw createServiceError('Snooze time must be in the future.', 422);
  }

  const leadForSchedule = await prisma.lead.findFirst({
    where: { id: existing.leadId, workspaceId, deletedAt: null },
    select: {
      lifecycleId: true,
      isClosed: true,
      isLOB: true,
      stageExpiresAt: true,
      stage: { select: { isClosed: true, isLOB: true } },
    },
  });

  if (leadForSchedule?.lifecycleId) {
    const { validateMandatoryFollowUpSchedule } = await import('./mandatoryFollowupContinuation.service');
    validateMandatoryFollowUpSchedule(leadForSchedule, input.scheduledAt);
  }

  const updated = await (prisma as any).followUp.update({
    where: { id: existing.id },
    data: {
      scheduledAt: input.scheduledAt,
      status: FOLLOWUP_PENDING,
    },
    include: buildFollowUpInclude,
  });

  const todayRange = await getDayRangeForWorkspace(workspaceId);
  const previousDateKey = moment(existing.scheduledAt).utc().format('YYYY-MM-DD');
  const nextDateKey = moment(input.scheduledAt).utc().format('YYYY-MM-DD');
  await invalidateTodayCache(workspaceId, existing.userId, [previousDateKey, nextDateKey, todayRange.cacheDateKey]);
  await syncLeadNextFollowUpPointer(existing.leadId, workspaceId);

  return mapFollowUpRecord(updated as FollowUpRecord);
};

export const touchFollowUpTodayCachesAfterLeadMutation = async (
  workspaceId: string,
  userId: string,
  scheduledAt: Date,
): Promise<void> => {
  const todayRange = await getDayRangeForWorkspace(workspaceId);
  const scheduleDateKey = moment(scheduledAt).utc().format('YYYY-MM-DD');
  await invalidateTodayCache(workspaceId, userId, [scheduleDateKey, todayRange.cacheDateKey]);
};
