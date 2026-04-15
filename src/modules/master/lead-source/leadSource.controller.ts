import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../../utils/workspaceContext';
import * as leadSourceService from './leadSource.service';
import {
  CreateLeadSourceInput,
  createLeadSourceSchema,
  ListLeadSourcesQuery,
  listLeadSourcesQuerySchema,
  UpdateLeadSourceInput,
  updateLeadSourceSchema,
} from './leadSource.validator';

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
      message: 'Lead Source module is not ready. Database table "lead_sources" is missing. Run Prisma migration/db push.',
    });
    return;
  }

  if (error?.code === 'P2022') {
    res.status(503).json({
      success: false,
      message:
        'Lead Source module schema is outdated in the database. Run Prisma migration/db push so workspace-scoped master data can be used.',
    });
    return;
  }

  if (String(error?.message || '').includes('workspaceId')) {
    res.status(503).json({
      success: false,
      message:
        'Lead Source module schema is outdated in the database. Run Prisma migration/db push so workspace-scoped master data can be used.',
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

  logger.error(`Lead source error during ${action}`, { error: error?.message });
  next(error);
};

const getWorkspaceId = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(403).json({
      success: false,
      message: 'Authentication required.',
    });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);

  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Workspace context is required. Please complete workspace setup or refresh your session.',
    });
    return null;
  }

  return workspaceId;
};

export const createLeadSource = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<CreateLeadSourceInput>(createLeadSourceSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadSourceService.createLeadSource(workspaceId, input, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: workspaceId,
      action: 'MASTER_CREATE_LEAD_SOURCE',
      entityType: 'LeadSource',
      entityId: data.id,
      details: { name: data.name, status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Lead source created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLeadSource');
  }
};

export const listLeadSources = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const query = validate<ListLeadSourcesQuery>(listLeadSourcesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const result = await leadSourceService.listLeadSources(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Lead sources fetched successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadSources');
  }
};

export const getActiveLeadSources = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadSourceService.getActiveLeadSources(workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Active lead sources fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getActiveLeadSources');
  }
};

export const updateLeadSource = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;
  const input = validate<UpdateLeadSourceInput>(updateLeadSourceSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadSourceService.updateLeadSource(workspaceId, id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: workspaceId,
      action: 'MASTER_UPDATE_LEAD_SOURCE',
      entityType: 'LeadSource',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead source updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLeadSource');
  }
};

export const toggleLeadSourceStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    const data = await leadSourceService.toggleLeadSourceStatus(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: workspaceId,
      action: 'MASTER_TOGGLE_LEAD_SOURCE_STATUS',
      entityType: 'LeadSource',
      entityId: data.id,
      details: { status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead source status updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleLeadSourceStatus');
  }
};

export const deleteLeadSource = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;

    await leadSourceService.deleteLeadSource(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: workspaceId,
      action: 'MASTER_DELETE_LEAD_SOURCE',
      entityType: 'LeadSource',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead source deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLeadSource');
  }
};
