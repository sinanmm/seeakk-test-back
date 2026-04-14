import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import * as stageRuleService from './stageRule.service';
import {
  CreateStageRuleInput,
  createStageRuleSchema,
  ListStageRulesQuery,
  listStageRulesQuerySchema,
  UpdateStageRuleInput,
  updateStageRuleSchema,
} from './stageRule.validator';

const isStageRuleDebugEnabled = process.env.DEBUG_STAGE_RULES === 'true';
const isStageRuleConsoleDebugEnabled = process.env.DEBUG_STAGE_RULES_CONSOLE === 'true';

const pickStageRulePayload = (payload: unknown): Record<string, unknown> | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const source = payload as Record<string, unknown>;
  return {
    name: source.name,
    inputType: source.inputType,
    sortOrder: source.sortOrder,
    required: source.required,
    status: source.status,
    stageId: source.stageId,
  };
};

const debugStageRuleRequest = (
  action: string,
  req: Request,
  details?: Record<string, unknown>,
): void => {
  if (!isStageRuleDebugEnabled) return;

  const payload = {
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    query: req.query,
    params: req.params,
    body: pickStageRulePayload(req.body),
    ...details,
  };

  logger.debug(`[StageRule][${action}] incoming request`, payload);
  if (isStageRuleConsoleDebugEnabled) {
    console.log(`[StageRule][${action}]`, JSON.stringify(payload, null, 2));
  }
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
  if (isStageRuleDebugEnabled) {
    const errorPayload = {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      statusCode: error?.statusCode,
    };
    logger.error(`[StageRule][${action}] service error`, errorPayload);
    if (isStageRuleConsoleDebugEnabled) {
      console.error(`[StageRule][${action}] ERROR`, JSON.stringify(errorPayload, null, 2));
    }
  }

  const rawMessage = String(error?.message || '');
  const isStalePrismaClientError =
    rawMessage.includes('Unknown argument `sortOrder`') ||
    rawMessage.includes('Unknown arg `sortOrder`') ||
    (rawMessage.includes('stageRule') &&
      (rawMessage.includes('Unknown argument') || rawMessage.includes('Unknown arg')));

  if (isStalePrismaClientError) {
    res.status(503).json({
      success: false,
      message:
        'Prisma client is out of sync with the schema for Stage Rules. Run: npx prisma migrate dev (or prisma db push) and npx prisma generate, then restart backend.',
    });
    return;
  }

  if (error?.code === 'P2021') {
    res.status(503).json({
      success: false,
      message: 'Stage Rules module is not ready. Database table "stage_rules" is missing. Run Prisma migration/db push.',
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

  logger.error(`Stage rule error during ${action}`, { error: error?.message });
  next(error);
};

const getWorkspaceId = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Workspace context is required.',
    });
    return null;
  }

  return workspaceId;
};

export const createStageRule = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  debugStageRuleRequest('create.beforeValidation', req);
  const input = validate<CreateStageRuleInput>(createStageRuleSchema, req.body, res);
  if (!input) {
    debugStageRuleRequest('create.validationFailed', req);
    return;
  }
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;
  debugStageRuleRequest('create.afterValidation', req, { input });

  try {
    const data = await stageRuleService.createStageRule(workspaceId, input, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_CREATE_STAGE_RULE',
      entityType: 'StageRule',
      entityId: data.id,
      details: { name: data.name, sortOrder: data.sortOrder, status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Stage rule created successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createStageRule');
  }
};

export const listStageRules = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  debugStageRuleRequest('list.beforeValidation', req);
  const query = validate<ListStageRulesQuery>(listStageRulesQuerySchema, req.query, res);
  if (!query) {
    debugStageRuleRequest('list.validationFailed', req);
    return;
  }
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;
  debugStageRuleRequest('list.afterValidation', req, { query });

  try {
    const result = await stageRuleService.listStageRules(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Stage rules fetched successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listStageRules');
  }
};

export const getActiveStageRules = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const data = await stageRuleService.getActiveStageRules(workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Active stage rules fetched successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getActiveStageRules');
  }
};

export const updateStageRule = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;
  debugStageRuleRequest('update.beforeValidation', req, { id });
  const input = validate<UpdateStageRuleInput>(updateStageRuleSchema, req.body, res);
  if (!input) {
    debugStageRuleRequest('update.validationFailed', req, { id });
    return;
  }
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;
  debugStageRuleRequest('update.afterValidation', req, { id, input });

  try {
    const data = await stageRuleService.updateStageRule(workspaceId, id, input);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_UPDATE_STAGE_RULE',
      entityType: 'StageRule',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Stage rule updated successfully',
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateStageRule');
  }
};

export const deleteStageRule = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    await stageRuleService.deleteStageRule(workspaceId, id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'MASTER_DELETE_STAGE_RULE',
      entityType: 'StageRule',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Stage rule deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteStageRule');
  }
};
