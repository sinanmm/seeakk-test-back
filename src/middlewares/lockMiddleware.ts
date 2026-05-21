import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const checkUserLock = (req: Request, res: Response, next: NextFunction): any => {
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
