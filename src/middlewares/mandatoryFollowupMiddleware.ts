import { Request, Response, NextFunction } from 'express';
import { getMandatoryFollowUpSessionState } from '../services/User/mandatoryFollowupContinuation.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import logger from '../utils/logger';

type MandatoryCacheEntry = {
  required: boolean;
  count: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 12_000;
const mandatoryCache = new Map<string, MandatoryCacheEntry>();

export const invalidateMandatoryFollowUpCache = (userId: string): void => {
  mandatoryCache.delete(userId);
};

/** Routes that must stay reachable while mandatory continuation is pending. */
export const isMandatoryFollowUpExemptPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const path = normalizeRequestApiPath(req);

  const exemptPrefixes = [
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/followups/mandatory-continuation',
    '/api/followups/users',
    '/api/followups/history',
    // Allow UI/meta lookups while mandatory follow-up is pending.
    // These endpoints are required to render assignee pickers/admin lists,
    // so blocking them causes broken screens.
    '/api/leads/meta/assignees',
    '/api/admin/users',
    '/api/attendance/today',
    '/api/attendance/check-in',
    '/api/attendance/settings',
    '/api/attendance/networks',
  ];

  return exemptPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
};

const readCachedMandatoryState = (userId: string): MandatoryCacheEntry | null => {
  const cached = mandatoryCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    mandatoryCache.delete(userId);
    return null;
  }
  return cached;
};

const writeCachedMandatoryState = (userId: string, required: boolean, count: number): void => {
  mandatoryCache.set(userId, {
    required,
    count,
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

  try {
    const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
    if (!workspaceId) return next();

    let required: boolean;
    let count: number;

    const cached = readCachedMandatoryState(user.id);
    if (cached) {
      required = cached.required;
      count = cached.count;
    } else {
      const state = await getMandatoryFollowUpSessionState(workspaceId, { id: user.id });
      required = state.mandatoryFollowupRequired;
      count = state.mandatoryFollowupCount;
      writeCachedMandatoryState(user.id, required, count);
    }

    if (!required) return next();

    return res.status(423).json({
      success: false,
      errorCode: 'MANDATORY_FOLLOWUP_REQUIRED',
      mandatoryFollowupRequired: true,
      mandatoryFollowupCount: count,
      message:
        'Mandatory lifecycle follow-up continuation is required before you can access this resource.',
    });
  } catch (error: any) {
    logger.warn('Mandatory follow-up enforcement check failed; allowing request', {
      userId: user.id,
      path: req.originalUrl,
      message: error?.message,
    });
    return next();
  }
};
