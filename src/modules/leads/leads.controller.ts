import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as leadsService from './leads.service';
import type { ClosedLeadIdInput, ClosedLeadQueryInput, UpdateClosedLeadInput } from './leads.validation';
import { closedLeadQuerySchema, leadIdSchema, updateClosedLeadSchema } from './leads.validation';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';

const requireWorkspace = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Not authorized' });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }

  return workspaceId;
};

function validate<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  return result.data as T;
}

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Closed leads error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const listClosedLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ClosedLeadQueryInput>(closedLeadQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadsService.listClosedLeads(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listClosedLeads');
  }
};

export const updateClosure = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ClosedLeadIdInput>(leadIdSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateClosedLeadInput>(updateClosedLeadSchema, req.body, res);
  if (!input) return;

  try {
    const updated = await leadsService.updateClosedLead(workspaceId, getActor(req), params.id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_CLOSED',
      entityType: 'Lead',
      entityId: updated.id,
      details: {
        closureType: updated.closureType,
        generatedRevenue: updated.generatedRevenue,
        closedAt: updated.closedAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateClosure');
  }
};

export const reopenLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<ClosedLeadIdInput>(leadIdSchema, req.params, res);
  if (!params) return;

  try {
    const updated = await leadsService.reopenClosedLead(workspaceId, getActor(req), params.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_REOPENED',
      entityType: 'Lead',
      entityId: updated.id,
      details: {
        stageId: updated.stageId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'reopenLead');
  }
};

export const exportClosedLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ClosedLeadQueryInput>(closedLeadQuerySchema, req.query, res);
  if (!query) return;

  try {
    const exported = await leadsService.exportClosedLeads(workspaceId, getActor(req), query);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return res.status(200).send(exported.content);
  } catch (error) {
    handleServiceError(error, res, next, 'exportClosedLeads');
  }
};
