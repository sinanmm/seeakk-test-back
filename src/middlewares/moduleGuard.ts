import { Request, Response, NextFunction } from 'express';
import { ModuleEntitlementService } from '../modules/billing/moduleEntitlement.service';
import logger from '../utils/logger';
import { applyCorsHeadersIfAllowed } from '../config/cors';

/**
 * Express middleware factory to protect endpoints by plan module entitlement.
 */
export const requireModule = (moduleKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;

      if (!workspaceId) {
        applyCorsHeadersIfAllowed(req, res);
        res.status(401).json({
          success: false,
          errorCode: 'UNAUTHORIZED',
          message: 'Workspace context missing.',
        });
        return;
      }

      const isAllowed = await ModuleEntitlementService.hasModule(workspaceId, moduleKey);

      if (!isAllowed) {
        logger.warn('Module access blocked by plan entitlement', {
          userId: req.user?.id,
          workspaceId,
          moduleKey,
          path: req.originalUrl || req.path,
        });

        applyCorsHeadersIfAllowed(req, res);
        res.status(403).json({
          success: false,
          errorCode: 'MODULE_NOT_ENABLED',
          module: moduleKey,
          message: `Your current subscription plan does not include access to the '${moduleKey}' module.`,
        });
        return;
      }

      return next();
    } catch (error: any) {
      logger.error('Error in requireModule middleware:', { moduleKey, error: error.message });
      applyCorsHeadersIfAllowed(req, res);
      res.status(500).json({ success: false, message: 'Internal server error evaluating module entitlement' });
    }
  };
};
