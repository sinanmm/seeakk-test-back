import { Request, Response, NextFunction } from 'express';
import { getOverdueMandatorySessionState } from '../services/User/overdueFollowup.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import {
  describeFollowUpUnlockCondition,
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

const isBulkExtendResolutionRequest = (req: Request): boolean => {
  if ((req.method || 'GET').toUpperCase() !== 'POST') {
    return false;
  }

  const haystack = [
    req.originalUrl,
    req.url,
    req.path,
    req.baseUrl,
    req.route?.path,
    `${req.baseUrl || ''}${req.path || ''}`,
    `${req.baseUrl || ''}${req.route?.path || ''}`,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('|')
    .toLowerCase();

  return haystack.includes('bulk-extend') || haystack.includes('bulk_extend');
};

const logResolutionPathAllowed = (req: Request, endpoint: string): void => {
  logger.info('Follow-up lock: overdue resolution path allowed', {
    middlewareName: 'enforceOverdueFollowUp',
    lockReason: LOCK_REASON,
    userId: req.user?.id,
    endpoint,
    requestMethod: (req.method || 'GET').toUpperCase(),
    whitelisted: true,
    triggerReason: 'Endpoint is whitelisted for overdue follow-up resolution',
  });
};

export const enforceOverdueFollowUp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const endpoint = normalizeRequestApiPath(req);
  const requestMethod = (req.method || 'GET').toUpperCase();

  if (!req.user?.id) return next();

  if (isBulkExtendResolutionRequest(req) || isOverdueFollowUpExemptPath(req)) {
    logResolutionPathAllowed(req, endpoint);
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
      });

      return res.status(423).json({
        success: false,
        errorCode: LOCK_REASON,
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
    });

    return res.status(423).json({
      success: false,
      errorCode: LOCK_REASON,
      message: 'You have overdue follow-ups. Complete or extend them before continuing.',
      overdueFollowupCount: state.overdueFollowupCount,
    });
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
