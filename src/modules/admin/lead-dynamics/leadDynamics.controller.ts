import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import * as leadDynamicsService from './leadDynamics.service';
import {
  CreateLeadDynamicFieldInput,
  createLeadDynamicFieldSchema,
  ListLeadDynamicFieldsQuery,
  listLeadDynamicFieldsQuerySchema,
  SaveLeadDynamicValuesInput,
  saveLeadDynamicValuesSchema,
  UpdateLeadDynamicFieldInput,
  updateLeadDynamicFieldSchema,
} from './leadDynamics.validation';

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
      message:
        'Lead Dynamics module is not ready. Required database schema is missing. Run Prisma migration/db push.',
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

  logger.error(`Lead dynamics error during ${action}`, { error: error?.message });
  next(error);
};

export const createLeadDynamicField = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLeadDynamicFieldInput>(createLeadDynamicFieldSchema, req.body, res);
  if (!input) return;

  try {
    const data = await leadDynamicsService.createLeadDynamicField(workspaceId, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_CREATE_LEAD_DYNAMIC_FIELD',
      entityType: 'LeadDynamicField',
      entityId: data.id,
      details: { name: data.name, inputType: data.inputType, sortOrder: data.sortOrder },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Lead dynamic field created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLeadDynamicField');
  }
};

export const listLeadDynamicFields = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLeadDynamicFieldsQuery>(listLeadDynamicFieldsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadDynamicsService.listLeadDynamicFields(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Lead dynamic fields fetched successfully',
      data: result.fields,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadDynamicFields');
  }
};

export const getLeadDynamicActiveFields = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await leadDynamicsService.getLeadDynamicActiveFields(workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Active lead dynamic fields fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLeadDynamicActiveFields');
  }
};

export const updateLeadDynamicField = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;
  const input = validate<UpdateLeadDynamicFieldInput>(updateLeadDynamicFieldSchema, req.body, res);
  if (!input) return;

  try {
    const data = await leadDynamicsService.updateLeadDynamicField(id, workspaceId, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_UPDATE_LEAD_DYNAMIC_FIELD',
      entityType: 'LeadDynamicField',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead dynamic field updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLeadDynamicField');
  }
};

export const deleteLeadDynamicField = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;

  try {
    await leadDynamicsService.deleteLeadDynamicField(id, workspaceId);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_DELETE_LEAD_DYNAMIC_FIELD',
      entityType: 'LeadDynamicField',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead dynamic field deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLeadDynamicField');
  }
};

export const saveLeadDynamicValues = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const leadId = req.params['id'] as string;
  const input = validate<SaveLeadDynamicValuesInput>(saveLeadDynamicValuesSchema, req.body, res);
  if (!input) return;

  try {
    const data = await leadDynamicsService.saveLeadDynamicValues(workspaceId, leadId, input);
    return res.status(200).json({
      success: true,
      message: 'Lead dynamic values saved successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'saveLeadDynamicValues');
  }
};
