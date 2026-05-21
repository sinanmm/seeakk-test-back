import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { getApplicableHolidays } from '../holidays/holidays.service';
import { lockUser } from '../../services/User/accountLockService';
import { startOfDay, endOfDay } from 'date-fns';
import {
  hasUserSubmittedToday,
  isSystemGeneratedRecord,
  requiresMandatoryAttendancePopup,
  resolveAttendanceSubmissionState,
} from './attendanceState.util';
import { requiresOfficeNetworkValidation, validateOfficeNetwork } from './attendanceNetwork.util';

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
        attendanceStartTime: '08:00',
        lateMarkTime: '09:45',
        autoAbsentTime: '12:00',
        approvalRequired: true,
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
      attendanceStartTime: data.attendanceStartTime || '08:00',
      lateMarkTime: data.lateMarkTime || '09:45',
      autoAbsentTime: data.autoAbsentTime || '12:00',
      approvalRequired: data.approvalRequired ?? true,
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

  const submissionState = resolveAttendanceSubmissionState(
    existingRecord,
    holidayCheck.isHoliday,
  );
  const isMarked = hasUserSubmittedToday(submissionState);

  return {
    date: todayStr,
    isHoliday: holidayCheck.isHoliday,
    holidayName: holidayCheck.isHoliday ? holidayCheck.name : null,
    isLocked: user.isLocked,
    isMarked,
    submissionState,
    requiresMandatoryPopup: requiresMandatoryAttendancePopup(submissionState, user.isLocked),
    record: existingRecord,
    attendanceApplyType: user.attendanceApplyType,
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

  if (existingRecord && !isSystemGeneratedRecord(existingRecord)) {
    if (existingRecord.approvalStatus !== 'REJECTED') {
      throw createAttendanceServiceError('Attendance already marked for today.', 409);
    }
  }

  const applicableHolidays = await getApplicableHolidays(workspaceId, user);
  const holidayCheck = checkIsHoliday(applicableHolidays, dateStr);

  const isHoliday = holidayCheck.isHoliday;
  const holidayName = holidayCheck.isHoliday ? holidayCheck.name : null;
  const attendanceType = isHoliday ? 'HOLIDAY' : payload.attendanceType;

  const settings = await getSettings(workspaceId);

  let isOfficeNetwork = false;
  if (requiresOfficeNetworkValidation(user.attendanceApplyType, attendanceType)) {
    let networks = await prisma.attendanceNetwork.findMany({
      where: { workspaceId, isEnabled: true },
    });

    if (networks.length === 0) {
      await prisma.attendanceNetwork.create({
        data: {
          workspaceId,
          officeName: 'MISSION 2050 Office',
          branch: 'HQ',
          wifiSsid: 'MISSION 2050-2G',
          routerIp: '192.168.220.1',
          subnet: '255.255.255.0',
          allowedIpRanges: '192.168.220.*',
        },
      });
      networks = await prisma.attendanceNetwork.findMany({
        where: { workspaceId, isEnabled: true },
      });
    }

    const networkCheck = validateOfficeNetwork(networks, {
      ipAddress: payload.ipAddress,
      networkName: payload.networkName,
      routerIp: payload.routerIp,
      subnet: payload.subnet,
    });

    if (!networkCheck.ok) {
      const error = createAttendanceServiceError(networkCheck.message, 403) as Error & {
        statusCode: number;
        errorCode?: string;
        details?: Record<string, unknown>;
      };
      error.errorCode = networkCheck.errorCode;
      error.details = networkCheck.details;
      throw error;
    }

    isOfficeNetwork = true;
  }

  let warningCount = 0;
  let checkInTime = payload.checkInTime ? new Date(payload.checkInTime) : new Date();

  // Settings warnings
  if (!isHoliday && ['PRESENT', 'HALF_DAY', 'WORK_FROM_HOME'].includes(attendanceType)) {
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

        const totalWarnings = await prisma.attendanceWarning.count({
          where: { userId, workspaceId },
        });

        if (settings.enableAutoLock && totalWarnings >= settings.warningThreshold) {
          await lockUser(userId, workspaceId, `Exceeded late attendance warnings limit (${totalWarnings}/${settings.warningThreshold})`);
          await prisma.attendanceNotification.create({
            data: {
              workspaceId,
              userId,
              title: 'Account Locked',
              message: `Your account was locked due to exceeding late check-in warnings (${totalWarnings})`,
            },
          });
        }
      }
    }
  }

  const approvalStatus = settings.approvalRequired ? 'PENDING' : 'APPROVED';

  let record;
  if (existingRecord) {
    record = await prisma.attendanceRecord.update({
      where: { id: existingRecord.id },
      data: {
        checkInTime: isHoliday ? null : checkInTime,
        attendanceType,
        status: approvalStatus === 'APPROVED' ? 'APPROVED' : 'PENDING',
        warningCount,
        isHoliday,
        holidayName,
        isLocked: user.isLocked,
        createdBy: userId,
        ipAddress: payload.ipAddress,
        networkName: payload.networkName,
        routerIp: payload.routerIp,
        subnet: payload.subnet,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork,
        deviceInfo: payload.deviceInfo,
        geoLocation: payload.geoLocation,
        approvalStatus,
        supervisorId: user.supervisorId,
        notes: payload.notes,
        attachmentUrl: payload.attachmentUrl,
        submittedAt: new Date(),
        rejectedReason: null,
      },
    });
  } else {
    record = await prisma.attendanceRecord.create({
      data: {
        userId,
        workspaceId,
        date: dateObj,
        checkInTime: isHoliday ? null : checkInTime,
        attendanceType,
        status: approvalStatus === 'APPROVED' ? 'APPROVED' : 'PENDING',
        warningCount,
        isHoliday,
        holidayName,
        isLocked: user.isLocked,
        createdBy: userId,
        ipAddress: payload.ipAddress,
        networkName: payload.networkName,
        routerIp: payload.routerIp,
        subnet: payload.subnet,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork,
        deviceInfo: payload.deviceInfo,
        geoLocation: payload.geoLocation,
        approvalStatus,
        supervisorId: user.supervisorId,
        notes: payload.notes,
        attachmentUrl: payload.attachmentUrl,
      },
    });
  }

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'SUBMIT',
      details: `Submitted attendance as ${attendanceType} (${approvalStatus})`,
      ipAddress: payload.ipAddress,
    },
  });

  // Notify Supervisor
  if (user.supervisorId) {
    await prisma.attendanceNotification.create({
      data: {
        workspaceId,
        userId: user.supervisorId,
        title: 'New Attendance Request',
        message: `${user.name || 'An employee'} submitted a new attendance request for approval.`,
      },
    });
  }

  return record;
};

export const getHistory = async (userId: string, workspaceId: string, filters: any) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createAttendanceServiceError('User not found', 404);

  const start = filters.startDate ? new Date(filters.startDate) : startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = filters.endDate ? new Date(filters.endDate) : endOfDay(new Date());

  const whereClause: any = {
    userId,
    workspaceId,
    date: {
      gte: start,
      lte: end,
    },
  };

  if (filters.approvalStatus && filters.approvalStatus !== 'ALL') {
    whereClause.approvalStatus = filters.approvalStatus;
  } else if (!filters.approvalStatus) {
    whereClause.approvalStatus = 'APPROVED';
  }

  const records = await prisma.attendanceRecord.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  // Fetch approver names in memory to avoid schema changes
  const approverIds = Array.from(new Set(records.map(r => r.approvedBy).filter(Boolean))) as string[];
  const approvers = await prisma.user.findMany({
    where: { id: { in: approverIds } },
    select: { id: true, name: true },
  });
  const approverMap = new Map(approvers.map(a => [a.id, a.name]));

  const recordsWithApprover = records.map(r => ({
    ...r,
    approvedByName: r.approvedBy ? approverMap.get(r.approvedBy) || 'Unknown' : null,
  }));

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
    records: recordsWithApprover,
    warnings,
    holidays,
  };
};

export const getAdminOverview = async (workspaceId: string, filters: any) => {
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const skip = (page - 1) * limit;

  // If date filters are provided, query records directly
  if (filters.startDate || filters.endDate) {
    const whereClause: any = { workspaceId };
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.attendanceType) whereClause.attendanceType = filters.attendanceType;
    if (filters.approvalStatus) whereClause.approvalStatus = filters.approvalStatus;

    whereClause.date = {};
    if (filters.startDate) whereClause.date.gte = new Date(filters.startDate);
    if (filters.endDate) whereClause.date.lte = new Date(filters.endDate);

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
              attendanceApplyType: true,
              role: { select: { name: true } },
              department: { select: { name: true } },
              supervisor: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.attendanceRecord.count({ where: whereClause }),
    ]);

    // Map records to have correct user relationships
    return {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Otherwise, default to "Today's Users List" (show all active users merged with today's status)
  const todayStr = getLocalDateString();
  const todayDateObj = new Date(todayStr);

  const userWhere: any = {
    workspaceId,
    deletedAt: null,
    isActive: true,
  };

  if (filters.userId) userWhere.id = filters.userId;
  if (filters.roleId) userWhere.roleId = filters.roleId;
  if (filters.departmentId) userWhere.departmentId = filters.departmentId;

  // Fetch all active users matching filter
  const users = await prisma.user.findMany({
    where: userWhere,
    include: {
      role: { select: { name: true } },
      department: { select: { name: true } },
      supervisor: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Fetch today's records for these users
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: {
      workspaceId,
      date: todayDateObj,
      userId: { in: users.map(u => u.id) },
    },
  });

  const attendanceMap = new Map(attendanceRecords.map(r => [r.userId, r]));

  // Merge
  const mappedRecords = users.map(user => {
    const record = attendanceMap.get(user.id);
    if (record) {
      return {
        id: record.id,
        userId: user.id,
        workspaceId,
        date: todayDateObj,
        checkInTime: record.checkInTime,
        attendanceType: record.attendanceType,
        status: record.status,
        warningCount: record.warningCount,
        isHoliday: record.isHoliday,
        holidayName: record.holidayName,
        isLocked: user.isLocked,
        ipAddress: record.ipAddress,
        networkName: record.networkName,
        routerIp: record.routerIp,
        subnet: record.subnet,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork: record.isOfficeNetwork,
        deviceInfo: record.deviceInfo,
        geoLocation: record.geoLocation,
        approvalStatus: record.approvalStatus,
        approvedBy: record.approvedBy,
        approvedAt: record.approvedAt,
        rejectedReason: record.rejectedReason,
        notes: record.notes,
        user,
      };
    } else {
      return {
        id: `virtual-${user.id}`,
        userId: user.id,
        workspaceId,
        date: todayDateObj,
        checkInTime: null,
        attendanceType: 'ABSENT',
        status: 'MARKED',
        warningCount: 0,
        isHoliday: false,
        holidayName: null,
        isLocked: user.isLocked,
        ipAddress: null,
        networkName: null,
        routerIp: null,
        subnet: null,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork: false,
        deviceInfo: null,
        geoLocation: null,
        approvalStatus: 'NOT_SUBMITTED',
        approvedBy: null,
        approvedAt: null,
        rejectedReason: null,
        notes: null,
        user,
      };
    }
  });

  // Filter in-memory by attendanceType or approvalStatus if specified
  let filteredRecords = mappedRecords;
  if (filters.attendanceType) {
    filteredRecords = filteredRecords.filter(r => r.attendanceType === filters.attendanceType);
  }
  if (filters.approvalStatus) {
    filteredRecords = filteredRecords.filter((r) => {
      if (String(r.id).startsWith('virtual-')) {
        return filters.approvalStatus === 'NOT_SUBMITTED' && r.approvalStatus === 'NOT_SUBMITTED';
      }
      return r.approvalStatus === filters.approvalStatus;
    });
  }

  // Paginate in-memory
  const total = filteredRecords.length;
  const paginatedRecords = filteredRecords.slice(skip, skip + limit);

  return {
    records: paginatedRecords,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getPendingApprovals = async (workspaceId: string, supervisorId: string) => {
  // If supervisor has permissions, filter records where user.supervisorId == supervisorId AND status == PENDING
  // If no supervisor configuration / superadmin, show all PENDING in workspace
  const user = await prisma.user.findUnique({
    where: { id: supervisorId },
    include: { role: true },
  });

  const isWorkspaceAdmin = user?.role?.name === 'superadmin' || user?.role?.name === 'admin';

  const whereClause: any = {
    workspaceId,
    approvalStatus: 'PENDING',
  };

  if (!isWorkspaceAdmin) {
    whereClause.supervisorId = supervisorId;
  }

  return prisma.attendanceRecord.findMany({
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
  });
};

export const reviewAttendance = async (
  workspaceId: string,
  recordId: string,
  actorId: string,
  action: 'APPROVE' | 'REJECT',
  reason?: string
) => {
  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, workspaceId },
    include: {
      user: { select: { supervisorId: true } },
    },
  });

  if (!record) {
    throw createAttendanceServiceError('Attendance record not found', 404);
  }

  if (String(recordId).startsWith('virtual-')) {
    throw createAttendanceServiceError('Cannot review attendance that was not submitted.', 400);
  }

  if (record.userId === actorId) {
    throw createAttendanceServiceError('Self-approval or self-rejection is forbidden.', 403);
  }

  if (record.approvalStatus !== 'PENDING') {
    throw createAttendanceServiceError(
      `Attendance is already ${record.approvalStatus.toLowerCase()}.`,
      409,
    );
  }

  if (isSystemGeneratedRecord(record)) {
    throw createAttendanceServiceError('System-generated attendance cannot be reviewed.', 400);
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    include: { role: { select: { name: true } } },
  });

  const roleName = (actor?.role?.name || '').toLowerCase();
  const isWorkspaceAdmin = roleName === 'superadmin' || roleName === 'admin';

  if (!isWorkspaceAdmin && record.supervisorId !== actorId && record.user?.supervisorId !== actorId) {
    throw createAttendanceServiceError('You are not authorized to review this attendance request.', 403);
  }

  if (action === 'REJECT' && !reason) {
    throw createAttendanceServiceError('Rejection reason is mandatory.', 400);
  }

  const updatedRecord = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: {
      approvalStatus: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      status: action === 'APPROVE' ? 'APPROVED' : 'MARKED',
      approvedBy: action === 'APPROVE' ? actorId : null,
      approvedAt: action === 'APPROVE' ? new Date() : null,
      rejectedReason: action === 'REJECT' ? reason : null,
    },
  });

  await prisma.attendanceApprovalLog.create({
    data: {
      attendanceRecordId: recordId,
      action,
      actorId,
      reason,
    },
  });

  await prisma.attendanceNotification.create({
    data: {
      workspaceId,
      userId: record.userId,
      title: `Attendance ${action === 'APPROVE' ? 'Approved' : 'Rejected'}`,
      message: `Your attendance for ${new Date(record.date).toLocaleDateString()} was ${action.toLowerCase()}d.`,
    },
  });

  return updatedRecord;
};

export const updateUserApplyType = async (workspaceId: string, userId: string, applyType: string) => {
  return prisma.user.update({
    where: { id: userId, workspaceId },
    data: { attendanceApplyType: applyType },
  });
};

export const getStats = async (userId: string, workspaceId: string) => {
  const records = await prisma.attendanceRecord.findMany({
    where: { userId, workspaceId, approvalStatus: 'APPROVED' },
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
  const todayStr = getLocalDateString();
  const todayDate = new Date(todayStr);

  const [records, totalWarnings, totalLocked, activeUserCount] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { workspaceId, date: todayDate },
      include: { user: { select: { departmentId: true } } },
    }),
    prisma.attendanceWarning.count({ where: { workspaceId } }),
    prisma.user.count({ where: { workspaceId, isLocked: true, deletedAt: null } }),
    prisma.user.count({ where: { workspaceId, deletedAt: null, isActive: true } }),
  ]);

  const userSubmittedRecords = records.filter((r) => !isSystemGeneratedRecord(r));

  const totalPresent = userSubmittedRecords.filter(
    (r) => ['PRESENT', 'WORK_FROM_HOME', 'HALF_DAY'].includes(r.attendanceType) && r.approvalStatus === 'APPROVED',
  ).length;
  const totalPending = userSubmittedRecords.filter((r) => r.approvalStatus === 'PENDING').length;
  const totalRejected = userSubmittedRecords.filter((r) => r.approvalStatus === 'REJECTED').length;
  const totalApproved = userSubmittedRecords.filter((r) => r.approvalStatus === 'APPROVED').length;
  const totalLate = userSubmittedRecords.filter((r) => r.warningCount > 0).length;
  const totalAbsent = Math.max(
    0,
    activeUserCount -
      userSubmittedRecords.filter((r) => r.approvalStatus === 'APPROVED' || r.approvalStatus === 'PENDING').length,
  );
  const totalHolidays = records.filter((r) => r.isHoliday).length;

  const deptStats: Record<string, number> = {};
  for (const r of userSubmittedRecords) {
    const deptId = r.user?.departmentId || 'Unassigned';
    if (['PRESENT', 'WORK_FROM_HOME'].includes(r.attendanceType) && r.approvalStatus === 'APPROVED') {
      deptStats[deptId] = (deptStats[deptId] || 0) + 1;
    }
  }

  return {
    totalPresent,
    totalAbsent,
    totalPending,
    totalRejected,
    totalApproved,
    totalLate,
    totalHolidays,
    totalWarnings,
    totalLocked,
    activeUserCount,
    departmentStats: Object.keys(deptStats).map((key) => ({ departmentId: key, presentCount: deptStats[key] })),
  };
};

export const unlockUserAdmin = async (userId: string, workspaceId: string, actorId: string) => {
  const user = await prisma.user.update({
    where: { id: userId, workspaceId },
    data: { isLocked: false },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'UNLOCK',
      details: `User unlocked manually by supervisor/admin (${actorId})`,
    },
  });

  await prisma.attendanceWarning.deleteMany({
    where: { userId, workspaceId },
  });

  return user;
};

// Network settings CRUD
export const getNetworks = async (workspaceId: string) => {
  return prisma.attendanceNetwork.findMany({ where: { workspaceId } });
};

export const createNetwork = async (workspaceId: string, data: any) => {
  return prisma.attendanceNetwork.create({
    data: {
      workspaceId,
      officeName: data.officeName,
      branch: data.branch,
      wifiSsid: data.wifiSsid,
      routerIp: data.routerIp,
      gateway: data.gateway,
      allowedIpRanges: data.allowedIpRanges,
      subnet: data.subnet,
      macValidation: data.macValidation,
      isEnabled: data.isEnabled ?? true,
    },
  });
};

export const updateNetwork = async (workspaceId: string, id: string, data: any) => {
  return prisma.attendanceNetwork.update({
    where: { id },
    data,
  });
};

export const deleteNetwork = async (workspaceId: string, id: string) => {
  return prisma.attendanceNetwork.delete({ where: { id } });
};

// Notifications list
export const getNotifications = async (userId: string, workspaceId: string) => {
  return prisma.attendanceNotification.findMany({
    where: { userId, workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
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

  if (currentHHMM > cutoffTime) {
    for (const user of users) {
      const applicableHolidays = await getApplicableHolidays(workspaceId, user);
      const holidayCheck = checkIsHoliday(applicableHolidays, todayStr);

      if (holidayCheck.isHoliday) {
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
            status: 'APPROVED',
            approvalStatus: 'APPROVED',
            isHoliday: true,
            holidayName: holidayCheck.name,
            createdBy: 'SYSTEM_CRON',
          },
        });
        continue;
      }

      const existing = await prisma.attendanceRecord.findUnique({
        where: {
          userId_date: { userId: user.id, date: dateObj },
        },
      });

      if (!existing) {
        await prisma.attendanceRecord.create({
          data: {
            userId: user.id,
            workspaceId,
            date: dateObj,
            attendanceType: 'ABSENT',
            status: 'APPROVED',
            approvalStatus: 'APPROVED',
            createdBy: 'SYSTEM_CRON',
          },
        });

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

          const totalWarnings = await prisma.attendanceWarning.count({
            where: { userId: user.id, workspaceId },
          });

          if (settings.enableAutoLock && totalWarnings >= settings.warningThreshold) {
            await lockUser(user.id, workspaceId, `Automatically locked due to consecutive absent records (${totalWarnings})`);
          }
        }
      }
    }
  }
};
