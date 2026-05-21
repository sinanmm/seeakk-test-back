import { Request, Response, NextFunction } from 'express';
import * as attendanceService from './attendance.service';
import {
  markAttendanceSchema,
  updateSettingsSchema,
  attendanceQuerySchema,
} from './attendance.validation';

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }
  return workspaceId;
};

export const getTodayStatusController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
      });
    }
    next(error);
  }
};

export const getHistoryController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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
  const workspaceId = requireWorkspace(req, res);
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

export const exportController = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
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
    
    // For CSV formatting
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance-export-${Date.now()}.csv`);
    
    let csv = 'User Name,Email,Date,Check-In Time,Attendance Type,Status,Warnings,Holiday,Locked\n';
    for (const r of data.records) {
      const checkInStr = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : '-';
      csv += `"${r.user?.name || ''}","${r.user?.email || ''}","${r.date.toISOString().split('T')[0]}","${checkInStr}","${r.attendanceType}","${r.status}",${r.warningCount},${r.isHoliday},${r.isLocked}\n`;
    }
    
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};
