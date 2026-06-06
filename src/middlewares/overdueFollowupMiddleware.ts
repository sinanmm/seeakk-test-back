import { Request, Response, NextFunction } from 'express';
import { getOverdueMandatorySessionState } from '../services/User/overdueFollowup.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import {
  describeFollowUpUnlockCondition,
  isFollowUpLockResolutionPath,
} from '../utils/followUpLockExemptPaths';
import logger from '../utils/logger';

type OverdueCacheEntry = {
  required: boolean;
  count: number;
  followUpIds: string[];
  expiresAt: number;
};

const CACHE_TTL_MS = 12_000;
const overdueCache = new Map<string, OverdueCacheEntry>();

export const invalidateOverdueFollowUpCache = (userId: string): void => {
  overdueCache.delete(userId);
};

export const isOverdueFollowUpExemptPath = (req: Request): boolean => isFollowUpLockResolutionPath(req);

export const enforceOverdueFollowUp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  if (!req.user?.id) return next();
  if (isOverdueFollowUpExemptPath(req)) return next();

  const user = req.user as { id: string; isOnboarded?: boolean; workspaceId?: string | null };
  if (!user.isOnboarded) return next();

  const blockedEndpoint = normalizeRequestApiPath(req);

  try {
    const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
    if (!workspaceId) return next();

    const cached = overdueCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.required) return next();

      const lockReason = 'OVERDUE_FOLLOWUP_REQUIRED';
      logger.warn('Follow-up lock: access denied', {
        lockReason,
        userId: user.id,
        blockedEndpoint,
        overdueFollowupCount: cached.count,
        overdueFollowUpIds: cached.followUpIds,
        unlockCondition: describeFollowUpUnlockCondition(lockReason),
      });

      return res.status(423).json({
        success: false,
        errorCode: lockReason,
        message: 'You have overdue follow-ups. Complete or extend them before continuing.',
        overdueFollowupCount: cached.count,
      });
    }

    const state = await getOverdueMandatorySessionState(workspaceId, user);
    overdueCache.set(user.id, {
      required: state.overdueFollowupRequired,
      count: state.overdueFollowupCount,
      followUpIds: state.items.map((item) => item.id),
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    if (!state.overdueFollowupRequired) {
      return next();
    }

    const lockReason = 'OVERDUE_FOLLOWUP_REQUIRED';
    logger.warn('Follow-up lock: access denied', {
      lockReason,
      userId: user.id,
      blockedEndpoint,
      overdueFollowupCount: state.overdueFollowupCount,
      overdueFollowUpIds: state.items.map((item) => item.id),
      unlockCondition: describeFollowUpUnlockCondition(lockReason),
    });

    return res.status(423).json({
      success: false,
      errorCode: lockReason,
      message: 'You have overdue follow-ups. Complete or extend them before continuing.',
      overdueFollowupCount: state.overdueFollowupCount,
    });
  } catch (error) {
    logger.error('Overdue follow-up enforcement failed', {
      error,
      userId: user.id,
      blockedEndpoint,
    });
    return next();
  }
};
