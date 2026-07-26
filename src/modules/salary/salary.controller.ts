import { Request, Response, NextFunction } from 'express';
import * as calculationService from './salaryCalculation.service';
import * as stagesService from './salaryStages.service';
import * as approvalsService from './salaryApprovals.service';
import {
  generateSalarySchema,
  updateSalaryCalculationSchema,
  createApprovalStageSchema,
  updateApprovalStageSchema,
  reorderApprovalStagesSchema,
  salaryReleaseSettingSchema,
  processApprovalSchema,
  editSalaryBeforeApprovalSchema,
} from './salary.validation';
import { getActorUserPermissions } from '../../services/User/adminUserService';
import logger from '../../utils/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: Your account is not linked to any workspace.',
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
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
};

// ─── SALARY CALCULATION ───────────────────────────────────────────────────────

export const generateSalary = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate(generateSalarySchema, req.body, res);
  if (!input) return;

  try {
    const result = await calculationService.generateSalary(input, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: `Salary calculations generated (${result.generatedCount} generated, ${result.skippedCount} skipped).`,
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'generateSalary');
  }
};

export const submitSalaryForApproval = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { salaryRecordIds } = req.body;
  if (!Array.isArray(salaryRecordIds) || salaryRecordIds.length === 0) {
    return res.status(400).json({ success: false, message: 'salaryRecordIds must be a non-empty array of IDs.' });
  }

  try {
    const result = await calculationService.submitSalaryForApproval(salaryRecordIds, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: `Submitted ${result.submittedCount} salary records for approval.`,
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'submitSalaryForApproval');
  }
};

export const listCalculations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  logger.info('Salary Calculation Request Received', {
    userId: req.user?.id,
    workspaceId,
    query: req.query,
  });

  try {
    const result = await calculationService.listSalaryCalculations(req.query as any, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Salary calculations fetched successfully.',
      data: result.data,
      meta: result.meta,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listCalculations');
  }
};

export const updateCalculation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;
  const input = validate(updateSalaryCalculationSchema, req.body, res);
  if (!input) return;

  try {
    const record = await calculationService.updateSalaryCalculation(id as string, input, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: 'Salary calculation updated successfully.',
      data: { record },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateCalculation');
  }
};

export const deleteCalculation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;

  try {
    const result = await calculationService.deleteSalaryCalculation(id as string, workspaceId);
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'deleteCalculation');
  }
};

// ─── APPROVAL STAGES ─────────────────────────────────────────────────────────

export const listStages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const data = await stagesService.listApprovalStages(workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Approval stages fetched successfully.',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listStages');
  }
};

export const createStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate(createApprovalStageSchema, req.body, res);
  if (!input) return;

  try {
    const stage = await stagesService.createApprovalStage(input, workspaceId, req.user!.id);
    return res.status(201).json({
      success: true,
      message: 'Approval stage created successfully.',
      data: { stage },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'createStage');
  }
};

export const updateStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;
  const input = validate(updateApprovalStageSchema, req.body, res);
  if (!input) return;

  try {
    const stage = await stagesService.updateApprovalStage(id as string, input, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Approval stage updated successfully.',
      data: { stage },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateStage');
  }
};

export const deleteStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;

  try {
    const result = await stagesService.deleteApprovalStage(id as string, workspaceId);
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'deleteStage');
  }
};

export const reorderStages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate(reorderApprovalStagesSchema, req.body, res);
  if (!input) return;

  try {
    const data = await stagesService.reorderApprovalStages(input, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Approval stages reordered successfully.',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'reorderStages');
  }
};

export const updateReleaseSetting = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate(salaryReleaseSettingSchema, req.body, res);
  if (!input) return;

  try {
    const setting = await stagesService.updateSalaryReleaseSetting(input, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Salary release date setting updated successfully.',
      data: { setting },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateReleaseSetting');
  }
};

// ─── PENDING APPROVALS ───────────────────────────────────────────────────────

export const listPendingApprovals = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const permissionsSet = await getActorUserPermissions(req.user);
    const permissionsArray = Array.from(permissionsSet);
    const isSuperAdmin = (req.user as any)?.role?.name?.toLowerCase().includes('super') || false;

    const result = await approvalsService.listPendingApprovals(
      req.query as any,
      workspaceId,
      req.user!.id,
      permissionsArray,
      isSuperAdmin,
    );

    return res.status(200).json({
      success: true,
      message: 'Pending salary approvals fetched successfully.',
      data: result.data,
      meta: result.meta,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listPendingApprovals');
  }
};

export const processApproval = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;
  const input = validate(processApprovalSchema, req.body, res);
  if (!input) return;

  try {
    const record = await approvalsService.processApproval(id as string, input, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: `Salary approval action '${input.action}' processed successfully.`,
      data: { record },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'processApproval');
  }
};

export const editSalaryBeforeApproval = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;
  const input = validate(editSalaryBeforeApprovalSchema, req.body, res);
  if (!input) return;

  try {
    const record = await approvalsService.editSalaryBeforeApproval(id as string, input, workspaceId, req.user!.id);
    return res.status(200).json({
      success: true,
      message: 'Salary amounts updated successfully with audit trail.',
      data: { record },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'editSalaryBeforeApproval');
  }
};

export const getHistory = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { id } = req.params;

  try {
    const data = await approvalsService.getSalaryHistory(id as string, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Salary history timeline fetched successfully.',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'getHistory');
  }
};
