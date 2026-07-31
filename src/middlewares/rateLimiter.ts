import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
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

const getStore = (prefix: string) => {
  if (redisClient.isReady) {
    return new RedisStore({
      sendCommand: (...args: Array<string | Buffer | number>) =>
        redisClient.sendCommand(args.map(toRedisArgument)),
      prefix: prefix,
    });
  }
  return undefined;
};

export const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 1000),
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('rl:global:'),
  skip: (req: Request) => req.method === 'OPTIONS',
  keyGenerator: (req: Request) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (deviceId) return `dev:${deviceId}`;
    return `ip:${ipKeyGenerator(req.ip || '')}`;
  },
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    logger.warn('Global rate limit exceeded', { ip: req.ip, action: 'rate_limit_global' });
    applyCorsHeadersIfAllowed(req, res);
    const retryAfter = Math.max(1, Math.ceil((options.windowMs || 0) / 1000));
    res.status(options.statusCode).json({
      message: 'Too many requests, please try again later.',
      retryAfterSeconds: retryAfter,
    });
  },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('rl:pwreset:'),
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
  store: getStore('rl:auth:'),
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
  store: getStore('rl:att_approval:'),
  skip: (req: Request) => req.method === 'OPTIONS',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id;
    if (userId) return `usr:${userId}`;
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (deviceId) return `dev:${deviceId}`;
    return `ip:${ipKeyGenerator(req.ip || '')}`;
  },
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    const requestId = (req as any).id || (req.headers['x-request-id'] as string | undefined) || 'unknown';
    const userId = (req as any).user?.id || 'unauthenticated';
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
