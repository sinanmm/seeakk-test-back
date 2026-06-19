import prisma from '../../config/prisma';
import moment from 'moment-timezone';
import { getWorkspaceTimeZone } from '../../services/User/followupService';
import logger from '../../utils/logger';
import { getApplicableHolidays } from '../holidays/holidays.service';
import { getWorkspaceWeeklyOffSettings, isWeeklyOffDateString } from '../holidays/weeklyOff.util';
import { lockUser } from '../../services/User/accountLockService';
import { startOfDay, endOfDay } from 'date-fns';
import {
  hasUserSubmittedToday,
  isSystemGeneratedRecord,
  requiresMandatoryAttendancePopup,
  resolveAttendanceSubmissionState,
} from './attendanceState.util';
import {
  normalizeAttendanceApplyType,
  requiresOfficeLocationValidation,
  toOfficeLocationProfile,
  validateOfficeLocation,
} from './attendanceLocation.util';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';

const createAttendanceServiceError = (message: string, statusCode = 400): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const getLocalDateString = (timeZone = 'UTC', date?: Date | string): string => {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  const d = date ? new Date(date) : new Date();
  return moment.tz(d, timeZone).format('YYYY-MM-DD');
};

const addMinutesToTime = (timeStr: string, minutes: number): string => {
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

const assertUserInWorkspace = async (userId: string, workspaceId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });

  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  const resolvedWorkspaceId = await resolveWorkspaceIdForUser(userId, user.workspaceId ?? null);
  if (!resolvedWorkspaceId || resolvedWorkspaceId !== workspaceId) {
    throw createAttendanceServiceError('You do not belong to this workspace.', 403);
  }

  return user;
};

const countEnabledOfficeLocations = async (workspaceId: string): Promise<number> =>
  (prisma as any).attendanceOfficeLocation.count({
    where: { workspaceId, isEnabled: true },
  });

/** Only the user's explicitly assigned active branch — never the first workspace location. */
const resolveAssignedOfficeBranch = async (
  workspaceId: string,
  attendanceOfficeLocationId?: string | null,
) => {
  if (!attendanceOfficeLocationId) return null;

  return (prisma as any).attendanceOfficeLocation.findFirst({
    where: {
      id: attendanceOfficeLocationId,
      workspaceId,
      isEnabled: true,
    },
  });
};

export type OfficeLocationSetupState = {
  officeLocationConfigured: boolean;
  officeBranchAssigned: boolean;
  locationValidationActive: boolean;
  setupMessage: string | null;
  assignedOffice: Awaited<ReturnType<typeof resolveAssignedOfficeBranch>>;
};

const resolveOfficeLocationSetup = async (
  workspaceId: string,
  user: { attendanceApplyType?: string | null; attendanceOfficeLocationId?: string | null },
): Promise<OfficeLocationSetupState> => {
  const enabledCount = await countEnabledOfficeLocations(workspaceId);
  const officeLocationConfigured = enabledCount > 0;
  const assignedOffice = await resolveAssignedOfficeBranch(
    workspaceId,
    user.attendanceOfficeLocationId ?? null,
  );
  const officeBranchAssigned = Boolean(assignedOffice);
  const fromOffice = normalizeAttendanceApplyType(user.attendanceApplyType) === 'FROM_OFFICE';

  let setupMessage: string | null = null;
  if (fromOffice) {
    if (!officeLocationConfigured) {
      setupMessage =
        'Office location is not configured yet. Please contact administrator.';
    } else if (!officeBranchAssigned) {
      setupMessage =
        'No office branch is assigned to your account. Please contact your administrator.';
    }
  }

  const locationValidationActive =
    fromOffice && officeLocationConfigured && officeBranchAssigned;

  return {
    officeLocationConfigured,
    officeBranchAssigned,
    locationValidationActive,
    setupMessage,
    assignedOffice,
  };
};

type SuccessfulLocationCheck = Extract<
  ReturnType<typeof validateOfficeLocation>,
  { ok: true }
>;

const buildLocationRecordFields = (
  payload: any,
  locationResult: SuccessfulLocationCheck | null,
  isInsideOfficeRadius: boolean,
) => ({
  latitude: payload.latitude ?? null,
  longitude: payload.longitude ?? null,
  gpsAccuracy: payload.gpsAccuracy ?? null,
  calculatedDistanceMeters: locationResult?.distanceMeters ?? null,
  officeLocationId: locationResult?.officeLocationId ?? null,
  isInsideOfficeRadius,
  isOfficeNetwork: isInsideOfficeRadius,
  geoLocation:
    payload.latitude != null && payload.longitude != null
      ? `${payload.latitude},${payload.longitude}`
      : payload.geoLocation ?? null,
});

export const getTodayStatus = async (userId: string, workspaceId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: {
      attendanceOfficeLocation: true,
    },
  });
  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }
  const resolvedWorkspaceId = await resolveWorkspaceIdForUser(userId, user.workspaceId ?? null);
  if (!resolvedWorkspaceId || resolvedWorkspaceId !== workspaceId) {
    throw createAttendanceServiceError('You do not belong to this workspace.', 403);
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const todayStr = getLocalDateString(timeZone);
  const applicableHolidays = await getApplicableHolidays(workspaceId, user);
  const holidayCheck = checkIsHoliday(applicableHolidays, todayStr);
  const { weeklyOffDays } = await getWorkspaceWeeklyOffSettings(workspaceId);
  const isWeeklyOff = isWeeklyOffDateString(todayStr, weeklyOffDays);

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
    isWeeklyOff,
  );
  const isMarked = hasUserSubmittedToday(submissionState);

  const attendanceApplyType = normalizeAttendanceApplyType(user.attendanceApplyType);
  const locationSetup = await resolveOfficeLocationSetup(workspaceId, {
    attendanceApplyType,
    attendanceOfficeLocationId: user.attendanceOfficeLocationId,
  });

  let targetLock: Awaited<ReturnType<typeof import('../targets/targetLockEvaluation.service').getTargetLockDisplayForUser>> = null;
  if (user.isLocked && user.targetLockedAt) {
    try {
      const { getTargetLockDisplayForUser } = await import('../targets/targetLockEvaluation.service');
      targetLock = await getTargetLockDisplayForUser(userId, workspaceId);
    } catch {
      targetLock = null;
    }
  }

  return {
    date: todayStr,
    isHoliday: holidayCheck.isHoliday,
    holidayName: holidayCheck.isHoliday ? holidayCheck.name : null,
    isWeeklyOff,
    weeklyOffLabel: isWeeklyOff ? 'Weekly Off' : null,
    isLocked: user.isLocked,
    isTargetLocked: Boolean(user.targetLockedAt),
    targetLock,
    isMarked,
    submissionState,
    requiresMandatoryPopup: requiresMandatoryAttendancePopup(submissionState, user.isLocked),
    record: existingRecord,
    attendanceApplyType,
    officeLocationConfigured: locationSetup.officeLocationConfigured,
    officeBranchAssigned: locationSetup.officeBranchAssigned,
    locationValidationActive: locationSetup.locationValidationActive,
    locationSetupMessage: locationSetup.setupMessage,
    assignedOfficeLocation: locationSetup.assignedOffice
      ? toOfficeLocationProfile(locationSetup.assignedOffice)
      : null,
  };
};

export const markAttendance = async (userId: string, workspaceId: string, payload: any) => {
  const user = await assertUserInWorkspace(userId, workspaceId);
  const attendanceApplyType = normalizeAttendanceApplyType(user.attendanceApplyType);

  if (user.isLocked) {
    throw createAttendanceServiceError('Your account is temporarily locked due to incomplete targets.', 423);
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const dateStr = payload.date || getLocalDateString(timeZone);
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
      logger.warn('Attendance check-in conflict error (409):', {
        userId,
        attendanceDate: dateStr,
        workspaceTimezone: timeZone,
        attendanceRecordFound: JSON.stringify(existingRecord),
        attendanceStatus: existingRecord.status,
        approvalStatus: existingRecord.approvalStatus,
        validationRuleTriggered: 'Duplicate check-in attempt for non-rejected record',
        actualErrorMessage: 'Attendance already marked for today.',
      });
      throw createAttendanceServiceError('Attendance already marked for today.', 409);
    }
  }

  const applicableHolidays = await getApplicableHolidays(workspaceId, user);
  const holidayCheck = checkIsHoliday(applicableHolidays, dateStr);
  const { weeklyOffDays } = await getWorkspaceWeeklyOffSettings(workspaceId);
  const isWeeklyOff = isWeeklyOffDateString(dateStr, weeklyOffDays);

  const isHoliday = holidayCheck.isHoliday;
  const holidayName = holidayCheck.isHoliday ? holidayCheck.name : null;
  const attendanceType = isWeeklyOff ? 'WEEKLY_OFF' : isHoliday ? 'HOLIDAY' : payload.attendanceType;

  const settings = await getSettings(workspaceId);

  let isInsideOfficeRadius = false;
  let locationValidationResult: ReturnType<typeof validateOfficeLocation> | null = null;

  if (requiresOfficeLocationValidation(attendanceApplyType, attendanceType)) {
    const locationSetup = await resolveOfficeLocationSetup(workspaceId, {
      attendanceApplyType,
      attendanceOfficeLocationId: user.attendanceOfficeLocationId,
    });

    if (!locationSetup.officeLocationConfigured) {
      const configError = createAttendanceServiceError(
        'Office location is not configured yet. Please contact administrator.',
        403,
      ) as Error & { errorCode?: string; details?: Record<string, unknown> };
      configError.errorCode = 'OFFICE_LOCATION_NOT_CONFIGURED';
      configError.details = { waitingForAdminSetup: true };
      throw configError;
    }

    if (!locationSetup.assignedOffice) {
      const branchError = createAttendanceServiceError(
        'No office branch is assigned to your account. Please contact your administrator.',
        403,
      ) as Error & { errorCode?: string; details?: Record<string, unknown> };
      branchError.errorCode = 'OFFICE_BRANCH_NOT_ASSIGNED';
      throw branchError;
    }

    const locationCheck = validateOfficeLocation(locationSetup.assignedOffice, {
      latitude: payload.latitude,
      longitude: payload.longitude,
      gpsAccuracy: payload.gpsAccuracy,
      locationCapturedAt: payload.locationCapturedAt,
    });

    if (!locationCheck.ok) {
      const error = createAttendanceServiceError(locationCheck.message, 403) as Error & {
        statusCode: number;
        errorCode?: string;
        details?: Record<string, unknown>;
      };
      error.errorCode = locationCheck.errorCode;
      error.details = locationCheck.details;
      throw error;
    }

    locationValidationResult = locationCheck;
    isInsideOfficeRadius = true;
  }

  const locationFields = buildLocationRecordFields(
    payload,
    locationValidationResult,
    isInsideOfficeRadius,
  );

  let warningCount = 0;
  let checkInTime = payload.checkInTime ? new Date(payload.checkInTime) : new Date();

  // Load custom schedule
  const schedule = await prisma.attendanceSchedule.findUnique({
    where: { userId },
  });

  // Settings warnings
  if (!isHoliday && !isWeeklyOff && ['PRESENT', 'HALF_DAY', 'WORK_FROM_HOME'].includes(attendanceType)) {
    if (settings.enableWarning) {
      const checkInHHMM = `${String(checkInTime.getHours()).padStart(2, '0')}:${String(checkInTime.getMinutes()).padStart(2, '0')}`;
      const cutoffTime = schedule
        ? (schedule.lateMarkThreshold || addMinutesToTime(schedule.checkInTime, schedule.gracePeriod))
        : settings.cutoffTime;

      if (checkInHHMM > cutoffTime) {
        warningCount = 1;
        await prisma.attendanceWarning.create({
          data: {
            userId,
            workspaceId,
            date: dateObj,
            warningType: 'LATE_CHECKIN',
            reason: `Late check-in at ${checkInHHMM}. Cutoff was ${cutoffTime}.`,
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
  try {
    if (existingRecord) {
      record = await prisma.attendanceRecord.update({
        where: { id: existingRecord.id },
        data: {
          checkInTime: isHoliday || isWeeklyOff ? null : checkInTime,
          attendanceType,
          status: approvalStatus === 'APPROVED' ? 'APPROVED' : 'PENDING',
          warningCount,
          isHoliday,
          holidayName: isWeeklyOff ? 'Weekly Off' : holidayName,
          isLocked: user.isLocked,
          createdBy: userId,
          attendanceApplyType,
          deviceInfo: payload.deviceInfo,
          approvalStatus,
          supervisorId: user.supervisorId,
          notes: payload.notes,
          attachmentUrl: payload.attachmentUrl,
          submittedAt: new Date(),
          rejectedReason: null,
          ...locationFields,
        },
      });
    } else {
      record = await prisma.attendanceRecord.create({
        data: {
          userId,
          workspaceId,
          date: dateObj,
          checkInTime: isHoliday || isWeeklyOff ? null : checkInTime,
          attendanceType,
          status: approvalStatus === 'APPROVED' ? 'APPROVED' : 'PENDING',
          warningCount,
          isHoliday,
          holidayName,
          isLocked: user.isLocked,
          createdBy: userId,
          attendanceApplyType,
          deviceInfo: payload.deviceInfo,
          approvalStatus,
          supervisorId: user.supervisorId,
          notes: payload.notes,
          attachmentUrl: payload.attachmentUrl,
          ...locationFields,
        },
      });
    }
  } catch (error: any) {
    if (error.code === 'P2002') {
      logger.warn('Attendance check-in db unique constraint violation (409):', {
        userId,
        attendanceDate: dateStr,
        workspaceTimezone: timeZone,
        attendanceRecordFound: 'Database unique constraint violation',
        attendanceStatus: 'N/A',
        approvalStatus: 'N/A',
        validationRuleTriggered: 'Unique database constraints (userId, date)',
        actualErrorMessage: error.message,
      });
      throw createAttendanceServiceError('Attendance already marked for today.', 409);
    }
    throw error;
  }

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'SUBMIT',
      details: JSON.stringify({
        module: 'attendance',
        attendanceType,
        approvalStatus,
        selfApproved: false,
        isInsideOfficeRadius,
        calculatedDistanceMeters: locationFields.calculatedDistanceMeters,
        officeLocationId: locationFields.officeLocationId,
        latitude: locationFields.latitude,
        longitude: locationFields.longitude,
        gpsAccuracy: locationFields.gpsAccuracy,
      }),
    },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'Attendance Created',
      details: `Attendance check-in created for date ${dateStr} as ${attendanceType}`,
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
              attendanceOfficeLocationId: true,
              attendanceOfficeLocation: {
                select: { id: true, officeName: true, branch: true },
              },
              role: { select: { name: true } },
              department: { select: { name: true } },
              supervisor: { select: { id: true, name: true } },
              attendanceSchedule: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.attendanceRecord.count({ where: whereClause }),
    ]);

    const actorIds = Array.from(
      new Set([
        ...records.map(r => r.approvedBy).filter(Boolean),
        ...records.map(r => r.rejectedBy).filter(Boolean)
      ])
    ) as string[];

    const actors = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });

    const actorMap = new Map(actors.map(a => [a.id, a.name]));

    const mapped = records.map(r => ({
      ...r,
      approvedByName: r.approvedBy ? actorMap.get(r.approvedBy) || 'Unknown' : null,
      rejectedByName: r.rejectedBy ? actorMap.get(r.rejectedBy) || 'Unknown' : null,
      complianceStatus:
        r.isInsideOfficeRadius || r.approvalStatus === 'APPROVED'
          ? 'COMPLIANT'
          : r.approvalStatus === 'PENDING'
            ? 'PENDING'
            : 'NON_COMPLIANT',
    }));

    return {
      records: mapped,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Otherwise, default to "Today's Users List" (show all active users merged with today's status)
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const todayStr = getLocalDateString(timeZone);
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
      attendanceOfficeLocation: {
        select: { id: true, officeName: true, branch: true, radiusMeters: true },
      },
      attendanceSchedule: true,
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

  const actorIds = Array.from(
    new Set([
      ...attendanceRecords.map(r => r.approvedBy).filter(Boolean),
      ...attendanceRecords.map(r => r.rejectedBy).filter(Boolean)
    ])
  ) as string[];

  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });

  const actorMap = new Map(actors.map(a => [a.id, a.name]));

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
        checkOutTime: record.checkOutTime,
        workingHours: record.workingHours,
        attendanceType: record.attendanceType,
        status: record.status,
        warningCount: record.warningCount,
        isHoliday: record.isHoliday,
        holidayName: record.holidayName,
        isLocked: user.isLocked,
        latitude: record.latitude,
        longitude: record.longitude,
        calculatedDistanceMeters: record.calculatedDistanceMeters,
        officeLocationId: record.officeLocationId,
        isInsideOfficeRadius: record.isInsideOfficeRadius,
        gpsAccuracy: record.gpsAccuracy,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork: record.isInsideOfficeRadius ?? record.isOfficeNetwork,
        deviceInfo: record.deviceInfo,
        geoLocation: record.geoLocation,
        complianceStatus:
          record.isInsideOfficeRadius || record.approvalStatus === 'APPROVED'
            ? 'COMPLIANT'
            : record.approvalStatus === 'PENDING'
              ? 'PENDING'
              : 'NON_COMPLIANT',
        approvalStatus: record.approvalStatus,
        approvedBy: record.approvedBy,
        approvedAt: record.approvedAt,
        approvedByName: record.approvedBy ? actorMap.get(record.approvedBy) || 'Unknown' : null,
        rejectedBy: record.rejectedBy,
        rejectedAt: record.rejectedAt,
        rejectedByName: record.rejectedBy ? actorMap.get(record.rejectedBy) || 'Unknown' : null,
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
        checkOutTime: null,
        workingHours: null,
        attendanceType: 'ABSENT',
        status: 'MARKED',
        warningCount: 0,
        isHoliday: false,
        holidayName: null,
        isLocked: user.isLocked,
        latitude: null,
        longitude: null,
        calculatedDistanceMeters: null,
        officeLocationId: null,
        isInsideOfficeRadius: false,
        gpsAccuracy: null,
        attendanceApplyType: user.attendanceApplyType,
        isOfficeNetwork: false,
        deviceInfo: null,
        geoLocation: null,
        complianceStatus: 'NOT_SUBMITTED',
        approvalStatus: 'NOT_SUBMITTED',
        approvedBy: null,
        approvedAt: null,
        approvedByName: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectedByName: null,
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
    // Approvers see supervisee requests and their own pending submissions (attendance allows self-approval).
    whereClause.OR = [{ supervisorId }, { userId: supervisorId }];
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

  const isSelfReview = record.userId === actorId;

  if (!['PENDING', 'PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(record.approvalStatus)) {
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

  // Attendance module: self-approve/reject allowed when actor has approve_attendance (route-level RBAC).
  // Lead/stage approvals use separate services and still forbid self-approval.
  if (
    !isSelfReview &&
    !isWorkspaceAdmin &&
    record.supervisorId !== actorId &&
    record.user?.supervisorId !== actorId
  ) {
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
      rejectedBy: action === 'REJECT' ? actorId : null,
      rejectedAt: action === 'REJECT' ? new Date() : null,
    },
  });

  const reviewedAt = new Date();

  await prisma.attendanceApprovalLog.create({
    data: {
      attendanceRecordId: recordId,
      action,
      actorId,
      reason,
    },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actorId,
      action: action === 'APPROVE' ? 'Attendance Approved' : 'Attendance Rejected',
      details: JSON.stringify({
        module: 'attendance',
        selfApproved: isSelfReview,
        approvedBy: actorId,
        approvedAt: reviewedAt.toISOString(),
        attendanceRecordId: recordId,
        targetUserId: record.userId,
        action,
        ...(reason ? { reason } : {}),
      }),
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

export const updateUserOfficeBranch = async (
  workspaceId: string,
  userId: string,
  attendanceOfficeLocationId: string | null,
) => {
  if (attendanceOfficeLocationId) {
    const location = await (prisma as any).attendanceOfficeLocation.findFirst({
      where: { id: attendanceOfficeLocationId, workspaceId, isEnabled: true },
    });
    if (!location) {
      throw createAttendanceServiceError('Invalid or inactive office branch.', 404);
    }
  }

  return prisma.user.update({
    where: { id: userId, workspaceId },
    data: { attendanceOfficeLocationId },
    include: {
      attendanceOfficeLocation: {
        select: { id: true, officeName: true, branch: true },
      },
    },
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
  const weeklyOffCount = records.filter((r) => r.attendanceType === 'WEEKLY_OFF').length;
  const totalWarnings = await prisma.attendanceWarning.count({ where: { userId, workspaceId } });

  const totalWorkingDays = records.length - holidayCount - weeklyOffCount;

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
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const todayStr = getLocalDateString(timeZone);
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
  const existing = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, isLocked: true, targetLockedAt: true },
  });

  if (!existing) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  let user = existing;

  if (existing.isLocked && existing.targetLockedAt) {
    const { unlockTargetLockedUser } = await import('../targets/targetUnlock.service');
    user = await unlockTargetLockedUser(
      workspaceId,
      userId,
      {
        id: actorId,
        permissions: ['USERS_UNLOCK', 'unlock_target_locked_users', 'unlock_attendance_locked_users', 'SYSTEM_CONFIG'],
      },
      'Unlocked from attendance module (target lock)',
    );
  } else if (existing.isLocked) {
    user = await prisma.user.update({
      where: { id: userId, workspaceId },
      data: { isLocked: false, isActive: true },
    });
  }

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

// Office location settings CRUD
export const getOfficeLocations = async (workspaceId: string) => {
  return (prisma as any).attendanceOfficeLocation.findMany({
    where: { workspaceId },
    orderBy: [{ officeName: 'asc' }, { branch: 'asc' }],
  });
};

export const createOfficeLocation = async (workspaceId: string, data: any) => {
  return (prisma as any).attendanceOfficeLocation.create({
    data: {
      workspaceId,
      officeName: data.officeName,
      branch: data.branch,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters ?? 50,
      isEnabled: data.isEnabled ?? true,
    },
  });
};

export const updateOfficeLocation = async (workspaceId: string, id: string, data: any) => {
  const existing = await (prisma as any).attendanceOfficeLocation.findFirst({
    where: { id, workspaceId },
  });
  if (!existing) {
    throw createAttendanceServiceError('Office location not found.', 404);
  }
  return (prisma as any).attendanceOfficeLocation.update({
    where: { id },
    data: {
      officeName: data.officeName,
      branch: data.branch,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters,
      isEnabled: data.isEnabled,
    },
  });
};

export const deleteOfficeLocation = async (workspaceId: string, id: string) => {
  const existing = await (prisma as any).attendanceOfficeLocation.findFirst({
    where: { id, workspaceId },
  });
  if (!existing) {
    throw createAttendanceServiceError('Office location not found.', 404);
  }
  await prisma.user.updateMany({
    where: { attendanceOfficeLocationId: id, workspaceId },
    data: { attendanceOfficeLocationId: null },
  });
  return (prisma as any).attendanceOfficeLocation.delete({ where: { id } });
};

/** @deprecated Alias for getOfficeLocations — /networks route backward compatibility */
export const getNetworks = getOfficeLocations;
export const createNetwork = createOfficeLocation;
export const updateNetwork = updateOfficeLocation;
export const deleteNetwork = deleteOfficeLocation;

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

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const todayStr = getLocalDateString(timeZone);
  const dateObj = new Date(todayStr);

  const settings = await getSettings(workspaceId);
  const now = moment().tz(timeZone);
  const currentHHMM = `${String(now.hours()).padStart(2, '0')}:${String(now.minutes()).padStart(2, '0')}`;

  const schedules = await prisma.attendanceSchedule.findMany({
    where: { workspaceId },
  });
  const scheduleMap = new Map(schedules.map(s => [s.userId, s]));

  for (const user of users) {
    const schedule = scheduleMap.get(user.id);
    const userCutoff = schedule
      ? (schedule.lateMarkThreshold || addMinutesToTime(schedule.checkInTime, schedule.gracePeriod))
      : settings.cutoffTime;

    if (currentHHMM > userCutoff) {
      const applicableHolidays = await getApplicableHolidays(workspaceId, user);
      const holidayCheck = checkIsHoliday(applicableHolidays, todayStr);
      const { weeklyOffDays } = await getWorkspaceWeeklyOffSettings(workspaceId);
      const isWeeklyOff = isWeeklyOffDateString(todayStr, weeklyOffDays);

      if (holidayCheck.isHoliday || isWeeklyOff) {
        await prisma.attendanceRecord.upsert({
          where: {
            userId_date: { userId: user.id, date: dateObj },
          },
          update: {},
          create: {
            userId: user.id,
            workspaceId,
            date: dateObj,
            attendanceType: isWeeklyOff ? 'WEEKLY_OFF' : 'HOLIDAY',
            status: 'APPROVED',
            approvalStatus: 'APPROVED',
            isHoliday: holidayCheck.isHoliday,
            holidayName: holidayCheck.isHoliday ? holidayCheck.name : isWeeklyOff ? 'Weekly Off' : null,
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

export const checkOut = async (userId: string, workspaceId: string, data: any) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
  });

  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const todayStr = getLocalDateString(timeZone);
  const dateObj = new Date(todayStr);

  const record = await prisma.attendanceRecord.findUnique({
    where: {
      userId_date: {
        userId,
        date: dateObj,
      },
    },
  });

  if (!record) {
    throw createAttendanceServiceError('Check-in is required before checking out.', 400);
  }

  if (record.approvalStatus === 'APPROVED') {
    throw createAttendanceServiceError('Attendance has already been approved and cannot be modified.', 400);
  }

  if (!record.checkInTime) {
    throw createAttendanceServiceError('Cannot check out without a check-in record.', 400);
  }

  const checkOutTime = new Date();
  const workingHours = parseFloat(((checkOutTime.getTime() - record.checkInTime.getTime()) / (1000 * 60 * 60)).toFixed(2));

  // Load custom schedule
  const schedule = await prisma.attendanceSchedule.findUnique({
    where: { userId },
  });

  let attendanceType = record.attendanceType;
  if (['PRESENT', 'WORK_FROM_HOME', 'HALF_DAY'].includes(record.attendanceType)) {
    const reqHours = schedule?.workingHoursRequirement ?? 8.0;
    const halfDayHours = schedule?.halfDayThreshold ?? 4.0;

    if (workingHours < halfDayHours) {
      attendanceType = 'ABSENT';
    } else if (workingHours < reqHours) {
      attendanceType = 'HALF_DAY';
    }
  }

  const updatedRecord = await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      checkOutTime,
      workingHours,
      workSummary: data.workSummary,
      achievements: data.achievements ?? null,
      pendingTasks: data.pendingTasks ?? null,
      challenges: data.challenges ?? null,
      additionalNotes: data.additionalNotes ?? null,
      attendanceType,
      status: 'PENDING',
      approvalStatus: 'PENDING_APPROVAL',
      submittedAt: new Date(),
    },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'Summary Submitted',
      details: JSON.stringify({
        module: 'attendance',
        attendanceType,
        workingHours,
        workSummary: data.workSummary,
        achievements: data.achievements ?? null,
        pendingTasks: data.pendingTasks ?? null,
        challenges: data.challenges ?? null,
        additionalNotes: data.additionalNotes ?? null,
      }),
    },
  });

  if (user.supervisorId) {
    await prisma.attendanceNotification.create({
      data: {
        workspaceId,
        userId: user.supervisorId,
        title: 'Attendance Check-Out Review',
        message: `${user.name || 'An employee'} checked out and submitted a work summary for approval.`,
      },
    });
  }

  return updatedRecord;
};

export const getSchedules = async (workspaceId: string) => {
  const users = await prisma.user.findMany({
    where: { workspaceId, deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      department: { select: { name: true } },
      role: { select: { name: true } },
      attendanceSchedule: true,
    },
    orderBy: { name: 'asc' },
  });

  return users;
};

export const getSchedule = async (userId: string, workspaceId: string) => {
  const schedule = await prisma.attendanceSchedule.findUnique({
    where: { userId },
  });

  return schedule;
};

export const updateSchedule = async (userId: string, workspaceId: string, data: any, actorId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
  });

  if (!user) {
    throw createAttendanceServiceError('User not found.', 404);
  }

  const schedule = await prisma.attendanceSchedule.upsert({
    where: { userId },
    update: {
      checkInTime: data.checkInTime,
      checkOutTime: data.checkOutTime,
      gracePeriod: data.gracePeriod,
      lateMarkThreshold: data.lateMarkThreshold,
      halfDayThreshold: data.halfDayThreshold,
      workingHoursRequirement: data.workingHoursRequirement,
    },
    create: {
      userId,
      workspaceId,
      checkInTime: data.checkInTime,
      checkOutTime: data.checkOutTime,
      gracePeriod: data.gracePeriod,
      lateMarkThreshold: data.lateMarkThreshold,
      halfDayThreshold: data.halfDayThreshold,
      workingHoursRequirement: data.workingHoursRequirement,
    },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actorId,
      action: 'Attendance Schedule Changed',
      details: JSON.stringify({
        module: 'attendance',
        targetUserId: userId,
        schedule,
      }),
    },
  });

  return schedule;
};

export const requestClarification = async (workspaceId: string, recordId: string, actorId: string, reason: string) => {
  if (!reason) {
    throw createAttendanceServiceError('Clarification request reason is mandatory.', 400);
  }

  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, workspaceId },
  });

  if (!record) {
    throw createAttendanceServiceError('Attendance record not found', 404);
  }

  const updatedRecord = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: {
      approvalStatus: 'CLARIFICATION_REQUESTED',
      rejectedReason: reason,
    },
  });

  await prisma.attendanceApprovalLog.create({
    data: {
      attendanceRecordId: recordId,
      action: 'CLARIFICATION_REQUESTED',
      actorId,
      reason,
    },
  });

  await prisma.attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actorId,
      action: 'Request Clarification',
      details: JSON.stringify({
        module: 'attendance',
        attendanceRecordId: recordId,
        targetUserId: record.userId,
        reason,
      }),
    },
  });

  await prisma.attendanceNotification.create({
    data: {
      workspaceId,
      userId: record.userId,
      title: 'Clarification Requested',
      message: `Your supervisor requested clarification for your attendance on ${new Date(record.date).toLocaleDateString()}.`,
    },
  });

  return updatedRecord;
};

export const getApprovalHistory = async (workspaceId: string) => {
  const records = await prisma.attendanceRecord.findMany({
    where: {
      workspaceId,
      approvalStatus: { in: ['APPROVED', 'REJECTED'] },
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          department: { select: { name: true } },
          role: { select: { name: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  const actorIds = Array.from(
    new Set([
      ...records.map(r => r.approvedBy).filter(Boolean),
      ...records.map(r => r.rejectedBy).filter(Boolean)
    ])
  ) as string[];

  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });

  const actorMap = new Map(actors.map(a => [a.id, a.name]));

  return records.map(r => ({
    ...r,
    approvedByName: r.approvedBy ? actorMap.get(r.approvedBy) || 'Unknown' : null,
    rejectedByName: r.rejectedBy ? actorMap.get(r.rejectedBy) || 'Unknown' : null,
  }));
};
