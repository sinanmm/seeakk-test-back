import { Request, Response, NextFunction } from 'express';
import { getOverdueMandatorySessionState } from '../services/User/overdueFollowup.service';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import { normalizeRequestApiPath } from '../utils/requestApiPath';
import logger from '../utils/logger';

type OverdueCacheEntry = {
  required: boolean;
  count: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 12_000;
const overdueCache = new Map<string, OverdueCacheEntry>();

export const invalidateOverdueFollowUpCache = (userId: string): void => {
  overdueCache.delete(userId);
};

export const isOverdueFollowUpExemptPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const path = normalizeRequestApiPath(req);

  const exemptPrefixes = [
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/followups/overdue-mandatory',
    '/api/followups/mandatory-continuation',
    '/api/leads/meta/assignees',
    '/api/admin/users',
    '/api/attendance/today',
    '/api/attendance/check-in',
    '/api/attendance/settings',
    '/api/attendance/networks',
  ];

  if (req.method === 'POST' && /^\/api\/followups\/[^/]+\/complete$/.test(path)) {
    return true;
  }
  if (req.method === 'PATCH' && /^\/api\/followups\/[^/]+\/snooze$/.test(path)) {
    return true;
  }

  return exemptPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
};

export const enforceOverdueFollowUp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  if (!req.user?.id) return next();
  if (isOverdueFollowUpExemptPath(req)) return next();

  const user = req.user as { id: string; isOnboarded?: boolean; workspaceId?: string | null };
  if (!user.isOnboarded) return next();

  try {
    const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
    if (!workspaceId) return next();

    const cached = overdueCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.required) return next();
      return res.status(423).json({
        success: false,
        errorCode: 'OVERDUE_FOLLOWUP_REQUIRED',
        message: 'You have overdue follow-ups. Complete or extend them before continuing.',
        overdueFollowupCount: cached.count,
      });
    }

    const state = await getOverdueMandatorySessionState(workspaceId, user);
    overdueCache.set(user.id, {
      required: state.overdueFollowupRequired,
      count: state.overdueFollowupCount,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    if (!state.overdueFollowupRequired) {
      return next();
    }

    logger.warn('Access denied. Overdue follow-ups require action.', {
      userId: user.id,
      count: state.overdueFollowupCount,
    });

    return res.status(423).json({
      success: false,
      errorCode: 'OVERDUE_FOLLOWUP_REQUIRED',
      message: 'You have overdue follow-ups. Complete or extend them before continuing.',
      overdueFollowupCount: state.overdueFollowupCount,
    });
  } catch (error) {
    logger.error('Overdue follow-up enforcement failed', { error });
    return next();
  }
};
