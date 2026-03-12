import rateLimit from 'express-rate-limit';
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
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('rl:global:'),
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    logger.warn('Global rate limit exceeded', { ip: req.ip, action: 'rate_limit_global' });
    res.status(options.statusCode).json({ message: 'Too many requests, please try again later.' });
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
