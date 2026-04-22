import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as leadLifeCycleService from '../../services/User/leadLifeCycleService';
import {
  CreateLeadLifeCycleInput,
  createLeadLifeCycleSchema,
  LeadLifeCycleIdParamInput,
  leadLifeCycleIdParamSchema,
  ListLeadLifeCyclesQuery,
  listLeadLifeCyclesQuerySchema,
  UpdateLeadLifeCycleInput,
  updateLeadLifeCycleSchema,
} from '../../validations/leadLifeCycleValidation';

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
        'Lead Life Cycle module is not ready. Required database schema is missing. Run Prisma migration/db push.',
    });
    return;
  }

  if (error?.code === 'P2002') {
    res.status(409).json({
      success: false,
      message: 'Lead life cycle name already exists in this workspace.',
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

  logger.error(`Lead life cycle error during ${action}`, { error: error?.message });
  next(error);
};

export const createLifeCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLeadLifeCycleInput>(createLeadLifeCycleSchema, req.body, res);
  if (!input) return;

  try {
    const lifeCycle = await leadLifeCycleService.createLifeCycle(workspaceId, input, req.user?.id);

    return res.status(201).json({
      success: true,
      message: 'Lead life cycle created successfully',
      data: { lifeCycle },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLifeCycle');
  }
};

export const getStageOptions = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const stages = await leadLifeCycleService.getLeadStageOptions();

    return res.status(200).json({
      success: true,
      message: 'Lead stage options fetched successfully',
      data: stages,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getStageOptions');
  }
};

export const listLifeCycles = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLeadLifeCyclesQuery>(listLeadLifeCyclesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadLifeCycleService.listLifeCycles(workspaceId, query);

    return res.status(200).json({
      success: true,
      message: 'Lead life cycles fetched successfully',
      data: { lifeCycles: result.lifeCycles },
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLifeCycles');
  }
};

export const getLifeCycleById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadLifeCycleIdParamInput>(leadLifeCycleIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const lifeCycle = await leadLifeCycleService.getLifeCycleById(params.id, workspaceId);

    return res.status(200).json({
      success: true,
      message: 'Lead life cycle fetched successfully',
      data: { lifeCycle },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLifeCycleById');
  }
};

export const updateLifeCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadLifeCycleIdParamInput>(leadLifeCycleIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateLeadLifeCycleInput>(updateLeadLifeCycleSchema, req.body, res);
  if (!input) return;

  try {
    const lifeCycle = await leadLifeCycleService.updateLifeCycle(params.id, workspaceId, input);

    return res.status(200).json({
      success: true,
      message: 'Lead life cycle updated successfully',
      data: { lifeCycle },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLifeCycle');
  }
};

export const deleteLifeCycle = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadLifeCycleIdParamInput>(leadLifeCycleIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadLifeCycleService.deleteLifeCycle(params.id, workspaceId);

    return res.status(200).json({
      success: true,
      message: 'Lead life cycle deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLifeCycle');
  }
};
