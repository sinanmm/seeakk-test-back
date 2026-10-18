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

export const getProviderAgents = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const providerKey = String(req.params.providerKey || req.query.providerKey || 'KNOWLARITY');
    const data = await telephonyService.getProviderAgents(workspaceId, providerKey);
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
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getRecordingStream = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || '';
    const sessionId = String(req.params.sessionId || '');
    const rangeHeader = req.headers.range;

    const { stream, contentType, contentLength, contentRange, acceptRanges, statusCode } =
      await telephonyService.streamRecording(workspaceId, userId, sessionId, rangeHeader);

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength !== undefined && contentLength !== null) {
      res.setHeader('Content-Length', contentLength);
    }
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    res.setHeader('Cache-Control', 'private, no-cache');

    if (statusCode && statusCode === 206) {
      res.status(206);
    }

    (stream as any).pipe(res);
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error?.$metadata?.httpStatusCode === 416 || error?.name === 'RangeNotSatisfiable') {
      return res.status(416).setHeader('Content-Range', 'bytes */*').end();
    }
    next(error);
  }
};

export const getRecordingDiagnostic = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || '';
    const sessionId = String(req.params.sessionId || '');
    const diagnostic = await telephonyService.getRecordingDiagnostic(workspaceId, userId, sessionId);
    return res.json({ success: true, data: diagnostic });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
