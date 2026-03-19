import { Request, Response, NextFunction } from 'express';
import * as locationService from '../../services/User/locationService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    return null;
  }
  return workspaceId;
};

const handleServiceError = (error: any, res: Response, next: NextFunction) => {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
};

export const getLocationTree = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const tree = await locationService.getLocationTree(workspaceId);
    res.status(200).json({ success: true, data: { tree } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const getAllLocations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const locations = await locationService.getAllLocations(workspaceId);
    res.status(200).json({ success: true, data: { locations } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const createLocation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const location = await locationService.createLocation({ ...req.body, workspaceId });
    res.status(201).json({ success: true, data: { location } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const getMyVisibleLocations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  
  const userId = (req as any).user.id;

  try {
    const locations = await locationService.getUserVisibleLocations(userId, workspaceId);
    res.status(200).json({ success: true, data: { locations } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};
