import { NextFunction, Request, Response } from 'express';
import * as service from './substage.service';
import { createSubstageSchema, updateSubstageSchema } from './substage.validation';

const getWorkspaceId = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked to your account' });
    return null;
  }
  return workspaceId;
};

const validate = <T>(schema: any, data: unknown, res: Response): T | null => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const firstMsg = (Object.values(fieldErrors).flat()[0] as string) || 'Validation failed';
    res.status(422).json({ success: false, message: firstMsg, errors: fieldErrors });
    return null;
  }
  return result.data as T;
};

export const listSubstages = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const leadStageId = typeof req.query.leadStageId === 'string' ? req.query.leadStageId : undefined;
    const data = await service.listSubstages(workspaceId, leadStageId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getSubstagesGrouped = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const data = await service.getSubstagesGroupedByStage(workspaceId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createSubstage = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(createSubstageSchema, req.body, res);
  if (!input) return;

  try {
    const data = await service.createSubstage(workspaceId, input, req.user?.id);
    return res.status(201).json({ success: true, data, message: 'Substage created successfully' });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateSubstage = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(updateSubstageSchema, req.body, res);
  if (!input) return;

  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await service.updateSubstage(workspaceId, id, input);
    return res.status(200).json({ success: true, data, message: 'Substage updated successfully' });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const toggleSubstageStatus = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await service.toggleSubstageStatus(workspaceId, id);
    return res.status(200).json({ success: true, data, message: 'Substage status updated' });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const deleteSubstage = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await service.deleteSubstage(workspaceId, id);
    return res.status(200).json({ success: true, message: 'Substage deleted successfully' });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
