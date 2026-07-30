import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { eachDayOfInterval, format } from 'date-fns';
import {
  appendWeeklyOffCalendarItems,
  getWorkspaceWeeklyOffSettings,
  isHolidayOnDate,
  isWeeklyOffDate,
  normalizeWeeklyOffDays,
  normalizeWeeklyOffColor,
  updateWorkspaceWeeklyOffSettings,
} from './weeklyOff.util';
import { redisClient } from '../../config/redis';

const createHolidayServiceError = (message: string, statusCode = 400): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const DEFAULT_HOLIDAY_COLOR = '#fda4af';

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

const normalizeHolidayPayload = <T extends Record<string, any>>(data: T): T => {
  const payload: any = {
    ...data,
    holidayDate: normalizeHolidayDate(data.holidayDate),
    color: normalizeHolidayColor(data.color),
  };
  delete payload.countryId;
  delete payload.stateId;
  delete payload.districtId;
  return payload;
};

export const getWorkspaceHolidays = async (
  workspaceId: string,
  options?: { activeOnly?: boolean; officeIds?: string[] },
) => {
  const officeFilter =
    options?.officeIds && options.officeIds.length > 0
      ? {
          offices: {
            some: {
              officeId: { in: options.officeIds },
            },
          },
        }
      : {};

  const holidays = await prisma.holiday.findMany({
    where: {
      workspaceId,
      ...(options?.activeOnly ? { status: 'ACTIVE' } : {}),
      ...officeFilter,
    },
    include: {
      offices: {
        include: {
          office: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ holidayDate: 'asc' }, { name: 'asc' }],
  });

  return holidays.map((h) => ({
    ...h,
    offices: (h.offices || []).map((o) => ({
      id: o.office.id,
      name: o.office.name,
    })),
  }));
};

export const getApplicableHolidays = async (workspaceId: string, user: any) => {
  const allHolidays = await getWorkspaceHolidays(workspaceId, { activeOnly: true });
  const userOfficeId = typeof user === 'object' && user ? user.officeId : null;

  if (!userOfficeId) {
    return allHolidays;
  }

  return allHolidays.filter((h) => {
    if (!h.offices || h.offices.length === 0) return true; // Applicable to all if unassigned
    return h.offices.some((o: any) => o.id === userOfficeId);
  });
};

export const createHoliday = async (data: any) => {
  const { officeIds = [], ...restData } = data;
  if (!Array.isArray(officeIds) || officeIds.length === 0) {
    throw createHolidayServiceError('At least one office must be selected for the holiday.', 422);
  }

  const normalizedData = normalizeHolidayPayload(restData);

  if (redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${normalizedData.workspaceId}`);
    await redisClient.del(`holidays:calendar:${normalizedData.workspaceId}:workspace`);
  }

  const holiday = await prisma.holiday.create({
    data: {
      ...normalizedData,
      offices: {
        create: officeIds.map((officeId: string) => ({
          office: { connect: { id: officeId } },
        })),
      },
    },
    include: {
      offices: {
        include: {
          office: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

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
        name: holiday.name,
        officeIds,
      },
    },
  });

  return {
    ...holiday,
    offices: (holiday.offices || []).map((o) => ({ id: o.office.id, name: o.office.name })),
  };
};

export const updateHoliday = async (id: string, data: any) => {
  const { officeIds, ...restData } = data;
  const normalizedData = normalizeHolidayPayload(restData);

  const existingHoliday = await prisma.holiday.findUnique({ where: { id } });
  if (existingHoliday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${existingHoliday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${existingHoliday.workspaceId}:workspace`);
  }

  if (Array.isArray(officeIds)) {
    if (officeIds.length === 0) {
      throw createHolidayServiceError('At least one office must be selected for the holiday.', 422);
    }

    await prisma.holidayOffice.deleteMany({
      where: { holidayId: id },
    });

    await prisma.holidayOffice.createMany({
      data: officeIds.map((officeId: string) => ({
        holidayId: id,
        officeId,
      })),
    });
  }

  const updatedHoliday = await prisma.holiday.update({
    where: { id },
    data: normalizedData,
    include: {
      offices: {
        include: {
          office: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (existingHoliday) {
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_HOLIDAY',
        entityType: 'Holiday',
        entityId: id,
        userId: normalizedData.updatedById,
        workspaceId: existingHoliday.workspaceId,
        details: { oldVal: existingHoliday, newVal: normalizedData, officeIds },
      },
    });
  }

  return {
    ...updatedHoliday,
    offices: (updatedHoliday.offices || []).map((o) => ({ id: o.office.id, name: o.office.name })),
  };
};

export const deleteHoliday = async (id: string) => {
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}:workspace`);
  }

  const deleted = await prisma.holiday.update({
    where: { id },
    data: { status: 'INACTIVE' },
  });

  if (holiday) {
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_HOLIDAY',
        entityType: 'Holiday',
        entityId: id,
        userId: holiday.createdById,
        workspaceId: holiday.workspaceId,
      },
    });
  }

  return deleted;
};

export const getCalendarView = async (workspaceId: string, user: any, month: string) => {
  const holidaysFromDb = await getApplicableHolidays(workspaceId, user);

  const views = holidaysFromDb.map((h: any) => {
    let dateStr =
      typeof h.holidayDate === 'string'
        ? h.holidayDate.split('T')[0]
        : new Date(h.holidayDate).toISOString().split('T')[0];

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
      source: h.source,
      offices: h.offices,
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

export const getWorkspaceCalendarView = async (workspaceId: string, month?: string, officeIds?: string[]) => {
  const holidays = await getWorkspaceHolidays(workspaceId, { activeOnly: true, officeIds });

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
      offices: h.offices,
    };
  });

  const weeklyOffSettings = await getWorkspaceWeeklyOffSettings(workspaceId);
  const weeklyOffViews = appendWeeklyOffCalendarItems(
    month || format(new Date(), 'yyyy-MM'),
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

export const getWorkingDays = async (workspaceId: string, user: any, start: Date, end: Date) => {
  const holidays = await getApplicableHolidays(workspaceId, user);
  const { weeklyOffDays } = await getWorkspaceWeeklyOffSettings(workspaceId);

  const allDays = eachDayOfInterval({ start, end });
  return allDays.filter((day) => {
    const formatted = format(day, 'yyyy-MM-dd');
    return !isHolidayOnDate(holidays, formatted) && !isWeeklyOffDate(day, weeklyOffDays);
  });
};
