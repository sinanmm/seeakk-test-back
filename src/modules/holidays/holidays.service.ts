import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { eachDayOfInterval, isWeekend, format, parseISO } from 'date-fns';
import { redisClient } from '../../config/redis';

export const getApplicableHolidays = async (workspaceId: string, user: any) => {
  const allHolidays = await prisma.holiday.findMany({
    where: { workspaceId, status: 'ACTIVE' },
  });

  // Location logic Priority: District > State > Country > Global
  return allHolidays.filter(h =>
    h.districtId === user.districtId ||
    h.stateId === user.stateId ||
    h.countryId === user.countryId ||
    (!h.countryId && !h.stateId && !h.districtId)
  );
};

export const createHoliday = async (data: any) => {
  // Clear cache mapped to workspace
  if (redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${data.workspaceId}`);
  }
  const holiday = await prisma.holiday.create({ data });
  
  await prisma.auditLog.create({
    data: {
      action: 'CREATE_HOLIDAY',
      entityType: 'Holiday',
      entityId: holiday.id,
      userId: data.createdById,
      workspaceId: data.workspaceId,
      details: {
        source: holiday.source,
        holidayDate: holiday.holidayDate,
        name: holiday.name
      }
    }
  });
  
  return holiday;
};

export const updateHoliday = async (id: string, data: any) => {
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
  }
  const updatedHoliday = await prisma.holiday.update({ where: { id }, data });
  
  if (holiday) {
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_HOLIDAY',
        entityType: 'Holiday',
        entityId: id,
        userId: data.updatedById,
        workspaceId: holiday.workspaceId,
        details: { oldVal: holiday, newVal: data }
      }
    });
  }
  
  return updatedHoliday;
};

export const deleteHoliday = async (id: string) => {
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (holiday && redisClient.isOpen) {
    await redisClient.del(`holidays:calendar:${holiday.workspaceId}`);
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
