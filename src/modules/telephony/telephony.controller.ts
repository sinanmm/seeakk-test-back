import { Request, Response, NextFunction } from 'express';
import * as telephonyService from './telephony.service';

const getWorkspaceId = (req: Request): string => {
  const workspaceId = (req as any).workspaceId || (req as any).user?.workspaceId;
  if (!workspaceId) {
    const error: any = new Error('Workspace context is required.');
    error.statusCode = 403;
    throw error;
  }
  return workspaceId;
};

export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await telephonyService.getTelephonySettings(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await telephonyService.updateTelephonySettings(workspaceId, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getProviders = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await telephonyService.getProviderConfigs(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const saveProviderConfig = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const providerKey = String(req.params.providerKey || '');
    const data = await telephonyService.saveProviderConfig(workspaceId, providerKey, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const testConnection = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const providerKey = String(req.params.providerKey || '');
    const data = await telephonyService.testProviderConnection(workspaceId, providerKey);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getUserMappings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const providerKey = String(req.query.providerKey || 'KNOWLARITY');
    const data = await telephonyService.getTelephonyUserMappings(workspaceId, providerKey);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const saveUserMapping = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const providerKey = String(req.body.providerKey || 'KNOWLARITY');
    const userId = String(req.body.userId || '');
    const data = await telephonyService.saveTelephonyUserMapping(workspaceId, providerKey, userId, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const handleWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const providerKey = String(req.params.providerKey || '');
    const result = await telephonyService.processWebhook(providerKey, req.body, req.headers, req.query);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(200).json({ success: false, message: error?.message || 'Webhook processing error' });
  }
};

export const getRecordingPlayback = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || '';
    const sessionId = String(req.params.sessionId || '');
    const data = await telephonyService.getRecordingStreamOrUrl(workspaceId, userId, sessionId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
