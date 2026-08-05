import { NextFunction, Request, Response } from 'express';
import * as service from './callTracking.service';
import { initiateCallSchema, saveCallOutcomeSchema } from './callTracking.validation';

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

export const initiateCall = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(initiateCallSchema, req.body, res);
  if (!input) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const result = await service.initiateCallSession(workspaceId, leadId, req.user!.id, input);
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getActiveCallSession = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const session = await service.getActiveCallSession(workspaceId, leadId, req.user!.id);
    return res.status(200).json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

export const saveCallOutcome = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(saveCallOutcomeSchema, req.body, res);
  if (!input) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const result = await service.saveCallOutcome(workspaceId, leadId, req.user!.id, input);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
