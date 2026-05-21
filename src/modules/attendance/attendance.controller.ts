import { Request, Response, NextFunction } from 'express';
import * as attendanceService from './attendance.service';
import { emitWorkspaceEvent } from '../../realtime/socket';
import type { AttendanceRequest } from './attendance.middleware';
import {
  markAttendanceSchema,
  updateSettingsSchema,
  attendanceQuerySchema,
  attendanceNetworkSchema,
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
    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

export const markAttendanceController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const parsed = markAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const record = await attendanceService.markAttendance(req.user!.id, workspaceId, parsed.data);

    emitWorkspaceEvent(workspaceId, 'attendance_updated', {
      recordId: record.id,
      userId: record.userId,
      action: 'submitted',
      approvalStatus: record.approvalStatus,
    });

    return res.status(201).json({
      success: true,
      message: 'Attendance marked successfully',
      data: record,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        errorCode: error.errorCode,
        details: error.details,
      });
    }
    next(error);
  }
};

export const getHistoryController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    const history = await attendanceService.getHistory(req.user!.id, workspaceId, req.query);
    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminOverviewController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const parsed = attendanceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const data = await attendanceService.getAdminOverview(workspaceId, parsed.data);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getStatsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    const stats = await attendanceService.getStats(req.user!.id, workspaceId);
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminStatsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    const stats = await attendanceService.getAdminStats(workspaceId);
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const getSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    const settings = await attendanceService.getSettings(workspaceId);
    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const settings = await attendanceService.updateSettings(workspaceId, parsed.data);
    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const unlockUserController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID parameter is required.',
    });
  }

  try {
    const user = await attendanceService.unlockUserAdmin(userId as string, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: 'User account unlocked successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const getNetworksController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    const networks = await attendanceService.getNetworks(workspaceId);
    return res.status(200).json({
      success: true,
      data: networks,
    });
  } catch (error) {
    next(error);
  }
};

export const createNetworkController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const parsed = attendanceNetworkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const network = await attendanceService.createNetwork(workspaceId, parsed.data);
    return res.status(201).json({
      success: true,
      message: 'Network created successfully',
      data: network,
    });
  } catch (error) {
    next(error);
  }
};

export const updateNetworkController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  const parsed = attendanceNetworkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const network = await attendanceService.updateNetwork(workspaceId, req.params.id as string, parsed.data);
    return res.status(200).json({
      success: true,
      message: 'Network updated successfully',
      data: network,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteNetworkController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getAttendanceWorkspaceId(req as AttendanceRequest, res);
  if (!workspaceId) return;

  try {
    await attendanceService.deleteNetwork(workspaceId, req.params.id as string);
    return res.status(200).json({
      success: true,
      message: 'Network deleted successfully',
    });
  } catch (error) {
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
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const data = await attendanceService.getAdminOverview(workspaceId, { ...parsed.data, limit: 1000 });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
