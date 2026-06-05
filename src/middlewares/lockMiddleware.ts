import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { normalizeRequestApiPath } from '../utils/requestApiPath';

const isAccountLockExemptPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const path = normalizeRequestApiPath(req);
  const exemptPrefixes = [
    '/api/leads/meta/assignees',
    '/api/followups/mandatory-continuation',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/attendance/today',
    '/api/attendance/check-in',
    '/api/attendance/settings',
    '/api/attendance/networks',
  ];

  return exemptPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
};

import prisma from '../config/prisma';
import { canLockUserForTargetFailure } from '../modules/targets/targetLockEvaluation.service';

export const checkUserLock = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  if (isAccountLockExemptPath(req)) return next();

  if (req.user && req.user.isLocked) {
    try {
      const db = prisma as any;
      const assignment = await db.targetAssignment.findFirst({
        where: { userId: req.user.id, workspaceId: req.user.workspaceId, isActive: true },
        include: { targetCycle: true }
      });

      const activeTargetCycle = assignment?.targetCycle;
      const isCycleActive = activeTargetCycle?.status === 'ACTIVE';

      let isEligibleForLock = false;
      let manualOverride = false;
      let lockSource = (req.user as any).targetLockedAt ? 'TARGET_EVALUATION' : 'OTHER_MODULE';
      let lockReason = (req.user as any).targetLockReason || (req.user as any).lockReason || 'TARGET_LOCKED';

      if (assignment && isCycleActive) {
        const latestPerf = await db.targetPerformance.findFirst({
          where: { assignmentId: assignment.id },
          orderBy: { updatedAt: 'desc' },
          include: { period: true }
        });

        if (latestPerf?.period) {
          isEligibleForLock = await canLockUserForTargetFailure(
            assignment,
            req.user.id,
            latestPerf.period,
            activeTargetCycle.createdBy
          );
          if (!isEligibleForLock && assignment.isLockExempt) {
            manualOverride = true;
          }
        }
      }

      // User requested rule: If any of these conditions fail, DO NOT return 423.
      // 1. Active target assignment exists
      // 2. Target cycle exists
      // 3. Target cycle is active
      // 4. User is currently eligible for locking
      // (We skip this check if the lock is explicitly an attendance lock without target involvement, 
      // but to be strictly compliant with the prompt, we enforce this universally for target locked users)
      
      const isTargetLock = Boolean((req.user as any).targetLockedAt || lockReason.includes('target'));

      if (isTargetLock && (!assignment || !activeTargetCycle || !isCycleActive || !isEligibleForLock)) {
        logger.info('Auto-correcting incorrect user target lock state', { 
          userId: req.user.id,
          hasAssignment: !!assignment,
          hasCycle: !!activeTargetCycle,
          isCycleActive,
          isEligibleForLock
        });

        await db.user.update({
          where: { id: req.user.id },
          data: { isLocked: false, targetLockedAt: null, targetLockReason: null }
        });

        req.user.isLocked = false;
        return next();
      }

      logger.warn('Access denied. User account is locked.', { 
        userId: req.user.id,
        isLocked: true,
        lockReason,
        activeTargetAssignment: assignment?.id || null,
        activeTargetCycle: activeTargetCycle?.id || null,
        manualOverride,
        lockSource
      });
      return res.status(423).json({
        success: false,
        errorCode: 'ACCOUNT_LOCKED',
        message: 'Your account is temporarily locked due to incomplete targets.',
        debug: {
          userId: req.user.id,
          isLocked: true,
          lockReason,
          activeTargetAssignment: assignment?.id || null,
          activeTargetCycle: activeTargetCycle?.id || null,
          manualOverride,
          lockSource
        }
      });
    } catch (err) {
      logger.error('Error validating user lock state', { error: err });
    }
  }
  next();
};
