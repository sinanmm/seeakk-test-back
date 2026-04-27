import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as reportsService from './reports.service';
import { emitWorkspaceEvent } from '../../realtime/socket';
import type {
  CreateReportInput,
  GenerateReportInput,
  ListReportLogsQueryInput,
  ListReportsQueryInput,
  ReportIdParamInput,
  UpdateReportInput,
} from './reports.validation';
import {
  createReportSchema,
  generateReportSchema,
  listReportLogsQuerySchema,
  listReportsQuerySchema,
  reportIdParamSchema,
  updateReportSchema,
} from './reports.validation';

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

const getContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

export const createReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateReportInput>(createReportSchema, req.body, res);
  if (!input) return;

  try {
    const result = await reportsService.createReport(workspaceId, getActor(req), input, getContext(req));
    emitWorkspaceEvent(workspaceId, 'report_updated', { reportId: (result as any).id, action: 'created' });
    return res.status(201).json({
      success: true,
      message: 'Report created successfully.',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createReport');
  }
};

export const listReports = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListReportsQueryInput>(listReportsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await reportsService.listReports(workspaceId, query);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listReports');
  }
};

export const updateReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportIdParamInput>(reportIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateReportInput>(updateReportSchema, req.body, res);
  if (!input) return;

  try {
    const result = await reportsService.updateReport(workspaceId, getActor(req), params.id, input, getContext(req));
    emitWorkspaceEvent(workspaceId, 'report_updated', { reportId: params.id, action: 'updated' });
    return res.status(200).json({
      success: true,
      message: 'Report updated successfully.',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateReport');
  }
};

export const generateReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<GenerateReportInput>(generateReportSchema, req.body, res);
  if (!input) return;

  try {
    const result = await reportsService.generateReport(workspaceId, getActor(req), input, getContext(req));

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'generateReport');
  }
};

export const generateSavedReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportIdParamInput>(reportIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const result = await reportsService.generateSavedReport(workspaceId, getActor(req), params.id, getContext(req));
    emitWorkspaceEvent(workspaceId, 'report_updated', { reportId: params.id, action: 'generated' });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'generateSavedReport');
  }
};

export const downloadReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportIdParamInput>(reportIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const result = await reportsService.downloadReport(workspaceId, getActor(req), params.id, getContext(req));
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'downloadReport');
  }
};

export const deleteReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportIdParamInput>(reportIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const result = await reportsService.deleteReport(workspaceId, getActor(req), params.id, getContext(req));
    emitWorkspaceEvent(workspaceId, 'report_updated', { reportId: params.id, action: 'deleted' });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteReport');
  }
};

export const listReportLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListReportLogsQueryInput>(listReportLogsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await reportsService.listReportLogs(workspaceId, query);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listReportLogs');
  }
};
