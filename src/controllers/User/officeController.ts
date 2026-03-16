import { Request, Response, NextFunction } from 'express';
import * as officeService from '../../services/User/officeService';

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

export const listOffices = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const offices = await officeService.listOffices(workspaceId);
    res.status(200).json({ success: true, data: { offices } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const createOffice = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const office = await officeService.createOffice({ ...req.body, workspaceId });
    res.status(201).json({ success: true, data: { office } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};
