import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as dashboardService from './dashboard.service';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import {
  dashboardSummaryQuerySchema,
  type DashboardSummaryQueryInput,
  revenueAnalyticsQuerySchema,
  type RevenueAnalyticsQueryInput,
} from './dashboard.validation';

const requireWorkspace = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Not authorized' });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }

  return workspaceId;
};

const validate = <T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null => {
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
};

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Dashboard error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const getDashboardSummary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<DashboardSummaryQueryInput>(dashboardSummaryQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await dashboardService.getDashboardSummary(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    logger.error('Dashboard Summary Error:', {
      message: error.message,
      stack: error.stack,
      workspaceId,
      userId: req.user?.id
    });
    handleServiceError(error, res, next, 'getDashboardSummary');
  }
 };

export const getRevenueAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<RevenueAnalyticsQueryInput>(revenueAnalyticsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await dashboardService.getRevenueAnalytics(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    logger.error('Revenue Analytics Error:', {
      message: error.message,
      stack: error.stack,
      workspaceId,
      userId: req.user?.id,
    });
    handleServiceError(error, res, next, 'getRevenueAnalytics');
  }
};
