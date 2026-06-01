import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';
import * as service from './followupSettings.service';
import {
  updateFollowUpSettingsSchema,
  grantTemporaryAccessSchema,
  UpdateFollowUpSettingsInput,
  GrantTemporaryAccessInput,
} from './followupSettings.validation';

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

const handleControllerError = (error: any, res: Response, next: NextFunction, action: string) => {
  logger.error(`Error in FollowUpSettingsController.${action}`, { error: error.message || error, stack: error.stack });
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  return next(error);
};

export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = requireWorkspace(req, res);
    if (!workspaceId) return;

    const data = await service.getSettings(workspaceId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleControllerError(error, res, next, 'getSettings');
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = requireWorkspace(req, res);
    if (!workspaceId) return;

    const result = updateFollowUpSettingsSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
    }

    const data = await service.updateSettings(workspaceId, req.user?.id || '', result.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleControllerError(error, res, next, 'updateSettings');
  }
};

export const listTemporaryAccess = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = requireWorkspace(req, res);
    if (!workspaceId) return;

    const data = await service.listTemporaryAccess(workspaceId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleControllerError(error, res, next, 'listTemporaryAccess');
  }
};

export const grantTemporaryAccess = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = requireWorkspace(req, res);
    if (!workspaceId) return;

    const result = grantTemporaryAccessSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
    }

    const data = await service.grantTemporaryAccess(workspaceId, req.user?.id || '', result.data);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleControllerError(error, res, next, 'grantTemporaryAccess');
  }
};

export const revokeTemporaryAccess = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = requireWorkspace(req, res);
    if (!workspaceId) return;

    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Temporary access ID is required.' });
    }

    const data = await service.revokeTemporaryAccess(workspaceId, req.user?.id || '', id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleControllerError(error, res, next, 'revokeTemporaryAccess');
  }
};
