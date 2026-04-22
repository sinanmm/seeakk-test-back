import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { eachDayOfInterval, isWeekend, format, parseISO } from 'date-fns';
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

export const getWorkspaceHolidays = async (workspaceId: string, options?: { activeOnly?: boolean }) => {
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
  const holiday = await prisma.holiday.create({ data: normalizedData });
  
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
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}:workspace`);
  }
  const updatedHoliday = await prisma.holiday.update({ where: { id }, data: normalizedData });
  
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
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}:workspace`);
  }
  const deleted = await prisma.holiday.update({ where: { id }, data: { status: 'INACTIVE' } });
  
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
  
  if (month) {
    return views.filter((v: any) => v.date.startsWith(month));
  }
  return views;
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

  if (month) {
    return views.filter((v: any) => v.date.startsWith(month));
  }
  return views;
};

// SLA-Aware Engine
export const getWorkingDays = async (workspaceId: string, user: any, start: Date, end: Date) => {
  const holidays = await getApplicableHolidays(workspaceId, user);
  
  const allDays = eachDayOfInterval({ start, end });
  return allDays.filter(day => {
    const formatted = format(day, 'yyyy-MM-dd');
    const [y, m, d] = formatted.split('-');
    
    const isHoliday = holidays.some((h: any) => {
      const hdStr = typeof h.holidayDate === 'string' ? h.holidayDate.split('T')[0] : (new Date(h.holidayDate)).toISOString().split('T')[0];
      const [, hm, hd] = hdStr.split('-');
      
      if (h.isRecurring) {
        return hm === m && hd === d;
      }
      return formatted === hdStr;
    });
    
    return !isHoliday && !isWeekend(day);
  });
};
