import { NextFunction, Request, Response } from 'express';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as leadService from '../../services/User/leadService';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExportLeadsQueryInput,
  LeadIdParamInput,
  ListLeadsQueryInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';
import {
  assignLeadSchema,
  changeStageSchema,
  createLeadSchema,
  exportLeadsQuerySchema,
  leadIdParamSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from '../../validations/leadValidation';

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
    res.status(503).json({
      success: false,
      message: 'Leads module is not ready. Required database schema is missing. Run Prisma migration/db push.',
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
    const lead = await leadService.changeStage(workspaceId, getActor(req), params.id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: lead.isLOB ? 'LEAD_LOB_APPLIED' : 'LEAD_STAGE_CHANGED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        stageId: lead.stageId,
        isLOB: lead.isLOB,
        reasonId: input.reasonId,
        remarks: input.remarks,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage updated successfully',
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

export const deleteLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadService.deleteLead(workspaceId, params.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_DELETED',
      entityType: 'Lead',
      entityId: params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLead');
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
