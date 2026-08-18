import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as whatsappTemplateService from '../../services/User/whatsappTemplate.service';
import {
  createWhatsAppTemplateSchema,
  updateWhatsAppTemplateSchema,
} from '../../validations/whatsappTemplateValidation';
import prisma from '../../config/prisma';

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }
  return workspaceId;
};

export const getTemplates = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const status = req.query.status as string | undefined;
    const templates = await whatsappTemplateService.getWhatsAppTemplates(workspaceId, status);
    return res.status(200).json({
      success: true,
      message: 'WhatsApp templates retrieved successfully',
      data: templates,
    });
  } catch (error) {
    next(error);
  }
};

export const getTemplateById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    const template = await whatsappTemplateService.getWhatsAppTemplateById(workspaceId, id);
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp template not found',
      });
    }
    return res.status(200).json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

export const createTemplate = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const result = createWhatsAppTemplateSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
  }

  try {
    const template = await whatsappTemplateService.createWhatsAppTemplate(
      workspaceId,
      req.user!.id,
      result.data
    );

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'WHATSAPP_TEMPLATE_CREATED',
      entityType: 'WhatsAppTemplate',
      entityId: template.id,
      details: {
        name: template.name,
        category: template.category,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'WhatsApp template created successfully',
      data: template,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export const updateTemplate = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const result = updateWhatsAppTemplateSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
  }

  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    const template = await whatsappTemplateService.updateWhatsAppTemplate(
      workspaceId,
      id,
      result.data
    );

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'WHATSAPP_TEMPLATE_UPDATED',
      entityType: 'WhatsAppTemplate',
      entityId: template.id,
      details: {
        name: template.name,
        category: template.category,
        status: template.status,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'WhatsApp template updated successfully',
      data: template,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export const deleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    const result = await whatsappTemplateService.deleteWhatsAppTemplate(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'WHATSAPP_TEMPLATE_DELETED',
      entityType: 'WhatsAppTemplate',
      entityId: id,
      details: {
        deactivatedOnly: result.status === 'INACTIVE',
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: result.status === 'INACTIVE'
        ? 'Template is referenced by past follow-ups and was deactivated.'
        : 'WhatsApp template deleted successfully',
      data: result,
    });
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export const recordWhatsAppOpened = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { followUpId } = req.body;
  if (!followUpId) {
    return res.status(400).json({
      success: false,
      message: 'followUpId is required',
    });
  }

  try {
    const followUp = await prisma.followUp.findFirst({
      where: { id: followUpId, workspaceId },
      include: {
        lead: true,
        whatsappTemplate: true,
      },
    });

    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found',
      });
    }

    // Update reminder status to OPENED_WHATSAPP (NOT SENT)
    const updatedFollowUp = await prisma.followUp.update({
      where: { id: followUpId },
      data: {
        whatsappReminderStatus: 'OPENED_WHATSAPP',
      },
    });

    // Record lead activity
    if (followUp.leadId) {
      try {
        await (prisma as any).leadActivity.create({
          data: {
            leadId: followUp.leadId,
            performedById: req.user!.id,
            workspaceId,
            action: 'WHATSAPP_OPENED',
            metadata: {
              followUpId: followUp.id,
              templateName: followUp.whatsappTemplate?.name || 'Custom',
              status: 'OPENED_WHATSAPP',
              description: 'WhatsApp opened from follow-up',
            },
          },
        });
      } catch (actErr) {
        logger.warn('Failed to record WhatsApp activity in lead history:', actErr);
      }
    }

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'WHATSAPP_REMINDER_OPENED',
      entityType: 'FollowUp',
      entityId: followUp.id,
      details: {
        leadId: followUp.leadId,
        templateId: followUp.whatsappTemplateId,
        status: 'OPENED_WHATSAPP',
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'WhatsApp click logged successfully',
      data: updatedFollowUp,
    });
  } catch (error) {
    next(error);
  }
};
