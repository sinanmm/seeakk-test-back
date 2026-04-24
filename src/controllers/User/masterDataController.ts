import { Request, Response, NextFunction } from 'express';
import * as masterDataService from '../../services/User/masterDataService';

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

export const getRoles = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const roles = await masterDataService.getRoles(workspaceId, { includeInactive });
    res.status(200).json({ success: true, data: { roles } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const getDepartments = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const departments = await masterDataService.getDepartments(workspaceId);
    res.status(200).json({ success: true, data: { departments } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const getSupervisors = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const supervisors = await masterDataService.getSupervisors(workspaceId);
    res.status(200).json({ success: true, data: { supervisors } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};
