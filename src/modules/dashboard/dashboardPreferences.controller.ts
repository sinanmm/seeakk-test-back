import type { Request, Response, NextFunction } from 'express';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import {
  getWorkspaceDashboardPreferences,
  updateWorkspaceDashboardPreferences,
  resetWorkspaceDashboardPreferences,
} from './dashboardPreferences.service';

const getActorFromReq = (req: Request) => {
  const user = req.user as any;
  return {
    id: user?.id,
    permissions: user?.permissions || [],
    role: user?.role,
    roleId: user?.roleId,
  };
};

const resolveWorkspace = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Not authorized' });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Workspace reference is missing.' });
    return null;
  }

  return workspaceId;
};

export const getDashboardPreferences = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const workspaceId = await resolveWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await getWorkspaceDashboardPreferences(workspaceId, getActorFromReq(req));
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateDashboardPreferences = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const workspaceId = await resolveWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await updateWorkspaceDashboardPreferences(workspaceId, getActorFromReq(req), req.body);
    return res.status(200).json({
      success: true,
      message: 'Dashboard updated successfully.',
      data,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export const resetDashboardPreferences = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const workspaceId = await resolveWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await resetWorkspaceDashboardPreferences(workspaceId, getActorFromReq(req));
    return res.status(200).json({
      success: true,
      message: 'Dashboard layout reset to default.',
      data,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};
