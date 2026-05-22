import { Request, Response, NextFunction } from 'express';
import * as targetService from '../../services/User/targetService';
import * as accountLockService from '../../services/User/accountLockService';
import { createTargetSchema, updateTargetSchema } from '../../validations/targetValidation';
import logger from '../../utils/logger';

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

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/users/:id/targets
 */
export const createTarget = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const result = createTargetSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({ success: false, errors: result.error.flatten().fieldErrors });
  }

  try {
    const userId = req.params['id'] as string;
    const target = await targetService.upsertTarget(userId, workspaceId, result.data);
    res.status(201).json({ success: true, message: 'Target assigned successfully.', data: { target } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

/**
 * GET /api/admin/users/:id/targets
 */
export const getUserTargets = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const userId = req.params['id'] as string;
    const targets = await targetService.getUserTargets(userId, workspaceId);
    res.status(200).json({ success: true, data: { targets } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

/**
 * PUT /api/admin/users/:userId/targets/:targetId
 */
export const updateTarget = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const result = updateTargetSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({ success: false, errors: result.error.flatten().fieldErrors });
  }

  try {
    const userId = req.params['userId'] as string;
    const targetId = req.params['targetId'] as string;
    const target = await targetService.updateTarget(targetId, userId, workspaceId, result.data);
    res.status(200).json({ success: true, message: 'Target updated successfully.', data: { target } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

/**
 * POST /api/admin/users/:id/unlock
 */
export const unlockUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const userId = req.params['id'] as string;
    const { unlockTargetLockedUser } = await import('../../modules/targets/targetUnlock.service');
    const user = await unlockTargetLockedUser(
      workspaceId,
      userId,
      {
        id: req.user!.id,
        roleName: req.user?.role?.name || null,
        permissions: ['USERS_UNLOCK', 'unlock_target_locked_users', 'SYSTEM_CONFIG'],
      },
      (req.body as { reason?: string })?.reason,
    );
    res.status(200).json({ success: true, message: 'User account unlocked successfully.', data: { user } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

/**
 * PUT /api/admin/users/:id/target-cycle
 */
export const assignTargetCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { assignTargetCycleSchema } = await import('../../modules/targets/target.validation');
  const result = assignTargetCycleSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({ success: false, errors: result.error.flatten().fieldErrors });
  }

  try {
    const userId = req.params['id'] as string;
    const { assignTargetCycleToUser, clearUserTargetCycle } = await import(
      '../../modules/targets/targetAssignment.service'
    );
    if (!result.data.targetCycleId) {
      await clearUserTargetCycle(workspaceId, userId);
      return res.status(200).json({ success: true, message: 'Target cycle removed.' });
    }
    const assignment = await assignTargetCycleToUser(
      workspaceId,
      userId,
      result.data.targetCycleId,
      req.user!.id,
    );
    res.status(200).json({ success: true, message: 'Target cycle assigned.', data: { assignment } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

/**
 * GET /api/admin/users/meta/target-types
 */
export const getTargetTypes = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const types = await targetService.getTargetTypes();
    res.status(200).json({ success: true, data: { types } });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};
