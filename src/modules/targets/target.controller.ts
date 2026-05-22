import { NextFunction, Request, Response } from 'express';
import * as targetAnalytics from './targetAnalytics.service';
import * as targetUnlock from './targetUnlock.service';
import { assignTargetCycleSchema, extendGraceSchema, unlockTargetSchema } from './target.validation';

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    return null;
  }
  return workspaceId;
};

export const getTargetDashboard = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  try {
    const data = await targetAnalytics.getTargetDashboardAnalytics(workspaceId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getTargetReport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  try {
    const data = await targetAnalytics.exportTargetPerformanceReport(workspaceId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const listLockedStaff = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  try {
    const data = await targetUnlock.listLockedStaff(workspaceId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const unlockStaff = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  const parsed = unlockTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const user = await targetUnlock.unlockTargetLockedUser(
      workspaceId,
      req.params.userId as string,
      {
        id: req.user!.id,
        roleName: req.user?.role?.name || null,
        permissions: [
          'USERS_UNLOCK',
          'unlock_target_locked_users',
          'extend_target_grace_period',
          'SYSTEM_CONFIG',
        ],
      },
      parsed.data.reason,
    );
    res.json({ success: true, message: 'Account unlocked successfully.', data: { user } });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message, errorCode: error.errorCode });
    }
    next(error);
  }
};

export const extendGrace = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  const parsed = extendGraceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await targetUnlock.extendTargetGracePeriod(
      workspaceId,
      req.params.userId as string,
      { id: req.user!.id, permissions: ['extend_target_grace_period', 'USERS_UNLOCK', 'SYSTEM_CONFIG'] },
      parsed.data.graceUntil,
    );
    res.json({ success: true, message: 'Grace period extended.', data });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const assignUserTargetCycle = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;
  const parsed = assignTargetCycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const { assignTargetCycleToUser, clearUserTargetCycle } = await import('./targetAssignment.service');
    const userId = req.params.userId as string;
    if (!parsed.data.targetCycleId) {
      await clearUserTargetCycle(workspaceId, userId);
      return res.json({ success: true, message: 'Target cycle removed from user.' });
    }
    const assignment = await assignTargetCycleToUser(
      workspaceId,
      userId,
      parsed.data.targetCycleId,
      req.user!.id,
    );
    res.status(201).json({ success: true, message: 'Target cycle assigned.', data: { assignment } });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
