import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis';
import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';

const getStore = (prefix: string) => {
  if (redisClient.isReady) {
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
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
    const retryAfter = Math.max(1, Math.ceil((options.windowMs || 0) / 1000));
    res.status(options.statusCode).json({
      message: 'Too many requests, please try again later.',
      retryAfterSeconds: retryAfter,
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
    res.status(options.statusCode).json({
      message: 'Too many login attempts from this IP, please try again after 15 minutes.',
    });
  },
});
