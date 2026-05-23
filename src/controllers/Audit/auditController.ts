import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';

const whatsappClickSchema = z.object({
  entityType: z.enum(['Lead', 'User', 'FollowUp']),
  entityId: z.string().trim().min(1).max(191),
  entityName: z.string().trim().max(200).optional(),
  phoneMasked: z.string().trim().max(32).nullable().optional(),
});

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

/**
 * POST /api/audit/whatsapp-click
 * Optional client-side audit when a user opens WhatsApp chat from the CRM.
 */
export const logWhatsAppClick = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    if (!workspaceId || !userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Your account is not linked to any workspace.',
      });
    }

    const parsed = whatsappClickSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { entityType, entityId, entityName, phoneMasked } = parsed.data;

    await auditService.log({
      userId,
      workspaceId,
      action: 'WHATSAPP_CHAT_OPENED',
      entityType,
      entityId,
      details: {
        entityName: entityName ?? null,
        phoneMasked: phoneMasked ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(204).send();
  } catch (error: any) {
    logger.error('Error logging WhatsApp click', { error: error.message });
    next(error);
  }
};
