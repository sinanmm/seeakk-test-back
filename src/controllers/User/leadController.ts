import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as leadService from '../../services/User/leadService';
import { emitWorkspaceEvent } from '../../realtime/socket';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExtendLeadSlaInput,
  ExportLeadsQueryInput,
  LeadIdParamInput,
  ListLeadsQueryInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';
import {
  assignLeadSchema,
  changeStageSchema,
  createLeadSchema,
  extendLeadSlaSchema,
  exportLeadsQuerySchema,
  leadIdParamSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from '../../validations/leadValidation';

const normalizeStageKey = (value?: string | null): string =>
  (value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

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
  if (error?.code === 'P2021' || error?.code === 'P2022') {
    const meta = error?.meta as { column?: string; table?: string; modelName?: string } | undefined;
    const detail =
      error?.code === 'P2022'
        ? `Database column out of sync (missing: ${meta?.column ?? 'unknown'}).`
        : `Database table out of sync (missing: ${meta?.table ?? meta?.modelName ?? 'unknown'}).`;
    logger.error(`Lead schema mismatch (${error?.code})`, { action, meta: error?.meta, message: error?.message });
    res.status(503).json({
      success: false,
      message: `Leads module is not ready. ${detail} Run \`npx prisma migrate deploy\` on the production database for this service's DATABASE_URL, then restart the API.`,
    });
    return;
  }

  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Lead error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  role: req.user?.role,
});

export const createLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLeadInput>(createLeadSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.createLead(workspaceId, getActor(req), input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'created' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_CREATED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        name: lead.name,
        assignedToId: lead.assignedToId,
        stageId: lead.stageId,
        sourceId: lead.sourceId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLead');
  }
};

export const listLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLeadsQueryInput>(listLeadsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadService.getLeads(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Leads fetched successfully',
      leads: result.leads,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeads');
  }
};

export const getLeadById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const lead = await leadService.getLeadById(workspaceId, params.id);
    return res.status(200).json({
      success: true,
      message: 'Lead fetched successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLeadById');
  }
};

export const updateLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateLeadInput>(updateLeadSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.updateLead(workspaceId, getActor(req), params.id, input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'updated' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_UPDATED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        updatedFields: Object.keys(req.body || {}),
        assignedToId: lead.assignedToId,
        stageId: lead.stageId,
        nextFollowUpAt: lead.nextFollowUpAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead updated successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLead');
  }
};

export const changeStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ChangeStageInput>(changeStageSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadService.changeStage(workspaceId, getActor(req), params.id, input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'stage_changed' });

    if (result.approvalRequired) {
      return res.status(202).json({
        success: true,
        message: 'Approval required. Stage change request created successfully.',
        approvalRequired: true,
        data: {
          lead: result.lead,
          approval: result.approval,
        },
      });
    }

    const lead = result.lead;
    const isClosureStage = Boolean(lead.stage?.isClosed);
    const action = lead.isLOB
      ? 'LEAD_LOB_APPLIED'
      : lead.isClosed && isClosureStage
        ? 'LEAD_CLOSED'
        : 'LEAD_STAGE_CHANGED';

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action,
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        stageId: lead.stageId,
        isLOB: lead.isLOB,
        isClosed: lead.isClosed,
        generatedRevenue: (lead as any).generatedRevenue,
        reasonId: input.reasonId,
        remarks: input.remarks,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage updated successfully',
      approvalRequired: false,
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'changeStage');
  }
};

export const assignLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<AssignLeadInput>(assignLeadSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.assignLead(workspaceId, getActor(req), params.id, input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'reassigned' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_ASSIGNED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        assignedToId: lead.assignedToId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead assignment updated successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'assignLead');
  }
};

export const extendLeadSla = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ExtendLeadSlaInput>(extendLeadSlaSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.extendLeadSla(workspaceId, params.id, input.extraDays);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'sla_extended' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_SLA_EXTENDED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        extraDays: input.extraDays,
        stageExpiresAt: (lead as any).stageExpiresAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead lifecycle timer extended successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'extendLeadSla');
  }
};

export const deleteLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadService.deleteLead(workspaceId, params.id);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'archived' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_ARCHIVED',
      entityType: 'Lead',
      entityId: params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead archived successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLead');
  }
};

export const permanentlyDeleteLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadService.permanentlyDeleteLead(workspaceId, params.id);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'deleted' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_PERMANENTLY_DELETED',
      entityType: 'Lead',
      entityId: params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead permanently deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'permanentlyDeleteLead');
  }
};

export const bulkDeleteLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { ids, permanent } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(422).json({
      success: false,
      message: 'Lead IDs are required and must be an array.',
    });
  }

  try {
    await leadService.bulkDeleteLeads(workspaceId, ids, Boolean(permanent));
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadIds: ids, action: permanent ? 'bulk_deleted' : 'bulk_archived' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: permanent ? 'LEADS_BULK_PERMANENTLY_DELETED' : 'LEADS_BULK_ARCHIVED',
      entityType: 'Lead',
      entityId: 'multiple',
      details: {
        count: ids.length,
        ids: ids.slice(0, 50), // Log first 50 for safety
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: `${ids.length} leads ${permanent ? 'permanently deleted' : 'archived'} successfully`,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'bulkDeleteLeads');
  }
};

export const exportLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ExportLeadsQueryInput>(exportLeadsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const exported = await leadService.exportLeads(workspaceId, query);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return res.status(200).send(exported.content);
  } catch (error) {
    handleServiceError(error, res, next, 'exportLeads');
  }
};
