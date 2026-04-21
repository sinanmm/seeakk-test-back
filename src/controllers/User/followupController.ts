import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as followupService from '../../services/User/followupService';
import {
  CalendarQueryInput,
  calendarQuerySchema,
  CompleteFollowUpInput,
  completeFollowUpSchema,
  CreateFollowUpInput,
  createFollowUpSchema,
  FollowUpIdParamInput,
  followUpIdParamSchema,
  HistoryQueryInput,
  historyQuerySchema,
  ReminderAlertsQueryInput,
  reminderAlertsQuerySchema,
  SnoozeFollowUpInput,
  snoozeFollowUpSchema,
  TodayFollowUpsQueryInput,
  todayFollowUpsQuerySchema,
} from '../../validations/followupValidation';

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

function validate<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  return result.data as T;
}

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.code === 'P2021' || error?.code === 'P2022') {
    res.status(503).json({
      success: false,
      message: 'Follow-up module is not ready. Required database schema is missing. Run Prisma migration/db push.',
    });
    return;
  }

  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Follow-up error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  role: req.user?.role,
});

export const createFollowUp = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateFollowUpInput>(createFollowUpSchema, req.body, res);
  if (!input) return;

  try {
    const data = await followupService.createFollowUp(workspaceId, getActor(req), input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'FOLLOWUP_CREATED',
      entityType: 'FollowUp',
      entityId: data.id,
      details: {
        leadId: data.leadId,
        type: data.type,
        scheduledAt: data.scheduledAt,
        assignedUserId: data.userId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Follow-up created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createFollowUp');
  }
};

export const getCalendarData = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<CalendarQueryInput>(calendarQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await followupService.getCalendarData(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Follow-up calendar fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getCalendarData');
  }
};

export const getTodayFollowUps = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<TodayFollowUpsQueryInput>(todayFollowUpsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await followupService.getTodayFollowUps(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Today follow-ups fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getTodayFollowUps');
  }
};

export const getReminderAlerts = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ReminderAlertsQueryInput>(reminderAlertsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await followupService.getReminderAlerts(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Follow-up alerts fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getReminderAlerts');
  }
};

export const completeFollowUp = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<FollowUpIdParamInput>(followUpIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<CompleteFollowUpInput>(completeFollowUpSchema, req.body, res);
  if (!input) return;

  try {
    const data = await followupService.completeFollowUp(workspaceId, getActor(req), params.id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'FOLLOWUP_COMPLETED',
      entityType: 'FollowUp',
      entityId: data.id,
      details: {
        leadId: data.leadId,
        completedAt: data.completedAt,
        imageCount: data.images.length,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Follow-up completed successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'completeFollowUp');
  }
};

export const snoozeFollowUp = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<FollowUpIdParamInput>(followUpIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<SnoozeFollowUpInput>(snoozeFollowUpSchema, req.body, res);
  if (!input) return;

  try {
    const data = await followupService.snoozeFollowUp(workspaceId, getActor(req), params.id, input);
    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'FOLLOWUP_SNOOZED',
      entityType: 'FollowUp',
      entityId: data.id,
      details: {
        leadId: data.leadId,
        scheduledAt: data.scheduledAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Follow-up snoozed successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'snoozeFollowUp');
  }
};

export const getHistory = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<HistoryQueryInput>(historyQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await followupService.getHistory(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Follow-up history fetched successfully',
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getHistory');
  }
};
