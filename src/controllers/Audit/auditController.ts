import { Request, Response, NextFunction } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';

/**
 * GET /api/audit/logs
 * Fetch audit logs for the workspace
 */
export const getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Your account is not linked to any workspace.',
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const filters = {
      workspaceId,
      userId: req.query.userId as string,
      action: req.query.action as string,
      entityType: req.query.entityType as string,
      entityId: req.query.entityId as string,
      limit,
      offset,
    };

    const result = await auditService.getLogs(filters);

    return res.status(200).json({
      success: true,
      message: 'Audit logs fetched successfully.',
      data: {
        logs: result.logs,
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (error: any) {
    logger.error('Error fetching audit logs', { error: error.message });
    next(error);
  }
};
