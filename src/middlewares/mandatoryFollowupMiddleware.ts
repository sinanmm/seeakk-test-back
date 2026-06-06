import { Request, Response, NextFunction } from 'express';
import { getMandatoryFollowUpSessionState } from '../services/User/mandatoryFollowupContinuation.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import {
  describeFollowUpUnlockCondition,
  isFollowUpLockResolutionPath,
} from '../utils/followUpLockExemptPaths';
import logger from '../utils/logger';

type MandatoryCacheEntry = {
  required: boolean;
  count: number;
  leadIds: string[];
  expiresAt: number;
};

const CACHE_TTL_MS = 12_000;
const mandatoryCache = new Map<string, MandatoryCacheEntry>();

export const invalidateMandatoryFollowUpCache = (userId: string): void => {
  mandatoryCache.delete(userId);
};

/** Routes that must stay reachable while mandatory continuation is pending. */
export const isMandatoryFollowUpExemptPath = (req: Request): boolean => isFollowUpLockResolutionPath(req);

const readCachedMandatoryState = (userId: string): MandatoryCacheEntry | null => {
  const cached = mandatoryCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    mandatoryCache.delete(userId);
    return null;
  }
  return cached;
};

const writeCachedMandatoryState = (
  userId: string,
  required: boolean,
  count: number,
  leadIds: string[],
): void => {
  mandatoryCache.set(userId, {
    required,
    count,
    leadIds,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

/**
 * Blocks authenticated API access when the user has lifecycle leads missing a future follow-up.
 * Call from `protect` after `req.user` is set.
 */
export const enforceMandatoryFollowUpContinuation = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  if (!req.user?.id) return next();
  if (isMandatoryFollowUpExemptPath(req)) return next();

  const user = req.user as { id: string; isOnboarded?: boolean; workspaceId?: string | null };
  if (!user.isOnboarded) return next();

  const blockedEndpoint = normalizeRequestApiPath(req);

  try {
    const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
    if (!workspaceId) return next();

    let required: boolean;
    let count: number;
    let leadIds: string[];

    const cached = readCachedMandatoryState(user.id);
    if (cached) {
      required = cached.required;
      count = cached.count;
      leadIds = cached.leadIds;
    } else {
      const state = await getMandatoryFollowUpSessionState(workspaceId, { id: user.id });
      required = state.mandatoryFollowupRequired;
      count = state.mandatoryFollowupCount;
      leadIds = state.items.map((item) => item.leadId);
      writeCachedMandatoryState(user.id, required, count, leadIds);
    }

    if (!required) return next();

    const lockReason = 'MANDATORY_FOLLOWUP_REQUIRED';
    logger.warn('Follow-up lock: access denied', {
      middlewareName: 'enforceMandatoryFollowUpContinuation',
      lockReason,
      triggerReason: 'Active lifecycle leads require a future follow-up schedule',
      userId: user.id,
      blockedEndpoint,
      followUpIds: leadIds,
      mandatoryFollowupCount: count,
      mandatoryFollowUpLeadIds: leadIds,
      unlockCondition: describeFollowUpUnlockCondition(lockReason),
    });

    return res.status(423).json({
      success: false,
      errorCode: lockReason,
      mandatoryFollowupRequired: true,
      mandatoryFollowupCount: count,
      message:
        'Mandatory lifecycle follow-up continuation is required before you can access this resource.',
    });
  } catch (error: any) {
    logger.warn('Mandatory follow-up enforcement check failed; allowing request', {
      userId: user.id,
      blockedEndpoint,
      message: error?.message,
    });
    return next();
  }
};
