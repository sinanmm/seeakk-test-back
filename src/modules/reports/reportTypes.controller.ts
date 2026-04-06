import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as reportTypesService from './reportTypes.service';
import type {
  CreateReportTypeInput,
  ListReportTypesQueryInput,
  ReportTypeIdParamInput,
  ToggleReportTypeStatusInput,
  UpdateReportTypeInput,
} from './reportTypes.validation';
import {
  createReportTypeSchema,
  listReportTypesQuerySchema,
  reportTypeIdParamSchema,
  toggleReportTypeStatusSchema,
  updateReportTypeSchema,
} from './reportTypes.validation';

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

  logger.error(`Report types error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createReportType = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateReportTypeInput>(createReportTypeSchema, req.body, res);
  if (!input) return;

  try {
    const data = await reportTypesService.createReportType(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createReportType');
  }
};

export const listReportTypes = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListReportTypesQueryInput>(listReportTypesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await reportTypesService.listReportTypes(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listReportTypes');
  }
};

export const updateReportType = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportTypeIdParamInput>(reportTypeIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateReportTypeInput>(updateReportTypeSchema, req.body, res);
  if (!input) return;

  try {
    const data = await reportTypesService.updateReportType(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateReportType');
  }
};

export const toggleReportTypeStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportTypeIdParamInput>(reportTypeIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ToggleReportTypeStatusInput>(toggleReportTypeStatusSchema, req.body ?? {}, res);
  if (!input) return;

  try {
    const data = await reportTypesService.toggleReportTypeStatus(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleReportTypeStatus');
  }
};

export const deleteReportType = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ReportTypeIdParamInput>(reportTypeIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const data = await reportTypesService.deleteReportType(workspaceId, getActor(req), params.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteReportType');
  }
};
