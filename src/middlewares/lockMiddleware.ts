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

export const checkUserLock = (req: Request, res: Response, next: NextFunction): any => {
  if (isAccountLockExemptPath(req)) return next();

  if (req.user && req.user.isLocked) {
    logger.warn('Access denied. User account is locked.', { userId: req.user.id });
    return res.status(423).json({ // Using 423 Locked status code
      success: false,
      errorCode: 'ACCOUNT_LOCKED',
      message: 'Your account is temporarily locked due to incomplete targets.',
    });
  }
  next();
};
