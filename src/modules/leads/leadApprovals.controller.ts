import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as leadApprovalService from './leadApprovals.service';
import type {
  CreateLeadApprovalInput,
  HandleLeadApprovalInput,
  LeadApprovalIdParamInput,
  ListLeadApprovalsQueryInput,
} from './leadApprovals.validation';
import {
  createLeadApprovalSchema,
  handleLeadApprovalSchema,
  leadApprovalIdParamSchema,
  listLeadApprovalsQuerySchema,
} from './leadApprovals.validation';

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
      message: 'Lead approval module is not ready. Required database schema is missing. Run Prisma migration/db push.',
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

  logger.error(`Lead approval error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createLeadApproval = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLeadApprovalInput>(createLeadApprovalSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadApprovalService.createLeadApproval(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Approval requested successfully',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLeadApproval');
  }
};

export const listLeadApprovals = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLeadApprovalsQueryInput>(listLeadApprovalsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadApprovalService.listApprovals(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Lead approvals fetched successfully',
      data: result.approvals,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadApprovals');
  }
};

export const handleLeadApproval = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadApprovalIdParamInput>(leadApprovalIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<HandleLeadApprovalInput>(handleLeadApprovalSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadApprovalService.processLeadApproval(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'handleLeadApproval');
  }
};
