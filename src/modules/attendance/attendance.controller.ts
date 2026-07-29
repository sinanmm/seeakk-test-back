import { Request, Response, NextFunction } from 'express';
import * as attendanceService from './attendance.service';
import { getAttendanceCalendarData } from './attendanceCalendar.service';
import { emitWorkspaceEvent } from '../../realtime/socket';
import { applyCorsHeadersIfAllowed } from '../../config/cors';
import { sanitizeCsvRow } from '../../utils/excelSanitizer';
import type { AttendanceRequest } from './attendance.middleware';
import {
  attendanceOfficeLocationSchema,
  attendanceQuerySchema,
  attendanceScheduleSchema,
  attendanceUserSettingSchema,
  assignOfficeBranchSchema,
  checkOutAttendanceSchema,
  markAttendanceSchema,
  updateSettingsSchema,
} from './attendance.validation';

const getAttendanceWorkspaceId = (req: AttendanceRequest, res: Response): string | null => {
  const workspaceId = req.attendanceWorkspaceId ?? req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      errorCode: 'WORKSPACE_NOT_LINKED',
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }
  return workspaceId;
};

export const getTodayStatusController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const status = await attendanceService.getTodayStatus(req.user!.id, workspaceId);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
};

export const markAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = markAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const record = await attendanceService.markAttendance(req.user!.id, workspaceId, parsed.data);
    emitWorkspaceEvent(workspaceId, 'attendance_updated', {
      recordId: record.id,
      userId: record.userId,
      action: 'submitted',
      approvalStatus: record.approvalStatus,
    });
    return res.status(201).json({ success: true, message: 'Attendance marked successfully', data: record });
  } catch (error: any) {
    if (error.statusCode) {
      applyCorsHeadersIfAllowed(req, res);
      return res.status(error.statusCode).json({ success: false, message: error.message, errorCode: error.errorCode, details: error.details });
    }
    next(error);
  }
};

export const checkOutAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = checkOutAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const record = await attendanceService.checkOutAttendance(req.user!.id, workspaceId, parsed.data);
    emitWorkspaceEvent(workspaceId, 'attendance_updated', {
      recordId: record.id,
      userId: record.userId,
      action: 'checked_out',
      approvalStatus: record.approvalStatus,
    });
    return res.status(200).json({ success: true, message: 'Checkout completed successfully', data: record });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getHistoryController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const history = await attendanceService.getHistory(req.user!.id, workspaceId, req.query);
    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

export const getAdminOverviewController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await attendanceService.getAdminOverview(workspaceId, parsed.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getStatsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const stats = await attendanceService.getStats(req.user!.id, workspaceId);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const getAdminStatsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const stats = await attendanceService.getAdminStats(workspaceId);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const getSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const settings = await attendanceService.getSettings(workspaceId);
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

export const updateSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const settings = await attendanceService.updateSettings(workspaceId, parsed.data);
    return res.status(200).json({ success: true, message: 'Settings updated successfully', data: settings });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceUserSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const data = await attendanceService.getAttendanceUserSettings(workspaceId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateAttendanceUserSettingController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceUserSettingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await attendanceService.updateAttendanceUserSetting(workspaceId, req.params.userId as string, req.user!.id, parsed.data);
    return res.status(200).json({ success: true, message: 'User attendance timing updated', data });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const unlockUserController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID parameter is required.' });
  }
  try {
    const user = await attendanceService.unlockUserAdmin(userId as string, workspaceId, req.user!.id);
    return res.status(200).json({ success: true, message: 'User account unlocked successfully', data: user });
  } catch (error) {
    next(error);
  }
};

export const getOfficeLocationsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const locations = await attendanceService.getOfficeLocations(workspaceId);
    return res.status(200).json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
};

export const createOfficeLocationController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceOfficeLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const location = await attendanceService.createOfficeLocation(workspaceId, parsed.data);
    return res.status(201).json({ success: true, message: 'Office location created successfully', data: location });
  } catch (error) {
    next(error);
  }
};

export const updateOfficeLocationController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceOfficeLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const location = await attendanceService.updateOfficeLocation(workspaceId, req.params.id as string, parsed.data);
    return res.status(200).json({ success: true, message: 'Office location updated successfully', data: location });
  } catch (error) {
    next(error);
  }
};

export const deleteOfficeLocationController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    await attendanceService.deleteOfficeLocation(workspaceId, req.params.id as string);
    return res.status(200).json({ success: true, message: 'Office location deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getNetworksController = getOfficeLocationsController;
export const createNetworkController = createOfficeLocationController;
export const updateNetworkController = updateOfficeLocationController;
export const deleteNetworkController = deleteOfficeLocationController;

export const updateUserOfficeBranchController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = assignOfficeBranchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const user = await attendanceService.updateUserOfficeBranch(workspaceId, req.params.userId as string, parsed.data.attendanceOfficeLocationId);
    return res.status(200).json({ success: true, message: 'Office branch updated', data: user });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getPendingApprovalsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const list = await attendanceService.getPendingApprovals(workspaceId, req.user!.id);
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    next(error);
  }
};

export const reviewAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const { recordId } = req.params;
  const { action, reason } = req.body;
  if (!action || !['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Valid action (APPROVE/REJECT) is required.' });
  }
  try {
    const record = await attendanceService.reviewAttendance(workspaceId, recordId as string, req.user!.id, action, reason);
    emitWorkspaceEvent(workspaceId, 'attendance_updated', {
      recordId: record.id,
      userId: record.userId,
      action: action.toLowerCase(),
      approvalStatus: record.approvalStatus,
    });
    return res.status(200).json({ success: true, message: `Attendance request ${action.toLowerCase()}d successfully`, data: record });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const approveAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  req.body.action = 'APPROVE';
  return reviewAttendanceController(req, res, next);
};

export const rejectAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  req.body.action = 'REJECT';
  return reviewAttendanceController(req, res, next);
};

export const requestClarificationController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const record = await attendanceService.requestClarification(workspaceId, req.params.recordId as string, req.user!.id, req.body.reason);
    emitWorkspaceEvent(workspaceId, 'attendance_updated', {
      recordId: record.id,
      userId: record.userId,
      action: 'clarification',
      approvalStatus: record.approvalStatus,
    });
    return res.status(200).json({ success: true, message: 'Clarification requested successfully', data: record });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getApprovalHistoryController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const history = await attendanceService.getApprovalHistory(workspaceId);
    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

export const getSchedulesController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const schedules = await attendanceService.getSchedules(workspaceId);
    return res.status(200).json({ success: true, data: schedules });
  } catch (error) {
    next(error);
  }
};

export const getScheduleController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const schedule = await attendanceService.getSchedule(req.params.userId as string, workspaceId);
    return res.status(200).json({ success: true, data: schedule });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateScheduleController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const schedule = await attendanceService.updateSchedule(req.params.userId as string, workspaceId, parsed.data, req.user!.id);
    return res.status(200).json({ success: true, message: 'Attendance schedule updated successfully', data: schedule });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateUserApplyTypeController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const { userId } = req.params;
  const { attendanceApplyType } = req.body;
  if (!attendanceApplyType || !['FROM_OFFICE', 'FROM_ANYWHERE'].includes(attendanceApplyType)) {
    return res.status(400).json({ success: false, message: 'Valid attendanceApplyType is required' });
  }
  try {
    const user = await attendanceService.updateUserApplyType(workspaceId, userId as string, attendanceApplyType);
    return res.status(200).json({ success: true, message: 'Apply type updated', data: user });
  } catch (error) {
    next(error);
  }
};

export const getNotificationsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  try {
    const notifications = await attendanceService.getNotifications(req.user!.id, workspaceId);
    return res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

export const exportController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;
  const parsed = attendanceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const result = await attendanceService.getAdminOverview(workspaceId, { ...parsed.data, limit: 1000 });
    const records: any[] = result.records || [];
    const headers = ['Employee Name','Employee Email','Role','Date','Check-In Time','Check-Out Time','Working Hours','Attendance Type','Approval Status','Work Summary','Rejected Reason'];
    const csvRows = [headers.join(',')];
    for (const record of records as any[]) {
      const rawRow = [
        record.user?.name || '',
        record.user?.email || '',
        record.user?.role?.name || '',
        record.date ? new Date(record.date).toLocaleDateString() : '',
        record.checkInTime ? new Date(record.checkInTime).toLocaleString() : '',
        record.checkOutTime ? new Date(record.checkOutTime).toLocaleString() : '',
        record.workingHours != null ? String(record.workingHours) : '',
        record.attendanceType || '',
        record.approvalStatus || '',
        record.workSummary || '',
        record.rejectedReason || '',
      ];
      const row = sanitizeCsvRow(rawRow).map((value: any) => {
        const strVal = String(value ?? '');
        return /[",\n\r]/.test(strVal) ? `"${strVal.replace(/"/g, '""')}"` : strVal;
      });
      csvRows.push(row.join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_export_${Date.now()}.csv`);
    return res.status(200).send(csvRows.join('\n'));
  } catch (error) {
    next(error);
  }
};

export const getAttendanceCalendarController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const requestingUser = (req as any).user;
  if (!requestingUser) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const userId = (req.query.userId as string) || requestingUser.id;

  try {
    const data = await getAttendanceCalendarData(requestingUser, {
      userId,
      month,
      year,
      officeId: req.query.officeId as string,
      departmentId: req.query.departmentId as string,
      roleId: req.query.roleId as string,
      status: req.query.status as string,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

