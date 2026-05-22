import { NextFunction, Request, Response } from 'express';
import logger from '../../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../../utils/workspaceContext';
import * as lobReasonsService from './lobReasons.service';
import type {
  CreateLOBReasonInput,
  ListLOBReasonsQueryInput,
  LOBReasonIdParamInput,
  ToggleLOBReasonStatusInput,
  UpdateLOBReasonInput,
} from './lobReasons.validation';
import {
  createLOBReasonSchema,
  listLOBReasonsQuerySchema,
  lobReasonIdParamSchema,
  toggleLOBReasonStatusSchema,
  updateLOBReasonSchema,
} from './lobReasons.validation';

const getWorkspaceId = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(403).json({
      success: false,
      message: 'Authentication required.',
    });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);

  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Workspace context is required. Please complete workspace setup or refresh your session.',
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

  logger.error(`LOB reasons error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createLOBReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLOBReasonInput>(createLOBReasonSchema, req.body, res);
  if (!input) return;

  try {
    const data = await lobReasonsService.createLOBReason(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLOBReason');
  }
};

export const listLOBReasons = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const query = validate<ListLOBReasonsQueryInput>(listLOBReasonsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await lobReasonsService.listLOBReasons(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listLOBReasons');
  }
};

export const listActiveLOBReasons = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const data = await lobReasonsService.listActiveLOBReasons(workspaceId);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listActiveLOBReasons');
  }
};

export const updateLOBReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<LOBReasonIdParamInput>(lobReasonIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateLOBReasonInput>(updateLOBReasonSchema, req.body, res);
  if (!input) return;

  try {
    const data = await lobReasonsService.updateLOBReason(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'LOB reason deactivated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLOBReason');
  }
};

export const toggleLOBReasonStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<LOBReasonIdParamInput>(lobReasonIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ToggleLOBReasonStatusInput>(toggleLOBReasonStatusSchema, req.body ?? {}, res);
  if (!input) return;

  try {
    const data = await lobReasonsService.toggleLOBReasonStatus(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleLOBReasonStatus');
  }
};

export const deleteLOBReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<LOBReasonIdParamInput>(lobReasonIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const data = await lobReasonsService.deleteLOBReason(workspaceId, getActor(req), params.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLOBReason');
  }
};
