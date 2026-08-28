import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { applyCorsHeadersIfAllowed } from '../config/cors';

export const platformAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-service-key'];
    
    let token: string | undefined;
    if (typeof customHeader === 'string' && customHeader.trim()) {
      token = customHeader.trim();
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]?.trim();
    }

    if (!token) {
      logger.warn('Platform API accessed without service key authorization', { ip: req.ip });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header or x-service-key.' });
    }

    const serviceKey = (process.env.SEEAKK_CONTROL_SERVICE_KEY || '').trim();

    if (!serviceKey) {
      logger.error('SEEAKK_CONTROL_SERVICE_KEY is not configured in the environment.');
      applyCorsHeadersIfAllowed(req, res);
      return res.status(500).json({ success: false, message: 'Server configuration error: service key not configured.' });
    }

    // Timing-safe comparison to protect against timing attacks
    const tokenBuffer = Buffer.from(token);
    const keyBuffer = Buffer.from(serviceKey);

    const isMatch = tokenBuffer.length === keyBuffer.length && crypto.timingSafeEqual(tokenBuffer, keyBuffer);

    if (!isMatch) {
      logger.warn('Platform API accessed with invalid service key', { ip: req.ip });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid service credential.' });
    }

    return next();
  } catch (error) {
    logger.error('Platform Auth Error', { error });
    applyCorsHeadersIfAllowed(req, res);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
