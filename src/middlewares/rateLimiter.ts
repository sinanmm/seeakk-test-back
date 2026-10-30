import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import jwt from 'jsonwebtoken';
import { redisClient } from '../config/redis';
import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { applyCorsHeadersIfAllowed } from '../config/cors';

const toRedisArgument = (value: unknown): string | Buffer => {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

/**
 * Resilient rate limit store that dynamically delegates to Redis when ready,
 * while safely falling back to MemoryStore when Redis is offline or initializing.
 * Prevents race conditions during asynchronous Redis connection on startup.
 */
class ResilientRateLimitStore {
  private prefix: string;
  private memoryStore: any;
  private redisStore: any = null;
  private options: any = null;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.memoryStore = new MemoryStore();
  }

  init(options: any) {
    this.options = options;
    if (this.memoryStore.init) {
      this.memoryStore.init(options);
    }
  }

  private getActiveStore() {
    if (redisClient && redisClient.isReady) {
      if (!this.redisStore) {
        try {
          this.redisStore = new RedisStore({
            sendCommand: (...args: Array<string | Buffer | number>) =>
              redisClient.sendCommand(args.map(toRedisArgument)),
            prefix: this.prefix,
          });
          if (this.options && this.redisStore.init) {
            this.redisStore.init(this.options);
          }
        } catch (err: any) {
          logger.warn('Failed to lazily initialize Redis rate limit store, falling back to memory', {
            prefix: this.prefix,
            error: err?.message,
          });
          this.redisStore = null;
        }
      }
      if (this.redisStore) return this.redisStore;
    }
    return this.memoryStore;
  }

  async increment(key: string) {
    const store = this.getActiveStore();
    try {
      return await store.increment(key);
    } catch (err) {
      if (store !== this.memoryStore) {
        return this.memoryStore.increment(key);
      }
      throw err;
    }
  }

  async decrement(key: string) {
    const store = this.getActiveStore();
    try {
      return await store.decrement(key);
    } catch (err) {
      if (store !== this.memoryStore) {
        return this.memoryStore.decrement(key);
      }
      throw err;
    }
  }

  async resetKey(key: string) {
    const store = this.getActiveStore();
    try {
      return await store.resetKey(key);
    } catch (err) {
      if (store !== this.memoryStore) {
        return this.memoryStore.resetKey(key);
      }
      throw err;
    }
  }

  async resetAll() {
    const store = this.getActiveStore();
    try {
      if (store.resetAll) return await store.resetAll();
    } catch (err) {
      if (store !== this.memoryStore && this.memoryStore.resetAll) {
        return this.memoryStore.resetAll();
      }
      throw err;
    }
  }
}

export const createResilientStore = (prefix: string) => new ResilientRateLimitStore(prefix);

/**
 * Safely extracts a verified user ID from the request.
 * If authentication middleware hasn't run yet, verifies the JWT signature
 * against JWT_SECRET cryptographically before trusting the identity.
 */
export const getVerifiedUserId = (req: Request): string | null => {
  // If already authenticated by protect middleware
  const user = (req as any).user;
  if (user?.id) return String(user.id);

  // If Authorization header present with Bearer token, cryptographically verify it
  const authHeader = req.headers.authorization || req.header('Authorization');
  const jwtSecret = process.env.JWT_SECRET;
  if (authHeader && jwtSecret) {
    let token = authHeader.trim();
    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7).trim();
    }
    if (token && token !== 'null' && token !== 'undefined') {
      try {
        const decoded = jwt.verify(token, jwtSecret, { clockTolerance: 30 }) as { userId?: string };
        if (decoded?.userId) {
          return String(decoded.userId);
        }
      } catch {
        // Invalid or expired signature - fallback to device/IP
      }
    }
  }

  const xAccessToken = req.headers['x-access-token'] as string | undefined;
  if (xAccessToken && jwtSecret) {
    const token = xAccessToken.trim();
    if (token && token !== 'null' && token !== 'undefined') {
      try {
        const decoded = jwt.verify(token, jwtSecret, { clockTolerance: 30 }) as { userId?: string };
        if (decoded?.userId) {
          return String(decoded.userId);
        }
      } catch {
        // Invalid or expired signature - fallback to device/IP
      }
    }
  }

  return null;
};

/**
 * Checks whether an incoming request targets an endpoint protected by a dedicated
 * high-capacity business rate limiter (e.g. lead assignment or attendance approval).
 * Skipping globalLimiter on these endpoints prevents the generic IP bucket from
 * starving legitimate high-frequency business operations.
 */
export const isExemptFromGlobalLimiter = (req: Request): boolean => {
  const path = req.path || req.originalUrl || '';

  // 1. Attendance approval routes have dedicated attendanceApprovalLimiter
  if (
    path.includes('/attendance/approve') ||
    path.includes('/attendance/review') ||
    path.includes('/attendance/reject')
  ) {
    return true;
  }

  // 2. Lead assignment routes have dedicated leadAssignmentLimiter
  if (
    path.includes('/bulk-assign') ||
    /\/leads\/[^/]+\/assign/.test(path) ||
    (req.method === 'PATCH' && path.endsWith('/leads/bulk')) ||
    (req.method === 'PUT' && /\/leads\/[^/]+$/.test(path) && (req.body as any)?.assignedToId !== undefined)
  ) {
    return true;
  }

  return false;
};

export const getGlobalLimiterKey = (req: Request): string => {
  const verifiedUserId = getVerifiedUserId(req);
  if (verifiedUserId) return `usr:${verifiedUserId}`;
  const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
  if (deviceId) return `dev:${deviceId}`;
  return `ip:${ipKeyGenerator(req.ip || '')}`;
};

export const globalRateLimitHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  options: any,
) => {
  logger.warn('Global rate limit exceeded', {
    ip: req.ip,
    action: 'rate_limit_global',
    path: req.originalUrl || req.path,
  });
  applyCorsHeadersIfAllowed(req, res);
  const retryAfter = Math.max(1, Math.ceil((options.windowMs || 0) / 1000));
  res.status(options.statusCode).json({
    success: false,
    code: 'GLOBAL_RATE_LIMITED',
    message: 'Too many requests, please try again later.',
    retryAfterSeconds: retryAfter,
  });
};

export const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 3000),
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:global:') as any,
  skip: (req: Request) => req.method === 'OPTIONS' || isExemptFromGlobalLimiter(req),
  keyGenerator: getGlobalLimiterKey,
  handler: globalRateLimitHandler,
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:pwreset:') as any,
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      action: 'rate_limit_password_reset_block',
    });
    const retryAfterSeconds = Math.max(1, Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000));
    res.status(options.statusCode).json({
      success: false,
      code: 'PASSWORD_RESET_RATE_LIMITED',
      message: 'Too many password reset requests from this IP, please try again after 15 minutes.',
      retryAfterSeconds,
    });
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:auth:') as any,
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    logger.warn('Auth rate limit exceeded (Brute-force protection)', {
      ip: req.ip,
      action: 'rate_limit_auth_block',
    });
    const retryAfterSeconds = Math.max(1, Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000));
    res.status(options.statusCode).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many login attempts from this IP, please try again after 15 minutes.',
      retryAfterSeconds,
    });
  },
});

export const attendanceApprovalLimiter = rateLimit({
  windowMs: Number(process.env.ATTENDANCE_APPROVAL_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.ATTENDANCE_APPROVAL_RATE_LIMIT_MAX || 3000),
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:att_approval:') as any,
  skip: (req: Request) => req.method === 'OPTIONS',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || getVerifiedUserId(req);
    if (userId) return `usr:${userId}`;
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (deviceId) return `dev:${deviceId}`;
    return `ip:${ipKeyGenerator(req.ip || '')}`;
  },
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    const requestId = (req as any).id || (req.headers['x-request-id'] as string | undefined) || 'unknown';
    const userId = (req as any).user?.id || getVerifiedUserId(req) || 'unauthenticated';
    const route = req.originalUrl || req.path;
    const retryAfter = Math.max(1, Math.ceil((options.windowMs || 0) / 1000));

    logger.warn('Attendance approval rate limit exceeded', {
      action: 'rate_limit_attendance_approval',
      requestId,
      userId,
      route,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      limit: options.max,
      windowMs: options.windowMs,
      retryAfterSeconds: retryAfter,
      reason: 'Exceeded attendance approval bulk processing limit',
    });

    applyCorsHeadersIfAllowed(req, res);
    res.status(options.statusCode).json({
      success: false,
      code: 'ATTENDANCE_APPROVAL_RATE_LIMITED',
      message: "You're processing requests very quickly. Please wait a few seconds and try again.",
      retryAfterSeconds: retryAfter,
    });
  },
});

export const getLeadAssignmentKey = (req: Request): string => {
  const userId = (req as any).user?.id || getVerifiedUserId(req);
  const workspaceId =
    (req as any).user?.workspaceId ||
    (req.headers['x-workspace-id'] as string | undefined)?.trim();

  if (userId && workspaceId) return `usr:${userId}:ws:${workspaceId}:lead_assign`;
  if (userId) return `usr:${userId}:lead_assign`;
  const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
  if (deviceId) return `dev:${deviceId}:lead_assign`;
  return `ip:${ipKeyGenerator(req.ip || '')}:lead_assign`;
};

export const leadAssignmentRateLimitHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  options: any,
) => {
  const requestId =
    (req as any).id || (req.headers['x-request-id'] as string | undefined) || 'unknown';
  const userId = (req as any).user?.id || getVerifiedUserId(req) || 'unauthenticated';
  const workspaceId = (req as any).user?.workspaceId || 'unknown';
  const route = req.originalUrl || req.path;
  const retryAfter = Math.max(1, Math.ceil((options.windowMs || 0) / 1000));

  logger.warn('Lead assignment rate limit exceeded', {
    action: 'rate_limit_lead_assignment',
    requestId,
    userId,
    workspaceId,
    route,
    timestamp: new Date().toISOString(),
    ip: req.ip,
    limit: options.max,
    windowMs: options.windowMs,
    retryAfterSeconds: retryAfter,
    reason: 'Exceeded lead assignment processing limit',
  });

  applyCorsHeadersIfAllowed(req, res);
  res.status(options.statusCode).json({
    success: false,
    code: 'LEAD_ASSIGNMENT_RATE_LIMITED',
    message: 'Lead assignment requests are temporarily limited. Please retry shortly.',
    retryAfterSeconds: retryAfter,
  });
};

export const leadAssignmentLimiter = rateLimit({
  windowMs: Number(process.env.LEAD_ASSIGNMENT_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LEAD_ASSIGNMENT_RATE_LIMIT_MAX || 5000),
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:lead_assign:') as any,
  skip: (req: Request) => req.method === 'OPTIONS',
  keyGenerator: getLeadAssignmentKey,
  handler: leadAssignmentRateLimitHandler,
});
