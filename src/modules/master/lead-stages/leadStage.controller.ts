import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import * as leadStageService from './leadStage.service';
import {
  CreateLeadStageInput,
  createLeadStageSchema,
  ListLeadStagesQuery,
  listLeadStagesQuerySchema,
  ReorderLeadStagesInput,
  reorderLeadStagesSchema,
  UpdateLeadStageInput,
  updateLeadStageSchema,
} from './leadStage.validator';

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
  if (error?.code === 'P2021') {
    res.status(503).json({
      success: false,
      message: 'Lead Stages module is not ready. Database table "lead_stages" or "stage_rules" is missing. Run Prisma migration/db push.',
    });
    return;
  }

  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  logger.error(`Lead stage error during ${action}`, { error: error?.message });
  next(error);
};

const getWorkspaceId = async (req: Request, res: Response): Promise<string | null> => {
  let workspaceId = req.user?.workspaceId;

  // Fallback: If workspaceId is missing from token (stale session), fetch from DB
  if (!workspaceId && req.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { workspaceId: true },
    });
    workspaceId = user?.workspaceId;
  }

  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Workspace context is required. Please refresh your session.',
    });
    return null;
  }

  return workspaceId;
};

export const createLeadStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<CreateLeadStageInput>(createLeadStageSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadStageService.createLeadStage(workspaceId, input, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_CREATE_LEAD_STAGE',
      entityType: 'LeadStage',
      entityId: data.id,
      details: { name: data.name, order: data.order },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Lead stage created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLeadStage');
  }
};

export const listLeadStages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const query = validate<ListLeadStagesQuery>(listLeadStagesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const result = await leadStageService.listLeadStages(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Lead stages fetched successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadStages');
  }
};

export const getPipelineLeadStages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadStageService.getPipelineLeadStages(workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Lead stage pipeline fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getPipelineLeadStages');
  }
};

export const updateLeadStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;
  const input = validate<UpdateLeadStageInput>(updateLeadStageSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadStageService.updateLeadStage(workspaceId, id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_UPDATE_LEAD_STAGE',
      entityType: 'LeadStage',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLeadStage');
  }
};

export const reorderLeadStages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<ReorderLeadStagesInput>(reorderLeadStagesSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadStageService.reorderLeadStages(workspaceId, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_REORDER_LEAD_STAGES',
      entityType: 'LeadStage',
      details: { stages: input },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stages reordered successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'reorderLeadStages');
  }
};

export const toggleLeadStageStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadStageService.toggleLeadStageStatus(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_TOGGLE_LEAD_STAGE_STATUS',
      entityType: 'LeadStage',
      entityId: data.id,
      details: { status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage status updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleLeadStageStatus');
  }
};

export const deleteLeadStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    await leadStageService.deleteLeadStage(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_DELETE_LEAD_STAGE',
      entityType: 'LeadStage',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLeadStage');
  }
};
