import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { getApplicableHolidays } from '../holidays/holidays.service';
import { getWorkspaceWeeklyOffSettings, isWeeklyOffDateString } from '../holidays/weeklyOff.util';

export type AttendanceCalendarDayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'EARLY_CHECKOUT'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'HOLIDAY'
  | 'LEAVE'
  | 'WORK_FROM_HOME'
  | 'WEEKEND'
  | 'NO_ATTENDANCE';

export interface CalendarDayDetail {
  date: string; // YYYY-MM-DD
  dayOfWeek: string;
  dayNumber: number;
  status: AttendanceCalendarDayStatus;
  statusLabel: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  workingHours: number;
  breakTimeMinutes: number;
  lateMinutes: number;
  earlyCheckoutMinutes: number;
  officeName: string | null;
  gpsStatus: 'VERIFIED' | 'OUTSIDE_RADIUS' | 'BYPASSED' | 'N/A';
  ipStatus: 'VERIFIED' | 'UNKNOWN_IP' | 'N/A';
  deviceInfo: string | null;
  approvedBy: string | null;
  approvalStatus: string | null;
  remarks: string | null;
  workSummary: string | null;
  achievements: string | null;
  pendingTasks: string | null;
  leaveDetails: {
    leaveType: string;
    reason: string;
    approvalStatus: string;
  } | null;
  holidayDetails: {
    name: string;
  } | null;
  recordId?: string | null;
}

export interface CalendarSummaryMetrics {
  totalDaysInMonth: number;
  workingDaysCount: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  leaveDays: number;
  halfDays: number;
  totalWorkingHours: number;
  avgCheckInTime: string;
  avgCheckOutTime: string;
  attendancePercentage: number;
}

export interface AttendanceCalendarResponse {
  user: {
    id: string;
    name: string;
    email: string;
    roleName: string | null;
    departmentName: string | null;
    officeName: string | null;
    profileImage: string | null;
  };
  month: number;
  year: number;
  summary: CalendarSummaryMetrics;
  days: CalendarDayDetail[];
}

import { resolveWorkspaceTimezone, formatTimeInTimezone } from '../../utils/timezoneContext';

/** Helper to convert JS Date / string to YYYY-MM-DD */
const formatDateStr = (date: Date | string): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Helper to format ISO time or Date to hh:mm AM/PM in target timezone */
const formatTimeString = (dateInput?: Date | string | null, timeZone = 'Asia/Kolkata'): string | null => {
  if (!dateInput) return null;
  return formatTimeInTimezone(dateInput, timeZone);
};

/** Fetch permitted offices for attendance calendar filtering */
export const getPermittedCalendarOffices = async (requestingUser: any) => {
  logger.info(`[Attendance Calendar] Loading Offices for user: ${requestingUser.id}`);
  const workspaceId = requestingUser.workspaceId;

  const offices = await prisma.office.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  let attendanceOfficeLocations: any[] = [];
  try {
    attendanceOfficeLocations = await (prisma as any).attendanceOfficeLocation.findMany({
      where: { workspaceId, isEnabled: true },
      select: { id: true, officeName: true, name: true, branch: true },
    });
  } catch (e) {
    // optional fallback
  }

  const officeList: Array<{ id: string; name: string }> = offices.map((o) => ({
    id: o.id,
    name: o.name,
  }));

  attendanceOfficeLocations.forEach((aol) => {
    const name = aol.officeName || aol.name || aol.branch;
    if (name && !officeList.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      officeList.push({ id: aol.id, name });
    }
  });

  logger.info(`[Attendance Calendar] Offices Loaded: count=${officeList.length}`);
  return officeList;
};

/** Fetch permitted users for attendance calendar filtering (supports officeId dependency) */
export const getPermittedCalendarUsers = async (requestingUser: any, officeId?: string) => {
  logger.info(
    `[Attendance Calendar] Loading Users for user: ${requestingUser.id}, officeFilter: ${officeId || 'ALL'}`,
  );
  const workspaceId = requestingUser.workspaceId;

  const reqPermissions: string[] = requestingUser.permissions || [];
  const reqRoleName = (requestingUser.role?.name || requestingUser.roleName || '').toUpperCase();
  const isSuperOrAdmin = reqRoleName === 'SUPERADMIN' || reqRoleName === 'ADMIN';

  const hasViewAll =
    isSuperOrAdmin ||
    reqPermissions.includes('view_all_attendance_calendar') ||
    reqPermissions.includes('view_all_attendance');

  const hasViewAssigned = reqPermissions.includes('view_assigned_attendance_calendar');

  const whereClause: any = {
    workspaceId,
    deletedAt: null,
    isActive: true,
  };

  if (officeId && officeId.trim() !== '') {
    whereClause.OR = [{ officeId }, { attendanceOfficeLocationId: officeId }];
  }

  if (!hasViewAll) {
    if (hasViewAssigned) {
      const subordinates = await prisma.user.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          isActive: true,
          OR: [{ id: requestingUser.id }, { supervisorId: requestingUser.id }],
        },
        select: { id: true },
      });

      const allowedUserIds = subordinates.map((s) => s.id);
      whereClause.id = { in: allowedUserIds };
    } else {
      whereClause.id = requestingUser.id;
    }
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    include: {
      role: { select: { name: true } },
      office: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const formattedUsers = users.map((u: any) => ({
    id: u.id,
    name: u.name || 'Unnamed Staff',
    email: u.email || '',
    profileImage: u.avatar || u.profileImage || null,
    roleName: u.role?.name || 'Staff',
    officeName: u.office?.name || 'HQ Office',
    officeId: u.officeId || u.attendanceOfficeLocationId || null,
  }));

  logger.info(`[Attendance Calendar] Users Loaded: count=${formattedUsers.length}`);
  return formattedUsers;
};

/** Check if targetUserId is within requestingUser's scope based on permissions & reporting hierarchy */
export const resolveUserScopeAllowed = async (
  requestingUser: any,
  targetUserId: string,
  workspaceId: string,
): Promise<boolean> => {
  if (requestingUser.id === targetUserId) return true;

  const reqPermissions: string[] = requestingUser.permissions || [];
  const reqRoleName = (requestingUser.role?.name || requestingUser.roleName || '').toUpperCase();

  const isSuperOrAdmin = reqRoleName === 'SUPERADMIN' || reqRoleName === 'ADMIN';
  const hasViewAll =
    isSuperOrAdmin ||
    reqPermissions.includes('view_all_attendance_calendar') ||
    reqPermissions.includes('view_all_attendance');

  if (hasViewAll) return true;

  const hasViewAssigned = reqPermissions.includes('view_assigned_attendance_calendar');
  if (hasViewAssigned) {
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, workspaceId, deletedAt: null },
      select: { id: true, supervisorId: true, officeId: true },
    });

    if (!targetUser) return false;

    if (targetUser.supervisorId === requestingUser.id) {
      return true;
    }

    let currentSupervisorId = targetUser.supervisorId;
    let depth = 0;
    while (currentSupervisorId && depth < 5) {
      if (currentSupervisorId === requestingUser.id) return true;
      const parentUser = await prisma.user.findUnique({
        where: { id: currentSupervisorId },
        select: { id: true, supervisorId: true },
      });
      currentSupervisorId = parentUser?.supervisorId || null;
      depth++;
    }

    if (requestingUser.officeId && targetUser.officeId === requestingUser.officeId) {
      return true;
    }
  }

  return false;
};

/** Get Attendance Calendar Data for a specific User and Month */
export const getAttendanceCalendarData = async (
  requestingUser: any,
  params: {
    userId?: string;
    month: number;
    year: number;
    officeId?: string;
    departmentId?: string;
    roleId?: string;
    status?: string;
  },
): Promise<AttendanceCalendarResponse> => {
  logger.info('[Attendance Calendar] Attendance Calendar Request');
  if (params.officeId) logger.info(`[Attendance Calendar] Office Filter Applied: ${params.officeId}`);
  if (params.userId) logger.info(`[Attendance Calendar] User Filter Applied: ${params.userId}`);
  if (params.status) logger.info(`[Attendance Calendar] Status Filter Applied: ${params.status}`);

  const workspaceId = requestingUser.workspaceId;
  const targetUserId = params.userId || requestingUser.id;
  const timeZone = await resolveWorkspaceTimezone(workspaceId, targetUserId);

  // Validate permission scope
  const isAllowed = await resolveUserScopeAllowed(requestingUser, targetUserId, workspaceId);
  if (!isAllowed) {
    logger.warn(`[Attendance Calendar] Permission Denied for user ${requestingUser.id} viewing ${targetUserId}`);
    const error = new Error('You do not have permission to view attendance calendar for this user.') as any;
    error.statusCode = 403;
    throw error;
  }

  // Fetch Target User details
  const targetUser: any = await prisma.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    include: {
      role: true,
      department: true,
      office: true,
    },
  });

  if (!targetUser) {
    const error = new Error('User not found.') as any;
    error.statusCode = 404;
    throw error;
  }

  let officeName: string | null = targetUser.office?.name || null;
  if (!officeName && targetUser.attendanceOfficeLocationId) {
    try {
      const officeLoc: any = await (prisma as any).attendanceOfficeLocation.findUnique({
        where: { id: targetUser.attendanceOfficeLocationId },
      });
      if (officeLoc) officeName = officeLoc.officeName || officeLoc.name || null;
    } catch (e) {
      // ignore if table varies
    }
  }

  // Calculate Date Boundaries
  const year = Number(params.year);
  const month = Number(params.month); // 1-indexed (1 to 12)
  const daysInMonth = new Date(year, month, 0).getDate();

  const startDateObj = new Date(year, month - 1, 1, 0, 0, 0);
  const endDateObj = new Date(year, month - 1, daysInMonth, 23, 59, 59);

  // 1. Fetch Attendance Records for target user in target month
  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: {
      userId: targetUserId,
      workspaceId,
      date: {
        gte: startDateObj,
        lte: endDateObj,
      },
    },
    orderBy: { date: 'asc' },
  });

  const recordsByDateMap = new Map<string, any>();
  attendanceRecords.forEach((rec) => {
    const dateKey = formatDateStr(rec.date);
    recordsByDateMap.set(dateKey, rec);
  });

  // 2. Fetch Applicable Holidays for workspace
  const holidays = await getApplicableHolidays(workspaceId, year);

  // 3. Fetch Workspace Weekly Off Settings
  const weeklyOffSettings = await getWorkspaceWeeklyOffSettings(workspaceId);

  // 4. Fetch Approved Leave Requests for this user overlapping this month
  let leaveRequests: any[] = [];
  try {
    leaveRequests = await (prisma as any).leaveRequest.findMany({
      where: {
        userId: targetUserId,
        approvalStatus: 'APPROVED',
        startDate: { lte: endDateObj },
        endDate: { gte: startDateObj },
      },
    });
  } catch (err) {
    logger.info('[Attendance Calendar] LeaveRequest table check passed');
  }

  // 5. Fetch User Attendance Schedule for timing thresholds
  let scheduleGracePeriod = 15;
  let scheduleCheckInTime = '09:00';
  let scheduleCheckOutTime = '18:00';

  try {
    const userSchedule: any = await (prisma as any).attendanceSchedule.findUnique({
      where: { userId: targetUserId },
    });
    if (userSchedule) {
      scheduleGracePeriod = userSchedule.gracePeriod ?? 15;
      if (userSchedule.checkInTime) scheduleCheckInTime = userSchedule.checkInTime;
      if (userSchedule.checkOutTime) scheduleCheckOutTime = userSchedule.checkOutTime;
    }
  } catch (e) {
    // default threshold applies
  }

  // Build Day by Day calendar list
  const days: CalendarDayDetail[] = [];
  const todayStr = formatDateStr(new Date());

  let totalPresentCount = 0;
  let totalAbsentCount = 0;
  let totalLateCount = 0;
  let totalLeaveCount = 0;
  let totalHalfDayCount = 0;
  let sumWorkingHours = 0;
  let checkInMinutesSum = 0;
  let checkInCount = 0;
  let checkOutMinutesSum = 0;
  let checkOutCount = 0;
  let totalWorkingDays = 0;

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const currentDateObj = new Date(year, month - 1, dayNum);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeekName = currentDateObj.toLocaleDateString('en-US', { weekday: 'short' });

    const rec = recordsByDateMap.get(dateStr);
    const isFuture = dateStr > todayStr;

    // Check holiday status
    const holidayCheck = holidays.find((h: any) => {
      const hStr =
        typeof h.holidayDate === 'string'
          ? h.holidayDate.split('T')[0]
          : new Date(h.holidayDate).toISOString().split('T')[0];
      const [, hm, hd] = hStr.split('-');
      if (h.isRecurring) {
        return Number(hm) === month && Number(hd) === dayNum;
      }
      return dateStr === hStr;
    });

    // Check weekly off status
    const isWeeklyOff = isWeeklyOffDateString(dateStr, weeklyOffSettings.weeklyOffDays);

    // Check leave status
    const activeLeave = leaveRequests.find((l: any) => {
      const lStart = formatDateStr(l.startDate);
      const lEnd = formatDateStr(l.endDate);
      return dateStr >= lStart && dateStr <= lEnd;
    });

    let status: AttendanceCalendarDayStatus = 'NO_ATTENDANCE';
    let statusLabel = 'No Record';
    let checkInFormatted: string | null = null;
    let checkOutFormatted: string | null = null;
    let workingHours = 0;
    let breakTimeMinutes = 0;
    let lateMinutes = 0;
    let earlyCheckoutMinutes = 0;
    let gpsStatus: 'VERIFIED' | 'OUTSIDE_RADIUS' | 'BYPASSED' | 'N/A' = 'N/A';
    let ipStatus: 'VERIFIED' | 'UNKNOWN_IP' | 'N/A' = 'N/A';
    let deviceInfo: string | null = null;
    let approvedByName: string | null = null;
    let approvalStatus: string | null = null;
    let remarks: string | null = null;
    let workSummary: string | null = null;
    let achievements: string | null = null;
    let pendingTasks: string | null = null;
    let recordId: string | null = null;

    if (!isWeeklyOff && !holidayCheck) {
      totalWorkingDays++;
    }

    if (rec) {
      recordId = rec.id;
      checkInFormatted = formatTimeString(rec.checkInTime, timeZone);
      checkOutFormatted = formatTimeString(rec.checkOutTime, timeZone);
      workingHours = Number(rec.workingHours || 0);
      breakTimeMinutes = Number(rec.breakTimeMinutes || 0);
      approvalStatus = rec.approvalStatus || 'APPROVED';
      approvedByName = rec.approvedBy || null;
      remarks = rec.notes || rec.rejectedReason || null;
      workSummary = rec.workSummary || null;
      achievements = rec.achievements || null;
      pendingTasks = rec.pendingTasks || null;
      deviceInfo = rec.deviceInfo || rec.userAgent || null;

      // GPS & IP status
      if (rec.isInsideOfficeRadius) {
        gpsStatus = 'VERIFIED';
      } else if (rec.calculatedDistanceMeters != null) {
        gpsStatus = 'OUTSIDE_RADIUS';
      } else {
        gpsStatus = 'N/A';
      }

      if (rec.isOfficeNetwork) {
        ipStatus = 'VERIFIED';
      } else if (rec.ipAddress) {
        ipStatus = 'UNKNOWN_IP';
      } else {
        ipStatus = 'N/A';
      }

      // Calculate late & early checkout minutes if applicable
      if (rec.checkInTime) {
        const cIn = new Date(rec.checkInTime);
        const [schH, schM] = scheduleCheckInTime.split(':').map(Number);
        const expectedCheckIn = new Date(cIn.getFullYear(), cIn.getMonth(), cIn.getDate(), schH, schM, 0);
        const diffMins = Math.floor((cIn.getTime() - expectedCheckIn.getTime()) / (1000 * 60));
        if (diffMins > scheduleGracePeriod) {
          lateMinutes = diffMins;
        }

        checkInMinutesSum += cIn.getHours() * 60 + cIn.getMinutes();
        checkInCount++;
      }

      if (rec.checkOutTime) {
        const cOut = new Date(rec.checkOutTime);
        const [schOutH, schOutM] = scheduleCheckOutTime.split(':').map(Number);
        const expectedCheckOut = new Date(cOut.getFullYear(), cOut.getMonth(), cOut.getDate(), schOutH, schOutM, 0);
        const diffOutMins = Math.floor((expectedCheckOut.getTime() - cOut.getTime()) / (1000 * 60));
        if (diffOutMins > 0) {
          earlyCheckoutMinutes = diffOutMins;
        }

        checkOutMinutesSum += cOut.getHours() * 60 + cOut.getMinutes();
        checkOutCount++;
      }

      sumWorkingHours += workingHours;

      // Determine Status Classification
      const typeUpper = (rec.attendanceType || '').toUpperCase();
      if (rec.approvalStatus === 'REJECTED') {
        status = 'ABSENT';
        statusLabel = 'Absent';
        totalAbsentCount++;
      } else if (typeUpper === 'LEAVE') {
        status = 'LEAVE';
        statusLabel = rec.approvalStatus === 'APPROVED'
          ? (rec.isPaidLeave ? 'Leave (Paid)' : 'Leave (Unpaid)')
          : 'Leave (Pending)';
        totalLeaveCount++;
      } else if (typeUpper === 'WORK_FROM_HOME') {
        status = 'WORK_FROM_HOME';
        statusLabel = rec.approvalStatus === 'APPROVED' ? 'Work From Home' : 'Work From Home (Pending)';
        totalPresentCount++;
      } else if (typeUpper === 'HALF_DAY') {
        status = 'HALF_DAY';
        statusLabel = 'Half Day';
        totalHalfDayCount++;
      } else if (typeUpper === 'ABSENT') {
        status = 'ABSENT';
        statusLabel = 'Absent';
        totalAbsentCount++;
      } else if (lateMinutes > 0) {
        status = 'LATE';
        statusLabel = `Late Check-In (${lateMinutes}m)`;
        totalLateCount++;
        totalPresentCount++;
      } else if (earlyCheckoutMinutes > 0) {
        status = 'EARLY_CHECKOUT';
        statusLabel = `Early Check-Out (${earlyCheckoutMinutes}m)`;
        totalPresentCount++;
      } else {
        status = 'PRESENT';
        statusLabel = 'Present';
        totalPresentCount++;
      }
    } else if (activeLeave) {
      status = 'LEAVE';
      statusLabel = `Leave (${activeLeave.leaveType || 'Approved'})`;
      totalLeaveCount++;
    } else if (holidayCheck) {
      status = 'HOLIDAY';
      statusLabel = `Holiday (${holidayCheck.name})`;
    } else if (isWeeklyOff) {
      status = 'WEEKEND';
      statusLabel = 'Weekly Off';
    } else if (!isFuture) {
      status = 'ABSENT';
      statusLabel = 'Unmarked / Absent';
      totalAbsentCount++;
    } else {
      status = 'NO_ATTENDANCE';
      statusLabel = 'Scheduled';
    }

    days.push({
      date: dateStr,
      dayOfWeek: dayOfWeekName,
      dayNumber: dayNum,
      status,
      statusLabel,
      checkInTime: checkInFormatted,
      checkOutTime: checkOutFormatted,
      workingHours: Math.round(workingHours * 100) / 100,
      breakTimeMinutes,
      lateMinutes,
      earlyCheckoutMinutes,
      officeName,
      gpsStatus,
      ipStatus,
      deviceInfo,
      approvedBy: approvedByName,
      approvalStatus,
      remarks,
      workSummary,
      achievements,
      pendingTasks,
      leaveDetails: activeLeave
        ? {
            leaveType: activeLeave.leaveType || 'Leave',
            reason: activeLeave.reason || 'Approved Leave',
            approvalStatus: activeLeave.approvalStatus || 'APPROVED',
          }
        : null,
      holidayDetails: holidayCheck ? { name: holidayCheck.name } : null,
      recordId,
    });
  }

  // Format Average Times
  const formatMinsToAmPm = (avgMins: number): string => {
    if (avgMins <= 0) return '—';
    const hours24 = Math.floor(avgMins / 60) % 24;
    const mins = Math.floor(avgMins % 60);
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${String(hours12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${period}`;
  };

  const avgCheckInTime = checkInCount > 0 ? formatMinsToAmPm(checkInMinutesSum / checkInCount) : '—';
  const avgCheckOutTime = checkOutCount > 0 ? formatMinsToAmPm(checkOutMinutesSum / checkOutCount) : '—';

  const effectiveWorkingDays = totalWorkingDays > 0 ? totalWorkingDays : 1;
  const attendancePercentage = Math.min(
    100,
    Math.round(((totalPresentCount + totalHalfDayCount * 0.5) / effectiveWorkingDays) * 100),
  );

  const summary: CalendarSummaryMetrics = {
    totalDaysInMonth: daysInMonth,
    workingDaysCount: totalWorkingDays,
    presentDays: totalPresentCount,
    absentDays: totalAbsentCount,
    lateDays: totalLateCount,
    leaveDays: totalLeaveCount,
    halfDays: totalHalfDayCount,
    totalWorkingHours: Math.round(sumWorkingHours * 10) / 10,
    avgCheckInTime,
    avgCheckOutTime,
    attendancePercentage: isNaN(attendancePercentage) ? 0 : attendancePercentage,
  };

  logger.info('[Attendance Calendar] Calendar Response Returned');

  return {
    user: {
      id: targetUser.id,
      name: targetUser.name || 'Staff User',
      email: targetUser.email || '',
      roleName: targetUser.role?.name || null,
      departmentName: targetUser.department?.name || null,
      officeName,
      profileImage: targetUser.avatar || targetUser.profileImage || null,
    },
    month,
    year,
    summary,
    days,
  };
};
