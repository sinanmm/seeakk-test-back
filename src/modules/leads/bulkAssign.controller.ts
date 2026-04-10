import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as bulkAssignService from './bulkAssign.service';
import type { BulkAssignInput, BulkAssignPreviewInput } from './bulkAssign.validation';
import { bulkAssignPreviewSchema, bulkAssignSchema } from './bulkAssign.validation';

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

  logger.error(`Bulk assign error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const previewBulkAssign = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<BulkAssignPreviewInput>(bulkAssignPreviewSchema, req.body, res);
  if (!input) return;

  try {
    const result = await bulkAssignService.previewBulkAssign(workspaceId, getActor(req), input);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'previewBulkAssign');
  }
};

export const bulkAssign = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<BulkAssignInput>(bulkAssignSchema, req.body, res);
  if (!input) return;

  try {
    const result = await bulkAssignService.bulkAssignLeads(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'bulkAssign');
  }
};
