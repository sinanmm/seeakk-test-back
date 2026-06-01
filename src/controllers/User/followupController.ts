import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as followupService from '../../services/User/followupService';
import * as mandatoryFollowupService from '../../services/User/mandatoryFollowupContinuation.service';
import { emitWorkspaceEvent } from '../../realtime/socket';
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
  advancedCalendarSummarySchema,
  AdvancedCalendarSummaryInput,
  advancedCalendarDetailsSchema,
  AdvancedCalendarDetailsInput,
  bulkExtendFollowUpSchema,
  BulkExtendFollowUpInput,
} from '../../validations/followupValidation';
import {
  SaveMandatoryFollowUpContinuationInput,
  saveMandatoryFollowUpContinuationSchema,
} from '../../validations/mandatoryFollowupValidation';

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
    const meta = error?.meta as { column?: string; table?: string; modelName?: string } | undefined;
    const detail =
      error?.code === 'P2022'
        ? `Database column out of sync (missing: ${meta?.column ?? 'unknown'}).`
        : `Database table out of sync (missing: ${meta?.table ?? meta?.modelName ?? 'unknown'}).`;
    logger.error(`Follow-up schema mismatch (${error?.code})`, { action, meta: error?.meta, message: error?.message });
    res.status(503).json({
      success: false,
      message: `Follow-up module is not ready. ${detail} Run \`npx prisma migrate deploy\` on the production database for this service's DATABASE_URL, then restart the API.`,
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
  roleId: req.user?.roleId,
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

export const getAdvancedCalendarSummary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<AdvancedCalendarSummaryInput>(advancedCalendarSummarySchema, req.query, res);
  if (!query) return;

  try {
    const data = await followupService.getAdvancedCalendarSummary(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Advanced calendar summary fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getAdvancedCalendarSummary');
  }
};

export const getAdvancedCalendarDetails = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<AdvancedCalendarDetailsInput>(advancedCalendarDetailsSchema, req.query, res);
  if (!query) return;

  try {
    const data = await followupService.getAdvancedCalendarDetails(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      message: 'Advanced calendar details fetched successfully',
      ...data, // contains items and pagination
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getAdvancedCalendarDetails');
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
        extensionReasonId: data.extensionReasonId || null,
        extensionReasonName: data.extensionReasonName || null,
        recentDescription: data.recentDescription || null,
        previousFollowupDate: data.previousFollowupDate,
        newFollowupDate: data.newFollowupDate,
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

export const getMandatoryFollowUpContinuation = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await mandatoryFollowupService.getMandatoryFollowUpSessionState(workspaceId, getActor(req));
    return res.status(200).json({
      success: true,
      message: 'Mandatory follow-up continuation status fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getMandatoryFollowUpContinuation');
  }
};

export const saveMandatoryFollowUpContinuation = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<SaveMandatoryFollowUpContinuationInput>(
    saveMandatoryFollowUpContinuationSchema,
    req.body,
    res,
  );
  if (!input) return;

  try {
    const data = await mandatoryFollowupService.saveMandatoryFollowUpContinuation(
      workspaceId,
      getActor(req),
      input,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );

    emitWorkspaceEvent(workspaceId, 'lead_updated', {
      leadId: data.leadId,
      action: 'mandatory_followup_continuation_saved',
    });

    const session = await mandatoryFollowupService.getMandatoryFollowUpSessionState(workspaceId, getActor(req));

    return res.status(200).json({
      success: true,
      message: 'Next follow-up scheduled successfully',
      data: {
        ...data,
        session,
      },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'saveMandatoryFollowUpContinuation');
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

export const bulkExtendFollowUps = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<BulkExtendFollowUpInput>(bulkExtendFollowUpSchema, req.body, res);
  if (!input) return;

  try {
    const result = await followupService.bulkExtendFollowUps(workspaceId, getActor(req), input);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'bulkExtendFollowUps');
  }
};

export const getTodayUtilization = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const actor = getActor(req);

  try {
    const data = await followupService.getTodayUtilization(workspaceId, actor.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'getTodayUtilization');
  }
};

export const getBulkExtensionReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

  try {
    const data = await followupService.getBulkExtensionReport(workspaceId, { startDate, endDate });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'getBulkExtensionReport');
  }
};

export const getFollowUpCapacityReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { startDate, endDate, userId } = req.query as { startDate?: string; endDate?: string; userId?: string };

  try {
    const data = await followupService.getFollowUpCapacityReport(workspaceId, { startDate, endDate, userId });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'getFollowUpCapacityReport');
  }
};

export const getDailyFollowUpUtilization = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { startDate, endDate, userId } = req.query as { startDate?: string; endDate?: string; userId?: string };

  try {
    const data = await followupService.getDailyFollowUpUtilization(workspaceId, { startDate, endDate, userId });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'getDailyFollowUpUtilization');
  }
};

export const getUserFollowUpLimitReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await followupService.getUserFollowUpLimitReport(workspaceId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'getUserFollowUpLimitReport');
  }
};

export const exportReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const type = req.query.type as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  const userId = req.query.userId as string;

  try {
    let data: any[] = [];
    let headers: string[] = [];
    let filename = 'report.csv';

    if (type === 'bulk-extensions') {
      const moment = (await import('moment-timezone')).default;
      data = await followupService.getBulkExtensionReport(workspaceId, { startDate, endDate });
      headers = ['Date', 'Extended By', 'Target Date', 'Reason', 'Count', 'Auto Distributed'];
      data = data.map((item: any) => ({
        Date: moment(item.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        'Extended By': item.user?.name || item.user?.email || 'Unknown',
        'Target Date': moment(item.targetDate).format('YYYY-MM-DD'),
        Reason: item.extensionReasonName || item.customReason || 'N/A',
        Count: item.followupCount,
        'Auto Distributed': item.autoDistributed ? 'Yes' : 'No',
      }));
      filename = 'bulk_extensions_report.csv';
    } else if (type === 'capacity' || type === 'utilization') {
      data = await followupService.getFollowUpCapacityReport(workspaceId, { startDate, endDate, userId });
      headers = ['Date', 'User Name', 'Follow-up Count', 'Daily Limit', 'Remaining Capacity', 'Utilization %'];
      data = data.map((item: any) => ({
        Date: item.date,
        'User Name': item.userName,
        'Follow-up Count': item.count,
        'Daily Limit': item.limit,
        'Remaining Capacity': item.remaining,
        'Utilization %': `${item.utilizationPercent}%`,
      }));
      filename = `${type}_report.csv`;
    } else if (type === 'user-limits') {
      data = await followupService.getUserFollowUpLimitReport(workspaceId);
      headers = ['User Name', 'Email', 'Role', 'Daily Limit', 'Limit Enabled', 'Avg Daily Count (7d)', 'Avg Utilization %'];
      data = data.map((item: any) => ({
        'User Name': item.userName,
        Email: item.userEmail,
        Role: item.roleName,
        'Daily Limit': item.limit,
        'Limit Enabled': item.limitEnabled ? 'Yes' : 'No',
        'Avg Daily Count (7d)': item.avgDailyCount,
        'Avg Utilization %': `${item.utilizationPercent}%`,
      }));
      filename = 'user_limits_report.csv';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid report type for export.' });
    }

    const csvRows = [headers.join(',')];
    for (const row of data) {
      const values = headers.map((h) => {
        const val = row[h];
        const stringVal = val === null || val === undefined ? '' : String(val);
        if (/[",\n\r]/.test(stringVal)) {
          return `"${stringVal.replace(/"/g, '""')}"`;
        }
        return stringVal;
      });
      csvRows.push(values.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    return res.status(200).send(csvRows.join('\n'));
  } catch (error) {
    handleServiceError(error, res, next, 'exportReport');
  }
};
