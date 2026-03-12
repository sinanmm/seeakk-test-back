import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/Auth/user';
import logger from '../utils/logger';

interface JwtPayload {
  userId: string;
}

/**
 * Protect routes - Verifies JWT and injects User object into req
 */
export const protect = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    let token: string | null = null;

    // Safely extract Authorization header regardless of casing
    const authHeader = req.headers.authorization || req.header('Authorization');

    logger.info('POSTMAN DEBUG -> RAW HEADER:', { authString: authHeader });

    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    if (!token && req.headers['x-access-token']) {
      token = (req.headers['x-access-token'] as string).trim();
    }

    if (token === 'null' || token === 'undefined' || token === '') {
      token = null;
    }

    if (!token) {
      logger.warn('Access denied. No token provided / Token was empty space.', {
        action: 'auth_missing_token',
        ip: req.ip,
      });
      return res.status(401).json({
        message: 'Not authorized to access this route. No token provided.',
        diagnostic:
          "You did not send an 'Authorization' header. If using Postman, click the 'Authorization' tab, select 'Bearer Token', and paste your token inside.",
        rawHeaderReceived: authHeader || 'NOTHING RECEIVED',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    const user = await User.findById(decoded.userId).populate('role');

    if (!user) {
      logger.warn('Access denied. Token user no longer exists.', {
        userId: decoded.userId,
        action: 'auth_ghost_user',
      });
      return res.status(401).json({ message: 'The user belonging to this token no longer exists.' });
    }

    if (!user.isActive) {
      logger.warn('Access denied. User is inactive.', {
        userId: user._id,
        action: 'auth_inactive_user',
      });
      return res.status(403).json({ message: 'User account is suspended or inactive.' });
    }

    req.user = user;
    next();
  } catch (error: any) {
    logger.error('Authentication Error', { error: error.message, action: 'auth_failed' });
    return res.status(401).json({
      message: 'Not authorized. Token failed or expired.',
      diagnosticReason: error.message,
      solution: 'Please log in again to receive a fresh, valid token.',
    });
  }
};

/**
 * Role-Based Access Control (RBAC) - Restricts functionality by user role
 * @param {string[]} roles - Array of permitted roles (e.g., 'admin', 'manager')
 */
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!req.user || !req.user.role) {
      logger.warn('Access forbidden. User has no assigned role.', {
        userId: req.user?._id,
        action: 'rbac_forbidden_no_role',
      });
      return res.status(403).json({ message: 'Forbidden: You do not have an assigned role to access this.' });
    }

    const role = req.user.role;
    if (role instanceof mongoose.Types.ObjectId) {
      logger.warn('Access forbidden. User role is not populated.', {
        userId: req.user._id,
        action: 'rbac_forbidden_unpopulated_role',
      });
      return res.status(403).json({ message: 'Forbidden: User role context is incomplete.' });
    }

    const userRole = role.name;

    if (!roles.includes(userRole)) {
      logger.warn(`Access forbidden. Required: ${roles.join(', ')}, Found: ${userRole}`, {
        userId: req.user._id,
        role: userRole,
        action: 'rbac_forbidden',
      });
      return res.status(403).json({
        message: `Forbidden: The '${userRole}' role is not authorized to access this route.`,
      });
    }

    next();
  };
};
