import { Request, Response, NextFunction } from 'express';
import { getOverdueMandatorySessionState } from '../services/User/overdueFollowup.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import {
  describeFollowUpUnlockCondition,
  diagnoseFollowUpLockPath,
  isFollowUpLockDebugEnabled,
  isHardcodedFollowUpLockResolutionRequest,
  isOverdueFollowUpResolutionPath,
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
const LOCK_REASON = 'OVERDUE_FOLLOWUP_REQUIRED';

export const invalidateOverdueFollowUpCache = (userId: string): void => {
  overdueCache.delete(userId);
};

export const isOverdueFollowUpExemptPath = (req: Request): boolean => isOverdueFollowUpResolutionPath(req);

const logResolutionPathAllowed = (req: Request, endpoint: string, bypassReason: string): void => {
  logger.info('Follow-up lock: overdue resolution path allowed', {
    middlewareName: 'enforceOverdueFollowUp',
    lockReason: LOCK_REASON,
    userId: req.user?.id,
    endpoint,
    requestMethod: (req.method || 'GET').toUpperCase(),
    whitelisted: true,
    triggerReason: bypassReason,
    pathDiagnostics: diagnoseFollowUpLockPath(req),
  });
};

const buildOverdueLockDeniedPayload = (
  req: Request,
  overdueFollowupCount: number,
) => {
  const pathDiagnostics = diagnoseFollowUpLockPath(req);
  const payload: Record<string, unknown> = {
    success: false,
    errorCode: LOCK_REASON,
    message: 'You have overdue follow-ups. Complete or extend them before continuing.',
    overdueFollowupCount,
  };

  if (isFollowUpLockDebugEnabled()) {
    payload.debug = pathDiagnostics;
  }

  return { payload, pathDiagnostics };
};

export const enforceOverdueFollowUp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const endpoint = normalizeRequestApiPath(req);
  const requestMethod = (req.method || 'GET').toUpperCase();

  if (!req.user?.id) return next();

  if (isHardcodedFollowUpLockResolutionRequest(req)) {
    logResolutionPathAllowed(req, endpoint, 'Hardcoded haystack matched a resolution endpoint');
    return next();
  }

  if (isOverdueFollowUpExemptPath(req)) {
    logResolutionPathAllowed(req, endpoint, 'Resolution path allowlist matched');
    return next();
  }

  const user = req.user as { id: string; isOnboarded?: boolean; workspaceId?: string | null };
  if (!user.isOnboarded) return next();

  try {
    const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
    if (!workspaceId) return next();

    const cached = overdueCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.required) return next();

      const denied = buildOverdueLockDeniedPayload(req, cached.count);
      logger.warn('Follow-up lock: access denied', {
        middlewareName: 'enforceOverdueFollowUp',
        lockReason: LOCK_REASON,
        triggerReason: 'Cached overdue mandatory follow-ups require resolution',
        userId: user.id,
        endpoint,
        requestMethod,
        whitelisted: false,
        blockedEndpoint: endpoint,
        followUpIds: cached.followUpIds,
        overdueFollowupCount: cached.count,
        overdueFollowUpIds: cached.followUpIds,
        unlockCondition: describeFollowUpUnlockCondition(LOCK_REASON),
        pathDiagnostics: denied.pathDiagnostics,
      });

      return res.status(423).json(denied.payload);
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

    const denied = buildOverdueLockDeniedPayload(req, state.overdueFollowupCount);
    logger.warn('Follow-up lock: access denied', {
      middlewareName: 'enforceOverdueFollowUp',
      lockReason: LOCK_REASON,
      triggerReason: 'Active overdue mandatory follow-ups require resolution',
      userId: user.id,
      endpoint,
      requestMethod,
      whitelisted: false,
      blockedEndpoint: endpoint,
      followUpIds: state.items.map((item) => item.id),
      overdueFollowupCount: state.overdueFollowupCount,
      overdueFollowUpIds: state.items.map((item) => item.id),
      unlockCondition: describeFollowUpUnlockCondition(LOCK_REASON),
      pathDiagnostics: denied.pathDiagnostics,
    });

    return res.status(423).json(denied.payload);
  } catch (error) {
    logger.error('Overdue follow-up enforcement failed', {
      error,
      userId: user.id,
      endpoint,
      requestMethod,
      lockReason: LOCK_REASON,
      whitelisted: false,
    });
    return next();
  }
};
