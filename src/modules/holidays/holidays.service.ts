import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { eachDayOfInterval, format } from 'date-fns';
import {
  appendWeeklyOffCalendarItems,
  getWorkspaceWeeklyOffSettings,
  isHolidayOnDate,
  isWeeklyOffDate,
  normalizeWeeklyOffColor,
  normalizeWeeklyOffDays,
  updateWorkspaceWeeklyOffSettings,
} from './weeklyOff.util';
import { redisClient } from '../../config/redis';

const createHolidayServiceError = (message: string, statusCode = 400): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const DEFAULT_HOLIDAY_COLOR = '#fda4af';
let holidayColorColumnExistsCache: boolean | null = null;

const normalizeHolidayDate = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw createHolidayServiceError('Holiday date is required.');
  }

  const trimmedValue = value.trim();
  const isoDateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);
  if (isoDateOnlyMatch) {
    const [, year, month, day] = isoDateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const parsedDate = new Date(trimmedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    throw createHolidayServiceError('Holiday date must be a valid date.');
  }

  return parsedDate;
};

const normalizeHolidayPayload = <T extends Record<string, any>>(data: T): T => ({
  ...data,
  holidayDate: normalizeHolidayDate(data.holidayDate),
  color: normalizeHolidayColor(data.color),
});

const normalizeHolidayColor = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_HOLIDAY_COLOR;
  }

  const trimmedValue = value.trim();
  const normalizedValue = trimmedValue.startsWith('#') ? trimmedValue : `#${trimmedValue}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalizedValue)) {
    throw createHolidayServiceError('Holiday color must be a valid 6-digit hex color.');
  }

  return normalizedValue.toLowerCase();
};

const withHolidayColor = <T extends Record<string, any>>(holiday: T): T & { color: string } => ({
  ...holiday,
  color: typeof holiday.color === 'string' && holiday.color.trim() ? holiday.color : DEFAULT_HOLIDAY_COLOR,
});

const hasHolidayColorColumn = async (): Promise<boolean> => {
  if (holidayColorColumnExistsCache !== null) {
    return holidayColorColumnExistsCache;
  }

  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>(Prisma.sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'holidays'
      AND column_name = 'color'
  `);

  holidayColorColumnExistsCache = rows.length > 0;
  return holidayColorColumnExistsCache;
};

const selectHolidayByIdLegacy = async (id: string) => {
  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    SELECT
      id,
      "workspaceId",
      name,
      "holidayDate",
      "countryId",
      "stateId",
      "districtId",
      "isRecurring",
      "recurrenceRule",
      source::text AS source,
      status::text AS status,
      "createdById",
      "updatedById",
      "createdAt",
      "updatedAt"
    FROM "holidays"
    WHERE id = ${id}
    LIMIT 1
  `);

  return rows[0] ? withHolidayColor(rows[0]) : null;
};

export const getWorkspaceHolidays = async (workspaceId: string, options?: { activeOnly?: boolean }) => {
  if (!(await hasHolidayColorColumn())) {
    const activeOnlyClause = options?.activeOnly ? Prisma.sql`AND status = 'ACTIVE'::"HolidayStatus"` : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT
        id,
        "workspaceId",
        name,
        "holidayDate",
        "countryId",
        "stateId",
        "districtId",
        "isRecurring",
        "recurrenceRule",
        source::text AS source,
        status::text AS status,
        "createdById",
        "updatedById",
        "createdAt",
        "updatedAt"
      FROM "holidays"
      WHERE "workspaceId" = ${workspaceId}
      ${activeOnlyClause}
      ORDER BY "holidayDate" ASC, name ASC
    `);

    return rows.map(withHolidayColor);
  }

  return prisma.holiday.findMany({
    where: {
      workspaceId,
      ...(options?.activeOnly ? { status: 'ACTIVE' } : {}),
    },
    orderBy: [{ holidayDate: 'asc' }, { name: 'asc' }],
  });
};

export const getApplicableHolidays = async (workspaceId: string, user: any) => {
  const allHolidays = await getWorkspaceHolidays(workspaceId, { activeOnly: true });

  // Location logic Priority: District > State > Country > Global
  return allHolidays.filter(h =>
    h.districtId === user.districtId ||
    h.stateId === user.stateId ||
    h.countryId === user.countryId ||
    (!h.countryId && !h.stateId && !h.districtId)
  );
};

export const createHoliday = async (data: any) => {
  const normalizedData = normalizeHolidayPayload(data);

  // Clear cache mapped to workspace
  if (redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${normalizedData.workspaceId}`);
    await redisClient.del(`holidays:calendar:${normalizedData.workspaceId}:workspace`);
  }
  let holiday: any;
  if (await hasHolidayColorColumn()) {
    holiday = await prisma.holiday.create({ data: normalizedData });
  } else {
    const id = crypto.randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "holidays" (
        "id",
        "workspaceId",
        "name",
        "holidayDate",
        "countryId",
        "stateId",
        "districtId",
        "isRecurring",
        "recurrenceRule",
        "source",
        "status",
        "createdById",
        "updatedById",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${normalizedData.workspaceId},
        ${normalizedData.name},
        ${normalizedData.holidayDate},
        ${normalizedData.countryId ?? null},
        ${normalizedData.stateId ?? null},
        ${normalizedData.districtId ?? null},
        ${normalizedData.isRecurring ?? false},
        ${normalizedData.recurrenceRule ?? null},
        ${'MANUAL'}::"HolidaySource",
        ${(normalizedData.status ?? 'ACTIVE')}::"HolidayStatus",
        ${normalizedData.createdById ?? null},
        ${normalizedData.updatedById ?? null},
        NOW(),
        NOW()
      )
    `);
    holiday = await selectHolidayByIdLegacy(id);
  }
  
  await prisma.auditLog.create({
    data: {
      action: 'CREATE_HOLIDAY',
      entityType: 'Holiday',
      entityId: holiday.id,
      userId: normalizedData.createdById,
      workspaceId: normalizedData.workspaceId,
      details: {
        color: holiday.color,
        source: holiday.source,
        holidayDate: holiday.holidayDate,
        name: holiday.name
      }
    }
  });
  
  return holiday;
};

export const updateHoliday = async (id: string, data: any) => {
  const normalizedData = normalizeHolidayPayload(data);
  const holiday = await (await hasHolidayColorColumn() ? prisma.holiday.findUnique({ where: { id } }) : selectHolidayByIdLegacy(id));
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}:workspace`);
  }
  let updatedHoliday: any;
  if (await hasHolidayColorColumn()) {
    updatedHoliday = await prisma.holiday.update({ where: { id }, data: normalizedData });
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "holidays"
      SET
        "name" = ${normalizedData.name},
        "holidayDate" = ${normalizedData.holidayDate},
        "countryId" = ${normalizedData.countryId ?? null},
        "stateId" = ${normalizedData.stateId ?? null},
        "districtId" = ${normalizedData.districtId ?? null},
        "isRecurring" = ${normalizedData.isRecurring ?? false},
        "recurrenceRule" = ${normalizedData.recurrenceRule ?? null},
        "status" = ${(normalizedData.status ?? 'ACTIVE')}::"HolidayStatus",
        "updatedById" = ${normalizedData.updatedById ?? null},
        "updatedAt" = NOW()
      WHERE id = ${id}
    `);
    updatedHoliday = await selectHolidayByIdLegacy(id);
  }
  
  if (holiday) {
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_HOLIDAY',
        entityType: 'Holiday',
        entityId: id,
        userId: normalizedData.updatedById,
        workspaceId: holiday.workspaceId,
        details: { oldVal: holiday, newVal: normalizedData }
      }
    });
  }
  
  return updatedHoliday;
};

export const deleteHoliday = async (id: string) => {
  const holiday = await (await hasHolidayColorColumn() ? prisma.holiday.findUnique({ where: { id } }) : selectHolidayByIdLegacy(id));
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}:workspace`);
  }
  let deleted: any;
  if (await hasHolidayColorColumn()) {
    deleted = await prisma.holiday.update({ where: { id }, data: { status: 'INACTIVE' } });
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "holidays"
      SET "status" = ${'INACTIVE'}::"HolidayStatus", "updatedAt" = NOW()
      WHERE id = ${id}
    `);
    deleted = await selectHolidayByIdLegacy(id);
  }
  
  if (holiday) {
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_HOLIDAY',
        entityType: 'Holiday',
        entityId: id,
        userId: holiday.createdById, // We don't track deletedById currently
        workspaceId: holiday.workspaceId,
      }
    });
  }
  
  return deleted;
};

export const getCalendarView = async (workspaceId: string, user: any, month: string) => {
  let applicableHolidays = [];

  const cacheKey = `holidays:calendar:${workspaceId}`;
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
       applicableHolidays = JSON.parse(cached);
    }
  }

  if (applicableHolidays.length === 0) {
    const holidaysFromDb = await getApplicableHolidays(workspaceId, user);
    // Caching
    if (redisClient.isOpen) {
       await redisClient.setEx(cacheKey, 3600, JSON.stringify(holidaysFromDb));
    }
    applicableHolidays = holidaysFromDb;
  }
  
  // Format dates correctly from strings or Dates
  const views = applicableHolidays.map((h: any) => {
    let dateStr = typeof h.holidayDate === 'string' ? h.holidayDate.split('T')[0] : (new Date(h.holidayDate)).toISOString().split('T')[0];
    
    if (h.isRecurring && month) {
      const [y, m, d] = dateStr.split('-');
      const [reqY, reqM] = month.split('-');
      if (reqM === m || !month) {
        dateStr = `${reqY}-${m}-${d}`;
      }
    }
    
    return {
      date: dateStr,
      color: h.color || DEFAULT_HOLIDAY_COLOR,
      title: h.name,
      type: 'HOLIDAY',
      source: h.source
    };
  });
  
  const weeklyOffSettings = await getWorkspaceWeeklyOffSettings(workspaceId);
  const weeklyOffViews = appendWeeklyOffCalendarItems(
    month,
    weeklyOffSettings.weeklyOffDays,
    weeklyOffSettings.weeklyOffColor,
  );
  const merged = [...views, ...weeklyOffViews];

  if (month) {
    return merged.filter((v: any) => v.date.startsWith(month));
  }
  return merged;
};

export const getWorkspaceCalendarView = async (workspaceId: string, month: string) => {
  let holidays = [];

  const cacheKey = `holidays:calendar:${workspaceId}:workspace`;
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      holidays = JSON.parse(cached);
    }
  }

  if (holidays.length === 0) {
    holidays = await getWorkspaceHolidays(workspaceId, { activeOnly: true });
    if (redisClient.isOpen) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(holidays));
    }
  }

  const views = holidays.map((h: any) => {
    let dateStr =
      typeof h.holidayDate === 'string'
        ? h.holidayDate.split('T')[0]
        : new Date(h.holidayDate).toISOString().split('T')[0];

    if (h.isRecurring && month) {
      const [, m, d] = dateStr.split('-');
      const [reqY, reqM] = month.split('-');
      if (reqM === m || !month) {
        dateStr = `${reqY}-${m}-${d}`;
      }
    }

    return {
      date: dateStr,
      color: h.color || DEFAULT_HOLIDAY_COLOR,
      title: h.name,
      type: 'HOLIDAY',
      source: h.source,
    };
  });

  const weeklyOffSettings = await getWorkspaceWeeklyOffSettings(workspaceId);
  const weeklyOffViews = appendWeeklyOffCalendarItems(
    month,
    weeklyOffSettings.weeklyOffDays,
    weeklyOffSettings.weeklyOffColor,
  );

  const merged = [...views, ...weeklyOffViews];

  if (month) {
    return merged.filter((v: any) => v.date.startsWith(month));
  }
  return merged;
};

export const getWeeklyOffSettings = async (workspaceId: string) => getWorkspaceWeeklyOffSettings(workspaceId);

export const saveWeeklyOffSettings = async (
  workspaceId: string,
  payload: { weeklyOffDays: unknown; weeklyOffColor: unknown },
) => {
  const weeklyOffDays = normalizeWeeklyOffDays(payload.weeklyOffDays);
  const weeklyOffColor = normalizeWeeklyOffColor(payload.weeklyOffColor);

  const updated = await updateWorkspaceWeeklyOffSettings(workspaceId, { weeklyOffDays, weeklyOffColor });

  if (redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${workspaceId}`);
    await redisClient.del(`holidays:calendar:${workspaceId}:workspace`);
  }

  await prisma.auditLog.create({
    data: {
      action: 'UPDATE_WEEKLY_OFF_SETTINGS',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { weeklyOffDays, weeklyOffColor },
    },
  });

  return {
    weeklyOffDays: updated.weeklyOffDays,
    weeklyOffColor: updated.weeklyOffColor,
  };
};

// SLA-Aware Engine
export const getWorkingDays = async (workspaceId: string, user: any, start: Date, end: Date) => {
  const holidays = await getApplicableHolidays(workspaceId, user);
  const { weeklyOffDays } = await getWorkspaceWeeklyOffSettings(workspaceId);

  const allDays = eachDayOfInterval({ start, end });
  return allDays.filter((day) => {
    const formatted = format(day, 'yyyy-MM-dd');
    return !isHolidayOnDate(holidays, formatted) && !isWeeklyOffDate(day, weeklyOffDays);
  });
};

