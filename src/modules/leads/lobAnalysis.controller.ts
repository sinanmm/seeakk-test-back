import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import * as lobAnalysisService from './lobAnalysis.service';
import type { LOBAnalysisAuditQueryInput, LOBAnalysisQueryInput } from './lobAnalysis.validation';
import { lobAnalysisAuditQuerySchema, lobAnalysisQuerySchema } from './lobAnalysis.validation';

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
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`LOB analysis error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const getLOBAnalysisSummary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<LOBAnalysisQueryInput>(lobAnalysisQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await lobAnalysisService.getSummary(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLOBAnalysisSummary');
  }
};

export const getLOBStageBreakdown = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<LOBAnalysisQueryInput>(lobAnalysisQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await lobAnalysisService.getStageBreakdown(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLOBStageBreakdown');
  }
};

export const getLOBAuditTrail = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<LOBAnalysisAuditQueryInput>(lobAnalysisAuditQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await lobAnalysisService.getAuditTrail(workspaceId, getActor(req), query);
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLOBAuditTrail');
  }
};
