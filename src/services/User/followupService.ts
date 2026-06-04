import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { normalizeFollowUpType } from '../../constants/followUpType';
import {
  buildAccessWhere,
  resolveManageableFollowUpUserScope,
  resolveVisibleLeadUserScope,
} from '../../modules/leads/leads.service';
import {
  buildCompletionOverdueUpdate,
  buildExtensionOverdueUpdate,
  ensureFollowUpOverdueFlagsBeforeAction,
  markPendingFollowUpsOverdueForWorkspace,
  shouldShowCalendarOverdueRed,
} from './followupOverduePersistence.service';
import { buildStageCalendarIndex } from './leadStageCalendar.util';
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
  recentDescription?: string | null;
  previousFollowupDate?: Date | null;
  newFollowupDate?: Date | null;
  snoozedBy?: string | null;
  snoozedAt?: Date | null;
  reminderActionType?: string | null;
  extensionReasonId?: string | null;
  extensionReasonName?: string | null;
  activityLogs?: any[];
  isOverdue?: boolean;
  overdueAt?: Date | null;
  completedAfterOverdue?: boolean;
  extendedAfterOverdue?: boolean;
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
    assignedToId?: string | null;
    assignedTo?: {
      id: string;
      name: string | null;
      username: string | null;
      email: string;
    } | null;
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
    'isOverdue',
    'overdueAt',
    'completedAfterOverdue',
    'extendedAfterOverdue',
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

export const mapFollowUpRecord = (record: FollowUpRecord) => ({
  ...record,
  type: normalizeFollowUpType(record.type),
  scheduledAt: record.scheduledAt.toISOString(),
  completedAt: record.completedAt ? record.completedAt.toISOString() : null,
  recentDescription: record.recentDescription || null,
  previousFollowupDate: record.previousFollowupDate ? record.previousFollowupDate.toISOString() : null,
  newFollowupDate: record.newFollowupDate ? record.newFollowupDate.toISOString() : null,
  snoozedBy: record.snoozedBy || null,
  snoozedAt: record.snoozedAt ? record.snoozedAt.toISOString() : null,
  reminderActionType: record.reminderActionType || null,
  extensionReasonId: record.extensionReasonId || null,
  extensionReasonName: record.extensionReasonName || null,
  isOverdue: Boolean(record.isOverdue),
  overdueAt: record.overdueAt ? record.overdueAt.toISOString() : null,
  completedAfterOverdue: Boolean(record.completedAfterOverdue),
  extendedAfterOverdue: Boolean(record.extendedAfterOverdue),
  activityLogs: (record as any).activityLogs?.map((log: any) => ({
    ...log,
    snoozedAt: log.snoozedAt.toISOString(),
    previousFollowupDate: log.previousFollowupDate.toISOString(),
    newFollowupDate: log.newFollowupDate.toISOString(),
    snoozedByUser: {
      ...log.snoozedByUser,
      displayName: resolveDisplayName(log.snoozedByUser),
    },
  })) || [],
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  user: {
    ...record.user,
    displayName: resolveDisplayName(record.user),
  },
  lead: {
    ...record.lead,
    assignedTo: record.lead?.assignedTo
      ? {
          ...record.lead.assignedTo,
          displayName: resolveDisplayName(record.lead.assignedTo),
        }
      : null,
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
      assignedToId: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
        },
      },
      stageId: true,
      stage: { select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true } },
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
  activityLogs: {
    orderBy: { snoozedAt: 'desc' as const },
    include: {
      snoozedByUser: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
        },
      },
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

export const getWorkspaceTimeZone = async (workspaceId: string): Promise<string> => {
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
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  requestedUserId?: string,
): Promise<string | string[] | 'ALL'> => {
  const manageableScope = await resolveManageableFollowUpUserScope(workspaceId, actor);

  if (requestedUserId === 'ALL') {
    return manageableScope;
  }

  if (!requestedUserId || requestedUserId === actor.id) {
    return actor.id;
  }

  if (manageableScope !== 'ALL' && !manageableScope.includes(requestedUserId)) {
    throw createServiceError('You are not allowed to access follow-ups for this user.', 403);
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
  userId?: string | string[] | 'ALL';
  leadAssignedToId?: string | { in: string[] };
  status?: FollowUpStatus;
  startDate?: Date;
  endDate?: Date;
}) => ({
  workspaceId: params.workspaceId,
  ...(params.userId && params.userId !== 'ALL'
    ? { userId: Array.isArray(params.userId) ? { in: params.userId } : params.userId }
    : {}),
  ...(params.leadAssignedToId
    ? {
        lead: {
          assignedToId:
            typeof params.leadAssignedToId === 'string'
              ? params.leadAssignedToId
              : params.leadAssignedToId,
        },
      }
    : {}),
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

/** Bulk reschedule: restrict follow-ups to leads owned by assignees in scope. */
export const resolveLeadAssigneeFilter = (
  requestedAssignedToId: string | undefined,
  manageableScope: string[] | 'ALL',
): { leadAssignedToId?: string | { in: string[] } } => {
  const normalized = (requestedAssignedToId || '').trim();

  if (!normalized || normalized.toUpperCase() === 'ALL') {
    if (manageableScope === 'ALL') {
      return {};
    }
    return { leadAssignedToId: { in: manageableScope } };
  }

  if (manageableScope !== 'ALL' && !manageableScope.includes(normalized)) {
    throw createServiceError('You are not allowed to view follow-ups for this assignee.', 403);
  }

  return { leadAssignedToId: normalized };
};

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

export const getFollowUpSettings = async (workspaceId: string) => {
  const { getSettings: fetchFollowUpSettings } = await import('../../modules/followup-settings/followupSettings.service');
  return await fetchFollowUpSettings(workspaceId);
};

export const getUserFollowUpCountOnDate = async (
  workspaceId: string,
  userId: string,
  date: Date,
  excludeFollowUpId?: string,
): Promise<number> => {
  const range = await getDayRangeForWorkspace(workspaceId, date);
  const where: any = {
    workspaceId,
    userId,
    scheduledAt: {
      gte: range.start,
      lte: range.end,
    },
  };

  if (excludeFollowUpId) {
    where.id = { not: excludeFollowUpId };
  }

  return await (prisma as any).followUp.count({ where });
};

export const checkUserCapacity = async (
  workspaceId: string,
  userId: string,
  date: Date,
  additionalCount = 1,
  excludeFollowUpId?: string,
) => {
  const settings = await getFollowUpSettings(workspaceId);
  if (!settings || !settings.isActive || !settings.dailyLimitEnabled) {
    return { hasCapacity: true, remaining: 999999, limit: 999999, existingCount: 0 };
  }

  const existingCount = await getUserFollowUpCountOnDate(workspaceId, userId, date, excludeFollowUpId);
  const remaining = settings.dailyLimitCount - existingCount;

  const hasCapacity = !settings.capacityValidationEnabled || (remaining >= additionalCount);

  return {
    hasCapacity,
    remaining,
    limit: settings.dailyLimitCount,
    existingCount,
  };
};

export const createFollowUp = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
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

  const { validateFollowUpLifecycleExtension } = await import('./followupLifecycleValidation.service');
  await validateFollowUpLifecycleExtension(workspaceId, input.leadId.trim(), input.scheduledAt, actor);

  const { getWorkspaceHolidays } = await import('../../modules/holidays/holidays.service');
  const { isHolidayOnDate } = await import('../../modules/holidays/weeklyOff.util');
  const { format } = await import('date-fns');
  const holidays = await getWorkspaceHolidays(workspaceId, { activeOnly: true });
  const holidayDateStr = format(new Date(input.scheduledAt), 'yyyy-MM-dd');
  if (isHolidayOnDate(holidays, holidayDateStr)) {
    throw createServiceError('Follow-ups cannot be scheduled on a holiday.', 422);
  }

  const userId = await resolveTargetUserId(workspaceId, actor);

  const capacity = await checkUserCapacity(workspaceId, userId, input.scheduledAt);
  if (!capacity.hasCapacity) {
    throw createServiceError('You have reached your daily follow-up limit for today.', 422);
  }

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

const formatFollowUpUserDisplayName = (user: {
  name?: string | null;
  username?: string | null;
  email?: string | null;
}): string => {
  const fullName = user.name?.trim() || '';
  const username = user.username?.trim() || '';
  const email = user.email?.trim() || '';
  const primary = fullName || username || email;
  const extras: string[] = [];

  if (username && username !== primary) {
    extras.push(username);
  }
  if (email && email !== primary && email !== username) {
    extras.push(email);
  }

  return extras.length > 0 ? `${primary} (${extras.join(' · ')})` : primary;
};

export const getFollowUpUsers = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
) => {
  await assertModuleReady();

  const manageableScope = await resolveManageableFollowUpUserScope(workspaceId, actor);

  const actorProfile = await prisma.user.findFirst({
    where: { id: actor.id, workspaceId },
    select: { supervisorId: true },
  });

  console.info('[BulkReschedule] getFollowUpUsers', {
    actorId: actor.id,
    role: actor.role?.name ?? null,
    workspaceId,
    supervisorId: actorProfile?.supervisorId ?? null,
    scope: manageableScope === 'ALL' ? 'ALL' : manageableScope.length,
    userIds: manageableScope === 'ALL' ? 'ALL' : manageableScope,
  });

  const where: any = {
    workspaceId,
    deletedAt: null,
    isActive: true,
  };

  if (manageableScope !== 'ALL') {
    where.id = { in: manageableScope };
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  });

  const mapped = users.map((user) => ({
    ...user,
    displayName: formatFollowUpUserDisplayName(user),
  }));

  console.info('[BulkReschedule] getFollowUpUsers result', {
    actorId: actor.id,
    returnedCount: mapped.length,
    returnedUserIds: mapped.map((user) => user.id),
  });

  return mapped;
};

export const getAdvancedCalendarSummary = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  query: AdvancedCalendarSummaryInput,
) => {
  await assertModuleReady();

  await markPendingFollowUpsOverdueForWorkspace(workspaceId);

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const leadAccess = await buildAccessWhere(workspaceId, actor);
  const leadAccessFilter =
    Object.keys(leadAccess).length > 0 ? { deletedAt: null, ...leadAccess } : { deletedAt: null };

  const groupDate = (date: Date) => moment.tz(date, timeZone).format('YYYY-MM-DD');

  const [stages, leadsCreated, stageHistory, followUps] = await Promise.all([
    (prisma as any).leadStage.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true },
    }),
    (prisma as any).lead.findMany({
      where: {
        workspaceId,
        createdById: targetUserId,
        createdAt: { gte: query.startDate, lte: query.endDate },
        ...leadAccessFilter,
      },
      select: {
        createdAt: true,
        stageId: true,
        stage: { select: { name: true, color: true, stageShortForm: true, showInCalendar: true } },
      },
    }),
    (prisma as any).leadStageHistory.findMany({
      where: {
        workspaceId,
        changedById: targetUserId,
        changedAt: { gte: query.startDate, lte: query.endDate },
        lead: leadAccessFilter,
      },
      select: { changedAt: true, toStageId: true, toStageName: true },
    }),
    (prisma as any).followUp.findMany({
      where: {
        ...buildFollowUpWhere({
          workspaceId,
          userId: targetUserId,
          startDate: query.startDate,
          endDate: query.endDate,
        }),
        lead: leadAccessFilter,
      },
      select: {
        scheduledAt: true,
        previousFollowupDate: true,
        snoozedAt: true,
        status: true,
        isOverdue: true,
        overdueAt: true,
        completedAfterOverdue: true,
        extendedAfterOverdue: true,
        lead: {
          select: {
            stageId: true,
            stage: { select: { name: true, color: true, stageShortForm: true, showInCalendar: true } },
          },
        },
      },
    }),
  ]);

  const stageCalendar = buildStageCalendarIndex(stages);
  const stageColorMap = Object.fromEntries(
    stages.map((s: any) => [s.id, { color: s.color, name: s.name, stageShortForm: s.stageShortForm, showInCalendar: s.showInCalendar }]),
  );

  const summaryByDate: Record<
    string,
    {
      leadsCreated: number;
      leadsCreatedByStage: Record<string, { count: number; name: string; shortForm: string; color: string }>;
      totalFollowUps: number;
      stageTransitions: Record<string, { count: number; name: string; shortForm: string; color: string }>;
      stageFollowUps: Record<
        string,
        {
          count: number;
          name: string;
          shortForm: string;
          color: string;
          overdueExtendedCount: number;
          overdueHistoryCount: number;
        }
      >;
    }
  > = {};

  const ensureDate = (d: string) => {
    if (!summaryByDate[d]) {
      summaryByDate[d] = {
        leadsCreated: 0,
        leadsCreatedByStage: {},
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
    const stageId = l.stageId;
    if (!stageId || !stageCalendar.isVisible(stageId)) return;
    if (!summaryByDate[d].leadsCreatedByStage[stageId]) {
      summaryByDate[d].leadsCreatedByStage[stageId] = {
        count: 0,
        name: stageCalendar.fullName(stageId, l.stage?.name),
        shortForm: stageCalendar.label(stageId, l.stage?.name),
        color: l.stage?.color || stageColorMap[stageId]?.color || '#cbd5e1',
      };
    }
    summaryByDate[d].leadsCreatedByStage[stageId].count += 1;
  });

  followUps.forEach((f: any) => {
    const d = groupDate(f.scheduledAt);
    ensureDate(d);
    summaryByDate[d].totalFollowUps += 1;

    const stageId = f.lead?.stageId;
    if (stageId && stageCalendar.isVisible(stageId)) {
      if (!summaryByDate[d].stageFollowUps[stageId]) {
        summaryByDate[d].stageFollowUps[stageId] = {
          count: 0,
          name: stageCalendar.fullName(stageId, f.lead.stage?.name),
          shortForm: stageCalendar.label(stageId, f.lead.stage?.name),
          color: f.lead.stage?.color || '#cbd5e1',
          overdueExtendedCount: 0,
          overdueHistoryCount: 0,
        };
      }
      summaryByDate[d].stageFollowUps[stageId].count += 1;
      if (shouldShowCalendarOverdueRed(f, timeZone)) {
        summaryByDate[d].stageFollowUps[stageId].overdueHistoryCount += 1;
        if (f.extendedAfterOverdue) {
          summaryByDate[d].stageFollowUps[stageId].overdueExtendedCount += 1;
        }
      }
    }
  });

  stageHistory.forEach((h: any) => {
    const stageId = h.toStageId;
    if (stageId && stageCalendar.isVisible(stageId)) {
      const d = groupDate(h.changedAt);
      ensureDate(d);
      if (!summaryByDate[d].stageTransitions[stageId]) {
        summaryByDate[d].stageTransitions[stageId] = {
          count: 0,
          name: stageCalendar.fullName(stageId, h.toStageName),
          shortForm: stageCalendar.label(stageId, h.toStageName),
          color: stageColorMap[stageId]?.color || '#cbd5e1',
        };
      }
      summaryByDate[d].stageTransitions[stageId].count += 1;
    }
  });

  const formattedSummary = Object.entries(summaryByDate).map(([date, data]) => ({
    date,
    leadsCreated: data.leadsCreated,
    leadsCreatedByStage: Object.entries(data.leadsCreatedByStage).map(([id, info]) => ({
      stageId: id,
      ...info,
    })),
    totalFollowUps: data.totalFollowUps,
    stageTransitions: Object.entries(data.stageTransitions).map(([id, info]) => ({
      stageId: id,
      ...info,
    })),
    stageFollowUps: Object.entries(data.stageFollowUps).map(([id, info]) => ({
      stageId: id,
      count: info.count,
      name: info.name,
      shortForm: info.shortForm,
      color: info.color,
      overdueExtendedCount: info.overdueExtendedCount,
      overdueHistoryCount: info.overdueHistoryCount,
    })),
  }));

  const stageFollowUpTotals: Record<string, number> = {};
  const stageLeadCreationTotals: Record<string, number> = {};
  let overdueFollowUpTotal = 0;

  formattedSummary.forEach((day) => {
    day.stageFollowUps.forEach((row) => {
      stageFollowUpTotals[row.stageId] = (stageFollowUpTotals[row.stageId] || 0) + row.count;
      overdueFollowUpTotal += row.overdueHistoryCount || 0;
    });
    day.leadsCreatedByStage.forEach((row) => {
      stageLeadCreationTotals[row.stageId] = (stageLeadCreationTotals[row.stageId] || 0) + row.count;
    });
    day.stageTransitions.forEach((row) => {
      stageLeadCreationTotals[row.stageId] =
        (stageLeadCreationTotals[row.stageId] || 0) + row.count;
    });
  });

  return {
    timeZone,
    summary: formattedSummary,
    analytics: {
      stageFollowUpCounts: Object.entries(stageFollowUpTotals).map(([stageId, count]) => ({
        stageId,
        count,
        name: stageColorMap[stageId]?.name || 'Unknown Stage',
        color: stageColorMap[stageId]?.color || '#cbd5e1',
      })),
      stageLeadCreationCounts: Object.entries(stageLeadCreationTotals).map(([stageId, count]) => ({
        stageId,
        count,
        name: stageColorMap[stageId]?.name || 'Unknown Stage',
        color: stageColorMap[stageId]?.color || '#cbd5e1',
      })),
      overdueFollowUpCounts: overdueFollowUpTotal,
      followUpDelayAnalytics: {
        overdueExtendedTotal: overdueFollowUpTotal,
      },
    },
  };
};

export const getAdvancedCalendarDetails = async (
  workspaceId: string,
  actor: { id: string; role?: { name?: string | null } | null },
  query: AdvancedCalendarDetailsInput,
) => {
  await assertModuleReady();

  await markPendingFollowUpsOverdueForWorkspace(workspaceId);

  const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const skip = (query.page - 1) * query.limit;

  const targetDateStr = moment.utc(query.date).format('YYYY-MM-DD');
  const startOfDay = moment.tz(targetDateStr, timeZone).startOf('day').toDate();
  const endOfDay = moment.tz(targetDateStr, timeZone).endOf('day').toDate();

  let items = [];
  let total = 0;

  const leadAccess = await buildAccessWhere(workspaceId, actor);
  const leadAccessFilter =
    Object.keys(leadAccess).length > 0 ? { deletedAt: null, ...leadAccess } : { deletedAt: null };

  const { mapCalendarFollowUpDetail } = await import('./overdueFollowup.service');

  const stages = await (prisma as any).leadStage.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true },
  });
  const stageCalendar = buildStageCalendarIndex(stages);

  const enrichStage = (stage: any) =>
    stage?.id
      ? {
          ...stage,
          name: stageCalendar.fullName(stage.id, stage.name),
          stageShortForm: stageCalendar.shortForm(stage.id),
          calendarLabel: stageCalendar.label(stage.id, stage.name),
        }
      : null;

  if (query.type === 'LEADS_CREATED' || query.type === 'LEAD_STAGE_CREATED') {
    const where: any = {
      workspaceId,
      createdById: targetUserId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      ...leadAccessFilter,
    };
    if (query.type === 'LEAD_STAGE_CREATED' && query.stageId) {
      where.stageId = query.stageId;
    }
    [total, items] = await Promise.all([
      (prisma as any).lead.count({ where }),
      (prisma as any).lead.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          stage: { select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true } },
          assignedTo: { select: { name: true, email: true } },
          createdBy: { select: { name: true, email: true } },
        },
      }),
    ]);
    if (query.type === 'LEAD_STAGE_CREATED' && query.stageId && !stageCalendar.isVisible(query.stageId)) {
      return {
        items: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
      };
    }

    items = items.map((lead: any) => {
      const stage = enrichStage(lead.stage);
      return {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        customerName: lead.email?.trim() || lead.phone?.trim() || lead.name,
        stage,
        currentStage: stage,
        previousStage: null,
        createdBy: lead.createdBy,
        changedBy: lead.createdBy,
        createdAt: lead.createdAt,
      };
    });
  } else if (query.type === 'STAGE_CREATED') {
    if (query.stageId && !stageCalendar.isVisible(query.stageId)) {
      return {
        items: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
      };
    }

    const historyWhere = {
      workspaceId,
      changedById: targetUserId,
      changedAt: { gte: startOfDay, lte: endOfDay },
      toStageId: query.stageId,
      lead: leadAccessFilter,
    };
    const [historyTotal, historyRows] = await Promise.all([
      (prisma as any).leadStageHistory.count({ where: historyWhere }),
      (prisma as any).leadStageHistory.findMany({
        where: historyWhere,
        skip,
        take: query.limit,
        orderBy: { changedAt: 'desc' },
        include: {
          lead: {
            include: {
              stage: { select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true } },
              assignedTo: { select: { name: true, email: true } },
            },
          },
        },
      }),
    ]);
    total = historyTotal;
    items = historyRows.map((row: any) => {
        const currentStage = enrichStage({
          id: row.toStageId,
          name: row.toStageName,
          color: row.lead?.stage?.color,
          stageShortForm: stageCalendar.shortForm(row.toStageId),
          showInCalendar: true,
        });
        const previousStage = row.fromStageId
          ? enrichStage({
              id: row.fromStageId,
              name: row.fromStageName,
              color: row.lead?.stage?.color,
              stageShortForm: stageCalendar.shortForm(row.fromStageId),
              showInCalendar: true,
            })
          : row.fromStageName
            ? { name: row.fromStageName, id: row.fromStageId }
            : null;

        return {
          id: row.leadId,
          name: row.lead?.name,
          email: row.lead?.email,
          phone: row.lead?.phone,
          customerName: row.lead?.email?.trim() || row.lead?.phone?.trim() || row.lead?.name,
          stage: row.lead?.stage ? enrichStage(row.lead.stage) : currentStage,
          currentStage,
          previousStage,
          changedBy: { name: row.changedById },
          createdBy: row.lead?.assignedTo,
          changedAt: row.changedAt,
        };
      });
  } else if (query.type === 'TOTAL_FOLLOWUPS' || query.type === 'STAGE_FOLLOWUPS') {
    if (query.type === 'STAGE_FOLLOWUPS' && query.stageId && !stageCalendar.isVisible(query.stageId)) {
      return {
        items: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
      };
    }

    const where: any = {
      workspaceId,
      userId: targetUserId,
      scheduledAt: { gte: startOfDay, lte: endOfDay },
      lead: leadAccessFilter,
    };
    if (query.type === 'STAGE_FOLLOWUPS' && query.stageId) {
      where.lead = { ...leadAccessFilter, stageId: query.stageId };
    }
    const allRows = await (prisma as any).followUp.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: buildFollowUpInclude,
    });
    const filteredRows =
      query.overdueExtendedOnly === true
        ? allRows.filter((row: any) => shouldShowCalendarOverdueRed(row, timeZone))
        : allRows;
    total = filteredRows.length;
    items = filteredRows.slice(skip, skip + query.limit).map((i: any) => mapCalendarFollowUpDetail(i, timeZone));
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
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const refreshed = await ensureFollowUpOverdueFlagsBeforeAction({
    ...existing,
    workspaceId,
  });
  const overdueUpdate = buildCompletionOverdueUpdate(refreshed, completedAt, timeZone);

  logger.info('[OverdueFollowUp] before complete', {
    followUpId: existing.id,
    userId: existing.userId,
    status: refreshed.status,
    scheduledAt: refreshed.scheduledAt,
    isOverdue: refreshed.isOverdue,
  });

  const completed = await prisma.$transaction(async (tx: any) => {
    const updated = await (tx as any).followUp.update({
      where: { id: existing.id },
      data: {
        status: FOLLOWUP_COMPLETED,
        completedAt,
        completionDescription: input.description.trim(),
        ...overdueUpdate,
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

  const { invalidateOverdueFollowUpCache } = await import('../../middlewares/overdueFollowupMiddleware');
  invalidateOverdueFollowUpCache(existing.userId);

  logger.info('[OverdueFollowUp] after complete', {
    followUpId: existing.id,
    userId: existing.userId,
    status: (completed as FollowUpRecord).status,
    completedAt: (completed as FollowUpRecord).completedAt,
    isOverdue: (completed as FollowUpRecord).isOverdue,
  });

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
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  query: HistoryQueryInput,
) => {
  await assertModuleReady();

  const skip = (query.page - 1) * query.limit;
  const useLeadAssigneeFilter = query.assignedToId !== undefined;

  let where: ReturnType<typeof buildFollowUpWhere>;

  if (useLeadAssigneeFilter) {
    const manageableScope = await resolveManageableFollowUpUserScope(workspaceId, actor);
    const leadAssignee = resolveLeadAssigneeFilter(query.assignedToId, manageableScope);

    console.info('[BulkReschedule] getHistory lead assignee filter', {
      actorId: actor.id,
      role: actor.role?.name ?? null,
      workspaceId,
      requestedAssignedToId: query.assignedToId || 'ALL',
      scope: manageableScope === 'ALL' ? 'ALL' : manageableScope.length,
      leadAssigneeFilter: leadAssignee.leadAssignedToId ?? 'ALL',
    });

    where = buildFollowUpWhere({
      workspaceId,
      status: query.status,
      startDate: query.startDate,
      endDate: query.endDate,
      ...leadAssignee,
    });
  } else {
    const targetUserId = await resolveTargetUserId(workspaceId, actor, query.userId);
    where = buildFollowUpWhere({
      workspaceId,
      userId: targetUserId,
      status: query.status,
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

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
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
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
  if (input.scheduledAt.getTime() === existing.scheduledAt.getTime()) {
    throw createServiceError('The new follow-up date must be different from the current scheduled date.', 422);
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

  const { validateFollowUpLifecycleExtension } = await import('./followupLifecycleValidation.service');
  await validateFollowUpLifecycleExtension(workspaceId, existing.leadId, input.scheduledAt, actor, {
    followUpId: existing.id,
  });

  const capacity = await checkUserCapacity(workspaceId, existing.userId, input.scheduledAt, 1, existing.id);
  if (!capacity.hasCapacity) {
    throw createServiceError('You have reached your daily follow-up limit for today.', 422);
  }

  let extensionReasonName: string | null = null;
  if (input.extensionReasonId) {
    const reason = await (prisma as any).followUpExtensionReason.findFirst({
      where: {
        id: input.extensionReasonId,
        workspaceId,
      },
      select: { reasonName: true },
    });
    if (reason) {
      extensionReasonName = reason.reasonName;
    }
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const snoozedAt = new Date();
  const refreshed = await ensureFollowUpOverdueFlagsBeforeAction({
    ...existing,
    workspaceId,
  });
  const overdueUpdate = buildExtensionOverdueUpdate(
    refreshed,
    existing.scheduledAt,
    input.scheduledAt,
    snoozedAt,
    timeZone,
  );

  logger.info('[OverdueFollowUp] before extend', {
    followUpId: existing.id,
    userId: existing.userId,
    status: refreshed.status,
    scheduledAt: refreshed.scheduledAt,
    isOverdue: refreshed.isOverdue,
    newScheduledAt: input.scheduledAt,
  });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.followupActivityLog.create({
      data: {
        followUpId: existing.id,
        workspaceId,
        previousFollowupDate: existing.scheduledAt,
        newFollowupDate: input.scheduledAt,
        snoozedById: actor.id,
        recentDescription: input.recentDescription || '',
        previousDescription: existing.recentDescription || existing.description || null,
        reminderActionType: input.reminderActionType,
        extensionReasonId: input.extensionReasonId || null,
        extensionReasonName,
      },
    });

    return await (tx as any).followUp.update({
      where: { id: existing.id },
      data: {
        scheduledAt: input.scheduledAt,
        status: FOLLOWUP_PENDING,
        recentDescription: input.recentDescription || null,
        previousFollowupDate: existing.scheduledAt,
        newFollowupDate: input.scheduledAt,
        snoozedBy: actor.id,
        snoozedAt,
        reminderActionType: input.reminderActionType,
        extensionReasonId: input.extensionReasonId || null,
        extensionReasonName,
        ...overdueUpdate,
      },
      include: buildFollowUpInclude,
    });
  });

  const todayRange = await getDayRangeForWorkspace(workspaceId);
  const previousDateKey = moment(existing.scheduledAt).utc().format('YYYY-MM-DD');
  const nextDateKey = moment(input.scheduledAt).utc().format('YYYY-MM-DD');
  await invalidateTodayCache(workspaceId, existing.userId, [previousDateKey, nextDateKey, todayRange.cacheDateKey]);
  await syncLeadNextFollowUpPointer(existing.leadId, workspaceId);

  const { invalidateOverdueFollowUpCache } = await import('../../middlewares/overdueFollowupMiddleware');
  invalidateOverdueFollowUpCache(existing.userId);

  logger.info('[OverdueFollowUp] after extend', {
    followUpId: existing.id,
    userId: existing.userId,
    status: (updated as FollowUpRecord).status,
    scheduledAt: (updated as FollowUpRecord).scheduledAt,
    isOverdue: (updated as FollowUpRecord).isOverdue,
    extendedAfterOverdue: (updated as FollowUpRecord).extendedAfterOverdue,
  });

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

export const bulkExtendFollowUps = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  input: {
    followUpIds: string[];
    newFollowupDate: Date;
    extensionReasonId?: string | null;
    recentDescription?: string | null;
    autoDistribute?: boolean;
  },
) => {
  await assertModuleReady();

  const settings = await getFollowUpSettings(workspaceId);
  const maxLimit = settings?.maxBulkExtensionCount ?? 100;
  if (input.followUpIds.length > maxLimit) {
    throw createServiceError(`Cannot extend more than ${maxLimit} follow-ups in a single bulk operation.`, 422);
  }

  const followUps = await (prisma as any).followUp.findMany({
    where: {
      id: { in: input.followUpIds },
      workspaceId,
      status: { not: FOLLOWUP_COMPLETED },
    },
    select: {
      id: true,
      userId: true,
      leadId: true,
      scheduledAt: true,
      recentDescription: true,
      description: true,
      isOverdue: true,
      overdueAt: true,
      completedAfterOverdue: true,
      extendedAfterOverdue: true,
    },
  });

  if (followUps.length === 0) {
    throw createServiceError('No matching pending follow-ups found to extend.', 404);
  }

  await markPendingFollowUpsOverdueForWorkspace(workspaceId);

  let extensionReasonName: string | null = null;
  if (input.extensionReasonId) {
    const reason = await (prisma as any).followUpExtensionReason.findFirst({
      where: { id: input.extensionReasonId, workspaceId },
    });
    if (reason) {
      extensionReasonName = reason.reasonName;
    }
  }

  const followUpsByUser: Record<string, typeof followUps> = {};
  for (const f of followUps) {
    if (!followUpsByUser[f.userId]) {
      followUpsByUser[f.userId] = [];
    }
    followUpsByUser[f.userId].push(f);
  }

  const successIds: string[] = [];
  const blockedIds: string[] = [];
  const lifecycleBlockedIds: string[] = [];
  const allocations: { followUpId: string; newDate: Date }[] = [];

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const { validateFollowUpLifecycleExtension } = await import('./followupLifecycleValidation.service');

  const validateLifecycleForDate = async (followUpRow: { id: string; leadId: string }, targetDate: Date) => {
    try {
      await validateFollowUpLifecycleExtension(workspaceId, followUpRow.leadId, targetDate, actor, {
        followUpId: followUpRow.id,
        allowPast: false,
      });
      return true;
    } catch (error: any) {
      if (error?.errorCode?.startsWith('LIFECYCLE_EXTENSION')) {
        lifecycleBlockedIds.push(followUpRow.id);
        return false;
      }
      throw error;
    }
  };

  for (const userId of Object.keys(followUpsByUser)) {
    const userFollowUps = followUpsByUser[userId];
    let currentDate = moment.tz(input.newFollowupDate, timeZone).startOf('day').toDate();
    let unassigned = [...userFollowUps];

    while (unassigned.length > 0) {
      if (!settings || !settings.isActive || !settings.dailyLimitEnabled || !settings.capacityValidationEnabled) {
        for (const f of unassigned) {
          const allowed = await validateLifecycleForDate(f, currentDate);
          if (!allowed) continue;
          allocations.push({ followUpId: f.id, newDate: currentDate });
          successIds.push(f.id);
        }
        break;
      }

      const existingCount = await getUserFollowUpCountOnDate(workspaceId, userId, currentDate, undefined);
      const capacity = Math.max(0, settings.dailyLimitCount - existingCount);

      if (capacity > 0) {
        const toAllocate = unassigned.slice(0, capacity);
        for (const f of toAllocate) {
          const allowed = await validateLifecycleForDate(f, currentDate);
          if (!allowed) continue;
          allocations.push({ followUpId: f.id, newDate: currentDate });
          successIds.push(f.id);
        }
        unassigned = unassigned.slice(capacity);
      }

      if (unassigned.length > 0) {
        if (input.autoDistribute) {
          currentDate = moment(currentDate).add(1, 'day').toDate();
        } else {
          for (const f of unassigned) {
            blockedIds.push(f.id);
          }
          break;
        }
      }
    }
  }

  if (allocations.length === 0) {
    throw createServiceError('Selected date has capacity for only 0 additional follow-ups. All selected follow-ups could not be reassigned.', 422);
  }

  await prisma.$transaction(async (tx) => {
    const snoozedAt = new Date();
    for (const alloc of allocations) {
      const orig = followUps.find((f: any) => f.id === alloc.followUpId)!;
      const overdueUpdate = buildExtensionOverdueUpdate(
        orig,
        orig.scheduledAt,
        alloc.newDate,
        snoozedAt,
        timeZone,
      );

      await (tx as any).followUp.update({
        where: { id: alloc.followUpId },
        data: {
          scheduledAt: alloc.newDate,
          status: FOLLOWUP_PENDING,
          recentDescription: input.recentDescription || null,
          previousFollowupDate: orig.scheduledAt,
          newFollowupDate: alloc.newDate,
          snoozedBy: actor.id,
          snoozedAt,
          reminderActionType: 'BULK_EXTEND',
          extensionReasonId: input.extensionReasonId || null,
          extensionReasonName,
          ...overdueUpdate,
        },
      });

      await tx.followupActivityLog.create({
        data: {
          followUpId: alloc.followUpId,
          workspaceId,
          previousFollowupDate: orig.scheduledAt,
          newFollowupDate: alloc.newDate,
          snoozedById: actor.id,
          recentDescription: input.recentDescription || 'Bulk Extension',
          previousDescription: orig.recentDescription || orig.description || null,
          reminderActionType: 'BULK_EXTEND',
          extensionReasonId: input.extensionReasonId || null,
          extensionReasonName,
        },
      });
    }

    await (tx as any).bulkFollowUpExtension.create({
      data: {
        workspaceId,
        userId: actor.id,
        targetDate: input.newFollowupDate,
        extensionReasonId: input.extensionReasonId || null,
        extensionReasonName,
        customReason: input.recentDescription || null,
        followupCount: allocations.length,
        autoDistributed: !!input.autoDistribute,
      },
    });

    await (tx as any).auditLog.create({
      data: {
        userId: actor.id,
        workspaceId,
        action: 'BULK_FOLLOWUP_EXTENDED',
        entityType: 'BulkFollowUpExtension',
        details: {
          followUpIds: input.followUpIds,
          successCount: successIds.length,
          blockedCount: blockedIds.length,
          targetDate: input.newFollowupDate,
          autoDistributed: !!input.autoDistribute,
        },
      },
    });
  });

  const { invalidateOverdueFollowUpCache } = await import('../../middlewares/overdueFollowupMiddleware');
  const affectedUserIds = new Set<string>(
    followUps
      .filter((row: any) => successIds.includes(row.id))
      .map((row: any) => String(row.userId)),
  );
  affectedUserIds.forEach((userId) => invalidateOverdueFollowUpCache(userId));

  let message = `Successfully reassigned ${successIds.length} follow-up(s).`;
  if (lifecycleBlockedIds.length > 0) {
    message += ` ${lifecycleBlockedIds.length} follow-up(s) exceeded lifecycle limits for their current stage.`;
  }
  if (blockedIds.length > 0) {
    const originalTargetCapacity = settings?.dailyLimitCount ?? 10;
    const initialTargetExisting = await getUserFollowUpCountOnDate(workspaceId, followUps[0].userId, input.newFollowupDate);
    const targetCapacity = Math.max(0, originalTargetCapacity - initialTargetExisting);

    message = `Selected date has capacity for only ${targetCapacity} additional follow-ups. ${blockedIds.length} follow-ups could not be reassigned.`;
  }

  return {
    success: true,
    message,
    successCount: successIds.length,
    blockedCount: blockedIds.length,
    successIds,
    blockedIds,
  };
};

export const getTodayUtilization = async (workspaceId: string, userId: string) => {
  const todayRange = await getDayRangeForWorkspace(workspaceId, new Date());
  const count = await (prisma as any).followUp.count({
    where: {
      workspaceId,
      userId,
      scheduledAt: {
        gte: todayRange.start,
        lte: todayRange.end,
      },
    },
  });

  const settings = await getFollowUpSettings(workspaceId);
  return {
    count,
    limit: settings?.dailyLimitCount ?? 10,
    limitEnabled: !!settings?.dailyLimitEnabled && !!settings?.isActive,
  };
};

export const getBulkExtensionReport = async (workspaceId: string, filters: { startDate?: string; endDate?: string }) => {
  const where: any = { workspaceId };
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.createdAt.lte = new Date(filters.endDate);
    }
  }

  return await (prisma as any).bulkFollowUpExtension.findMany({
    where,
    include: {
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const getFollowUpCapacityReport = async (
  workspaceId: string,
  filters: { startDate?: string; endDate?: string; userId?: string },
) => {
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const startDate = filters.startDate
    ? moment.tz(filters.startDate, timeZone).startOf('day')
    : moment().tz(timeZone).subtract(7, 'days').startOf('day');
  const endDate = filters.endDate
    ? moment.tz(filters.endDate, timeZone).endOf('day')
    : moment().tz(timeZone).endOf('day');

  const settings = await getFollowUpSettings(workspaceId);
  const limit = settings?.dailyLimitCount ?? 10;
  const limitEnabled = !!settings?.dailyLimitEnabled && !!settings?.isActive;

  const where: any = {
    workspaceId,
    scheduledAt: {
      gte: startDate.toDate(),
      lte: endDate.toDate(),
    },
  };
  if (filters.userId) {
    where.userId = filters.userId;
  }

  const followUps = await (prisma as any).followUp.findMany({
    where,
    select: { scheduledAt: true, userId: true, user: { select: { name: true, email: true } } },
  });

  const grouped: Record<
    string,
    { date: string; userName: string; count: number; limit: number; remaining: number; utilizationPercent: number }
  > = {};

  for (const f of followUps) {
    const dateKey = moment(f.scheduledAt).tz(timeZone).format('YYYY-MM-DD');
    const userName = f.user?.name || f.user?.email || 'Unknown';
    const groupKey = `${dateKey}_${f.userId}`;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        date: dateKey,
        userName,
        count: 0,
        limit,
        remaining: limit,
        utilizationPercent: 0,
      };
    }
    grouped[groupKey].count++;
  }

  const result = Object.values(grouped).map((item) => {
    const remaining = Math.max(0, item.limit - item.count);
    const utilizationPercent = item.limit > 0 ? Math.round((item.count / item.limit) * 100) : 0;
    return {
      ...item,
      remaining,
      utilizationPercent,
      limitEnabled,
    };
  });

  result.sort((a, b) => b.date.localeCompare(a.date));

  return result;
};

export const getDailyFollowUpUtilization = async (
  workspaceId: string,
  filters: { startDate?: string; endDate?: string; userId?: string },
) => {
  return await getFollowUpCapacityReport(workspaceId, filters);
};

export const getUserFollowUpLimitReport = async (workspaceId: string) => {
  const users = await prisma.user.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, email: true, role: { select: { name: true } } },
  });

  const settings = await getFollowUpSettings(workspaceId);
  const limit = settings?.dailyLimitCount ?? 10;
  const limitEnabled = !!settings?.dailyLimitEnabled && !!settings?.isActive;

  const result = [];
  for (const u of users) {
    const next7DaysCount = await (prisma as any).followUp.count({
      where: {
        workspaceId,
        userId: u.id,
        scheduledAt: {
          gte: moment().startOf('day').toDate(),
          lte: moment().add(7, 'days').endOf('day').toDate(),
        },
      },
    });

    const avgDailyCount = Math.round((next7DaysCount / 8) * 10) / 10;

    result.push({
      userId: u.id,
      userName: u.name || u.email,
      userEmail: u.email,
      roleName: u.role?.name || 'Staff',
      limit,
      limitEnabled,
      avgDailyCount,
      utilizationPercent: limit > 0 ? Math.round((avgDailyCount / limit) * 100) : 0,
    });
  }

  return result;
};
