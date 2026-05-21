import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { getApplicableHolidays } from '../holidays/holidays.service';
import { lockUser } from '../../services/User/accountLockService';
import { startOfDay, endOfDay, format } from 'date-fns';

const createAttendanceServiceError = (message: string, statusCode = 400): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const getLocalDateString = (date?: Date | string): string => {
  const d = date ? new Date(date) : new Date();
  return d.toISOString().split('T')[0];
};

const checkIsHoliday = (applicableHolidays: any[], dateStr: string) => {
  const [y, m, d] = dateStr.split('-');
  const found = applicableHolidays.find(h => {
    const hdStr = typeof h.holidayDate === 'string'
      ? h.holidayDate.split('T')[0]
      : new Date(h.holidayDate).toISOString().split('T')[0];
    const [, hm, hd] = hdStr.split('-');
    if (h.isRecurring) {
      return hm === m && hd === d;
    }
    return dateStr === hdStr;
  });
  return found ? { isHoliday: true, name: found.name } : { isHoliday: false };
};

export const getSettings = async (workspaceId: string) => {
  let settings = await prisma.attendanceSetting.findUnique({
    where: { workspaceId },
  });

  if (!settings) {
    settings = await prisma.attendanceSetting.create({
      data: {
        workspaceId,
        cutoffTime: '09:30',
        enableWarning: true,
        warningThreshold: 3,
        enableAutoLock: false,
      },
    });
  }

  return settings;
};

export const updateSettings = async (workspaceId: string, data: any) => {
  return prisma.attendanceSetting.upsert({
    where: { workspaceId },
    update: data,
    create: {
      workspaceId,
      cutoffTime: data.cutoffTime || '09:30',
      enableWarning: data.enableWarning ?? true,
      warningThreshold: data.warningThreshold ?? 3,
      enableAutoLock: data.enableAutoLock ?? false,
    },
  });
};

export const getTodayStatus = async (userId: string, workspaceId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
  });

  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  const todayStr = getLocalDateString();
  const applicableHolidays = await getApplicableHolidays(workspaceId, user);
  const holidayCheck = checkIsHoliday(applicableHolidays, todayStr);

  const existingRecord = await prisma.attendanceRecord.findUnique({
    where: {
      userId_date: {
        userId,
        date: new Date(todayStr),
      },
    },
  });

  return {
    date: todayStr,
    isHoliday: holidayCheck.isHoliday,
    holidayName: holidayCheck.isHoliday ? holidayCheck.name : null,
    isLocked: user.isLocked,
    isMarked: !!existingRecord,
    record: existingRecord,
  };
};

export const markAttendance = async (userId: string, workspaceId: string, payload: any) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
  });

  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  if (user.isLocked) {
    throw createAttendanceServiceError('Your account is temporarily locked due to incomplete targets.', 423);
  }

  const dateStr = payload.date || getLocalDateString();
  const dateObj = new Date(dateStr);

  const existingRecord = await prisma.attendanceRecord.findUnique({
    where: {
      userId_date: {
        userId,
        date: dateObj,
      },
    },
  });

  if (existingRecord) {
    throw createAttendanceServiceError('Attendance already marked for today.', 409);
  }

  const applicableHolidays = await getApplicableHolidays(workspaceId, user);
  const holidayCheck = checkIsHoliday(applicableHolidays, dateStr);

  const attendanceType = holidayCheck.isHoliday ? 'HOLIDAY' : payload.attendanceType;
  const isHoliday = holidayCheck.isHoliday;
  const holidayName = holidayCheck.isHoliday ? holidayCheck.name : null;

  let warningCount = 0;
  let checkInTime = payload.checkInTime ? new Date(payload.checkInTime) : new Date();

  // Settings for late check-in
  if (!isHoliday && ['PRESENT', 'HALF_DAY', 'WORK_FROM_HOME'].includes(attendanceType)) {
    const settings = await getSettings(workspaceId);
    if (settings.enableWarning) {
      const checkInHHMM = `${String(checkInTime.getHours()).padStart(2, '0')}:${String(checkInTime.getMinutes()).padStart(2, '0')}`;
      if (checkInHHMM > settings.cutoffTime) {
        warningCount = 1;
        await prisma.attendanceWarning.create({
          data: {
            userId,
            workspaceId,
            date: dateObj,
            warningType: 'LATE_CHECKIN',
            reason: `Late check-in at ${checkInHHMM}. Cutoff was ${settings.cutoffTime}.`,
          },
        });

        // Check if warning threshold exceeded
        const totalWarnings = await prisma.attendanceWarning.count({
          where: { userId, workspaceId },
        });

        if (settings.enableAutoLock && totalWarnings >= settings.warningThreshold) {
          await lockUser(userId, workspaceId, `Exceeded late attendance warnings limit (${totalWarnings}/${settings.warningThreshold})`);
          await prisma.attendanceLog.create({
            data: {
              userId,
              workspaceId,
              action: 'AUTO_LOCK',
              details: `User locked due to exceeding late check-in threshold (${totalWarnings})`,
            },
          });
        }
      }
    }
  }

  const record = await prisma.attendanceRecord.create({
    data: {
      userId,
      workspaceId,
      date: dateObj,
      checkInTime: isHoliday ? null : checkInTime,
      attendanceType,
      status: 'MARKED',
      warningCount,
      isHoliday,
      holidayName,
      isLocked: user.isLocked,
      createdBy: userId,
    },
  });

  await prisma.attendanceLog.create({
    data: {
      userId,
      workspaceId,
      action: 'CHECK_IN',
      details: `Checked in as ${attendanceType}`,
    },
  });

  return record;
};

export const getHistory = async (userId: string, workspaceId: string, filters: any) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createAttendanceServiceError('User not found', 404);

  const start = filters.startDate ? new Date(filters.startDate) : startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = filters.endDate ? new Date(filters.endDate) : endOfDay(new Date());

  const records = await prisma.attendanceRecord.findMany({
    where: {
      userId,
      workspaceId,
      date: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { date: 'desc' },
  });

  const warnings = await prisma.attendanceWarning.findMany({
    where: {
      userId,
      workspaceId,
      date: {
        gte: start,
        lte: end,
      },
    },
  });

  const holidays = await getApplicableHolidays(workspaceId, user);

  return {
    records,
    warnings,
    holidays,
  };
};

export const getAdminOverview = async (workspaceId: string, filters: any) => {
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const skip = (page - 1) * limit;

  const whereClause: any = {
    workspaceId,
  };

  if (filters.userId) whereClause.userId = filters.userId;
  if (filters.attendanceType) whereClause.attendanceType = filters.attendanceType;

  if (filters.startDate || filters.endDate) {
    whereClause.date = {};
    if (filters.startDate) whereClause.date.gte = new Date(filters.startDate);
    if (filters.endDate) whereClause.date.lte = new Date(filters.endDate);
  }

  // Filter by user role/dept if specified
  if (filters.roleId || filters.departmentId) {
    whereClause.user = {};
    if (filters.roleId) whereClause.user.roleId = filters.roleId;
    if (filters.departmentId) whereClause.user.departmentId = filters.departmentId;
  }

  const [records, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isLocked: true,
            role: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      skip,
      take: limit,
    }),
    prisma.attendanceRecord.count({ where: whereClause }),
  ]);

  // Daily statistics for widgets
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const todayRecords = await prisma.attendanceRecord.findMany({
    where: {
      workspaceId,
      date: {
        gte: todayStart,
        lte: todayEnd,
      },
    },
  });

  const totalPresent = todayRecords.filter(r => ['PRESENT', 'WORK_FROM_HOME'].includes(r.attendanceType)).length;
  const totalAbsent = todayRecords.filter(r => r.attendanceType === 'ABSENT').length;
  const totalHolidays = todayRecords.filter(r => r.isHoliday).length;

  const lockedUsersCount = await prisma.user.count({
    where: { workspaceId, isLocked: true, deletedAt: null },
  });

  return {
    records,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalPresent,
      totalAbsent,
      totalHolidays,
      lockedUsersCount,
      attendancePercentage: todayRecords.length > 0 ? Math.round((totalPresent / todayRecords.length) * 100) : 0,
    },
  };
};

export const getStats = async (userId: string, workspaceId: string) => {
  const records = await prisma.attendanceRecord.findMany({
    where: { userId, workspaceId },
  });

  const presentCount = records.filter(r => r.attendanceType === 'PRESENT').length;
  const halfDayCount = records.filter(r => r.attendanceType === 'HALF_DAY').length;
  const leaveCount = records.filter(r => r.attendanceType === 'LEAVE').length;
  const wfhCount = records.filter(r => r.attendanceType === 'WORK_FROM_HOME').length;
  const absentCount = records.filter(r => r.attendanceType === 'ABSENT').length;
  const holidayCount = records.filter(r => r.isHoliday).length;
  const totalWarnings = await prisma.attendanceWarning.count({ where: { userId, workspaceId } });

  const totalWorkingDays = records.length - holidayCount;

  return {
    presentCount,
    halfDayCount,
    leaveCount,
    wfhCount,
    absentCount,
    holidayCount,
    totalWarnings,
    totalWorkingDays,
    attendancePercentage: totalWorkingDays > 0 ? Math.round(((presentCount + wfhCount + halfDayCount * 0.5) / totalWorkingDays) * 100) : 0,
  };
};

export const getAdminStats = async (workspaceId: string) => {
  // Aggregate stats across all departments and generate daily/monthly trends
  const records = await prisma.attendanceRecord.findMany({
    where: { workspaceId },
    include: { user: { select: { departmentId: true } } },
  });

  const totalPresent = records.filter(r => ['PRESENT', 'WORK_FROM_HOME'].includes(r.attendanceType)).length;
  const totalAbsent = records.filter(r => r.attendanceType === 'ABSENT').length;
  const totalHolidays = records.filter(r => r.isHoliday).length;
  const totalWarnings = await prisma.attendanceWarning.count({ where: { workspaceId } });
  const totalLocked = await prisma.user.count({ where: { workspaceId, isLocked: true, deletedAt: null } });

  // Group by department
  const deptStats: Record<string, number> = {};
  for (const r of records) {
    const deptId = r.user?.departmentId || 'Unassigned';
    deptStats[deptId] = (deptStats[deptId] || 0) + (['PRESENT', 'WORK_FROM_HOME'].includes(r.attendanceType) ? 1 : 0);
  }

  return {
    totalPresent,
    totalAbsent,
    totalHolidays,
    totalWarnings,
    totalLocked,
    departmentStats: Object.keys(deptStats).map(key => ({ departmentId: key, presentCount: deptStats[key] })),
  };
};

export const unlockUserAdmin = async (userId: string, workspaceId: string, actorId: string) => {
  // Enforces supervisor / admin unlock bypass target locking
  const user = await prisma.user.update({
    where: { id: userId, workspaceId },
    data: { isLocked: false },
  });

  await prisma.attendanceLog.create({
    data: {
      userId,
      workspaceId,
      action: 'UNLOCK',
      details: `User unlocked manually by supervisor/admin (${actorId})`,
    },
  });

  // Also remove warning entries so user doesn't get immediately locked again
  await prisma.attendanceWarning.deleteMany({
    where: { userId, workspaceId },
  });

  return user;
};

// Automation / Cron Tasks
export const autoAbsentMarking = async (workspaceId: string) => {
  const users = await prisma.user.findMany({
    where: { workspaceId, isActive: true, deletedAt: null },
  });

  const todayStr = getLocalDateString();
  const dateObj = new Date(todayStr);

  const settings = await getSettings(workspaceId);
  const cutoffTime = settings.cutoffTime;
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // If cutoff has passed, run absent generator for active staff who haven't checked in
  if (currentHHMM > cutoffTime) {
    for (const user of users) {
      // Check if today is holiday for this user
      const applicableHolidays = await getApplicableHolidays(workspaceId, user);
      const holidayCheck = checkIsHoliday(applicableHolidays, todayStr);

      if (holidayCheck.isHoliday) {
        // Automatically write HOLIDAY record if not exists
        await prisma.attendanceRecord.upsert({
          where: {
            userId_date: { userId: user.id, date: dateObj },
          },
          update: {},
          create: {
            userId: user.id,
            workspaceId,
            date: dateObj,
            attendanceType: 'HOLIDAY',
            status: 'AUTO_GENERATED',
            isHoliday: true,
            holidayName: holidayCheck.name,
            createdBy: 'SYSTEM_CRON',
          },
        });
        continue;
      }

      // Check if user has already marked attendance
      const existing = await prisma.attendanceRecord.findUnique({
        where: {
          userId_date: { userId: user.id, date: dateObj },
        },
      });

      if (!existing) {
        // Create ABSENT record
        await prisma.attendanceRecord.create({
          data: {
            userId: user.id,
            workspaceId,
            date: dateObj,
            attendanceType: 'ABSENT',
            status: 'AUTO_GENERATED',
            createdBy: 'SYSTEM_CRON',
          },
        });

        // Add warning for missing check-in
        if (settings.enableWarning) {
          await prisma.attendanceWarning.create({
            data: {
              userId: user.id,
              workspaceId,
              date: dateObj,
              warningType: 'ABSENT',
              reason: 'Automatically marked absent due to missing check-in before cutoff.',
            },
          });

          // Check for auto lock
          const totalWarnings = await prisma.attendanceWarning.count({
            where: { userId: user.id, workspaceId },
          });

          if (settings.enableAutoLock && totalWarnings >= settings.warningThreshold) {
            await lockUser(user.id, workspaceId, `Automatically locked due to consecutive absent records (${totalWarnings})`);
          }
        }

        await prisma.attendanceLog.create({
          data: {
            userId: user.id,
            workspaceId,
            action: 'AUTO_ABSENT',
            details: 'Automatically marked absent and warned',
          },
        });
      }
    }
  }
};
