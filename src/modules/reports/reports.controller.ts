import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as reportsService from './reports.service';
import type { GenerateReportInput, ListReportLogsQueryInput } from './reports.validation';
import { generateReportSchema, listReportLogsQuerySchema } from './reports.validation';

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
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Reports error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const generateReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<GenerateReportInput>(generateReportSchema, req.body, res);
  if (!input) return;

  try {
    const result = await reportsService.generateReport(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'generateReport');
  }
};

export const listReportLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListReportLogsQueryInput>(listReportLogsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await reportsService.listReportLogs(workspaceId, query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listReportLogs');
  }
};
