import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { applyCorsHeadersIfAllowed } from '../config/cors';

export const platformAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Platform API accessed without proper Authorization header', { ip: req.ip });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(401).json({ message: 'Missing or invalid Authorization header.' });
    }

    const token = authHeader.split(' ')[1];
    const serviceKey = process.env.SEEAKK_CONTROL_SERVICE_KEY;

    if (!serviceKey) {
      logger.error('SEEAKK_CONTROL_SERVICE_KEY is not configured in the environment.');
      applyCorsHeadersIfAllowed(req, res);
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    // Constant-time comparison is recommended for secrets, but for simplicity here we do a direct check.
    if (token !== serviceKey) {
      logger.warn('Platform API accessed with invalid service key', { ip: req.ip });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({ message: 'Invalid service credential.' });
    }

    return next();
  } catch (error) {
    logger.error('Platform Auth Error', { error });
    applyCorsHeadersIfAllowed(req, res);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
