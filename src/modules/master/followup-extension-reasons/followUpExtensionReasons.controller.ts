import { NextFunction, Request, Response } from 'express';
import logger from '../../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../../utils/workspaceContext';
import * as service from './followUpExtensionReasons.service';
import type {
  CreateExtensionReasonInput,
  ListExtensionReasonsQueryInput,
  ExtensionReasonIdParamInput,
  ToggleExtensionReasonStatusInput,
  UpdateExtensionReasonInput,
} from './followUpExtensionReasons.validation';
import {
  createExtensionReasonSchema,
  listExtensionReasonsQuerySchema,
  extensionReasonIdParamSchema,
  toggleExtensionReasonStatusSchema,
  updateExtensionReasonSchema,
} from './followUpExtensionReasons.validation';

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

  logger.error(`Followup extension reasons error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createExtensionReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<CreateExtensionReasonInput>(createExtensionReasonSchema, req.body, res);
  if (!input) return;

  try {
    const data = await service.createExtensionReason(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createExtensionReason');
  }
};

export const listExtensionReasons = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const query = validate<ListExtensionReasonsQueryInput>(listExtensionReasonsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await service.listExtensionReasons(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listExtensionReasons');
  }
};

export const listActiveExtensionReasons = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const data = await service.listActiveExtensionReasons(workspaceId);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listActiveExtensionReasons');
  }
};

export const updateExtensionReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<ExtensionReasonIdParamInput>(extensionReasonIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateExtensionReasonInput>(updateExtensionReasonSchema, req.body, res);
  if (!input) return;

  try {
    const data = await service.updateExtensionReason(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateExtensionReason');
  }
};

export const toggleExtensionReasonStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<ExtensionReasonIdParamInput>(extensionReasonIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ToggleExtensionReasonStatusInput>(toggleExtensionReasonStatusSchema, req.body ?? {}, res);
  if (!input) return;

  try {
    const data = await service.toggleExtensionReasonStatus(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleExtensionReasonStatus');
  }
};

export const deleteExtensionReason = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await getWorkspaceId(req, res);
  if (!workspaceId) return;

  const params = validate<ExtensionReasonIdParamInput>(extensionReasonIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const data = await service.deleteExtensionReason(workspaceId, getActor(req), params.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteExtensionReason');
  }
};
