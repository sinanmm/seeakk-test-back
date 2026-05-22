import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import * as targetCycleService from './targetCycle.service';
import { persistTargetCycleWithPeriods } from '../../targets/targetAssignment.service';
import { createPerformanceTargetCycleSchema } from '../../targets/target.validation';
import {
  CreateTargetCycleInput,
  createTargetCycleSchema,
  ListTargetCyclesQuery,
  listTargetCyclesQuerySchema,
  UpdateTargetCycleInput,
  updateTargetCycleSchema,
} from './targetCycle.validation';

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
        'Target Cycle module is not ready. Required database schema is missing. Run Prisma migration/db push.',
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

  logger.error(`Target cycle error during ${action}`, { error: error?.message });
  next(error);
};

export const createTargetCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const isPerformanceCycle = Boolean(req.body?.targetType);

  if (isPerformanceCycle) {
    const perfResult = createPerformanceTargetCycleSchema.safeParse(req.body);
    if (!perfResult.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: perfResult.error.flatten().fieldErrors,
      });
    }
    try {
      const data = await persistTargetCycleWithPeriods(workspaceId, req.user?.id || '', perfResult.data);
      await auditService.log({
        userId: req.user?.id,
        workspaceId,
        action: 'MASTER_CREATE_TARGET_CYCLE',
        entityType: 'TargetCycle',
        entityId: data?.id,
        details: { name: data?.name, targetType: data?.targetType },
      });
      return res.status(201).json({ success: true, message: 'Target cycle created.', data });
    } catch (error: any) {
      return handleServiceError(error, res, next, 'create');
    }
  }

  const input = validate<CreateTargetCycleInput>(createTargetCycleSchema, req.body, res);
  if (!input) return;

  try {
    const data = await targetCycleService.createTargetCycle(workspaceId, input, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_CREATE_TARGET_CYCLE',
      entityType: 'TargetCycle',
      entityId: data.id,
      details: { name: data.name, status: data.status, totalDays: data.totalDays },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Target cycle created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createTargetCycle');
  }
};

export const listTargetCycles = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListTargetCyclesQuery>(listTargetCyclesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await targetCycleService.listTargetCycles(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Target cycles fetched successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listTargetCycles');
  }
};

export const getTargetCycleById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;

  try {
    const data = await targetCycleService.getTargetCycleById(id, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Target cycle fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getTargetCycleById');
  }
};

export const updateTargetCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;

  if (req.body?.targetType) {
    const perfResult = createPerformanceTargetCycleSchema.safeParse(req.body);
    if (!perfResult.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: perfResult.error.flatten().fieldErrors,
      });
    }
    try {
      const data = await persistTargetCycleWithPeriods(workspaceId, req.user?.id || '', perfResult.data, id);
      return res.status(200).json({ success: true, message: 'Target cycle updated.', data });
    } catch (error: any) {
      return handleServiceError(error, res, next, 'updateTargetCycle');
    }
  }

  const input = validate<UpdateTargetCycleInput>(updateTargetCycleSchema, req.body, res);
  if (!input) return;

  try {
    const data = await targetCycleService.updateTargetCycle(id, workspaceId, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_UPDATE_TARGET_CYCLE',
      entityType: 'TargetCycle',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Target cycle updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateTargetCycle');
  }
};

export const deleteTargetCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;

  try {
    await targetCycleService.deleteTargetCycle(id, workspaceId);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'MASTER_DELETE_TARGET_CYCLE',
      entityType: 'TargetCycle',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Target cycle deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteTargetCycle');
  }
};

