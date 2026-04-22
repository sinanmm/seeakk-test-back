import { Request, Response, NextFunction } from 'express';
import * as departmentsService from './departments.service';
import { 
  createDepartmentSchema, 
  updateDepartmentSchema, 
  listDepartmentsQuerySchema,
  CreateDepartmentInput,
  UpdateDepartmentInput,
  ListDepartmentsQuery
} from './departments.validator';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';

/**
 * Controller to handle department requests
 */

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
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  logger.error(`Department error during ${action}`, { error: error?.message });
  next(error);
};

export const createDepartment = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateDepartmentInput>(createDepartmentSchema, req.body, res);
  if (!input) return;

  try {
    const result = await departmentsService.createDepartment(workspaceId, input);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_CREATE_DEPARTMENT',
      entityType: 'Department',
      entityId: result.id,
      details: { name: input.name },
      ipAddress: req.ip as string,
      userAgent: req.headers['user-agent'] as string,
    });

    return res.status(201).json({
      success: true,
      message: 'Department created successfully.',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createDepartment');
  }
};

export const listDepartments = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListDepartmentsQuery>(listDepartmentsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await departmentsService.listDepartments(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Departments fetched successfully.',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listDepartments');
  }
};

export const getActiveDepartments = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const result = await departmentsService.getActiveDepartments(workspaceId);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getActiveDepartments');
  }
};

export const updateDepartment = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params.id as string;
  const input = validate<UpdateDepartmentInput>(updateDepartmentSchema, req.body, res);
  if (!input) return;

  try {
    const result = await departmentsService.updateDepartment(id, workspaceId, input);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_UPDATE_DEPARTMENT',
      entityType: 'Department',
      entityId: result.id,
      details: { name: input.name, status: input.status },
      ipAddress: req.ip as string,
      userAgent: req.headers['user-agent'] as string,
    });

    return res.status(200).json({
      success: true,
      message: 'Department updated successfully.',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateDepartment');
  }
};

export const deleteDepartment = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params.id as string;

  try {
    await departmentsService.deleteDepartment(id, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_DELETE_DEPARTMENT',
      entityType: 'Department',
      entityId: id,
      ipAddress: req.ip as string,
      userAgent: req.headers['user-agent'] as string,
    });

    return res.status(200).json({
      success: true,
      message: 'Department deleted successfully.',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteDepartment');
  }
};
