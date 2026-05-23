import { Request, Response, NextFunction } from 'express';
import * as holidayService from './holidays.service';
import * as holidayAiService from './holidays.ai';

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    return null;
  }
  return workspaceId;
};

export const getAllHolidays = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const holidays = await holidayService.getWorkspaceHolidays(workspaceId);
    res.status(200).json({ success: true, data: { holidays } });
  } catch (error) {
    next(error);
  }
}

export const createHoliday = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const holiday = await holidayService.createHoliday({ ...req.body, workspaceId, createdById: (req as any).user.id });
    res.status(201).json({ success: true, data: { holiday } });
  } catch (error) {
    next(error);
  }
};

export const updateHoliday = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const holiday = await holidayService.updateHoliday(req.params.id as string, { ...req.body, updatedById: (req as any).user.id });
    res.status(200).json({ success: true, data: { holiday } });
  } catch (error) {
    next(error);
  }
};

export const deleteHoliday = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    await holidayService.deleteHoliday(req.params.id as string);
    res.status(200).json({ success: true, message: 'Holiday deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getCalendarView = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const month = req.query.month as string;
    const view = await holidayService.getWorkspaceCalendarView(workspaceId, month);
    res.status(200).json({ success: true, data: view });
  } catch (error) {
    next(error);
  }
};

export const getWeeklyOffSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const settings = await holidayService.getWeeklyOffSettings(workspaceId);
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

export const updateWeeklyOffSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const settings = await holidayService.saveWeeklyOffSettings(workspaceId, req.body);
    res.status(200).json({ success: true, message: 'Weekly-off settings saved.', data: settings });
  } catch (error) {
    next(error);
  }
};

export const suggestHolidays = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const { country } = req.body;
    const suggestions = await holidayAiService.suggestHolidays(country);
    res.status(200).json({ success: true, data: { suggestions } });
  } catch (error) {
    next(error);
  }
};
