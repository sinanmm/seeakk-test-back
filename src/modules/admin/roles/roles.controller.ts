import { Request, Response, NextFunction } from 'express';
import * as rolesService from './roles.service';
import {
  createRoleSchema,
  updateRoleSchema,
  listRolesQuerySchema,
  CreateRoleInput,
  UpdateRoleInput,
  ListRolesQuery,
} from './roles.validator';
import logger from '../../../utils/logger';
import auditService from '../../../services/Audit/auditService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      code: error.code,
      details: error.details,
    });
    return;
  }
  logger.error(`Roles error during ${action}`, { error: error?.message });
  next(error);
};

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/roles
 */
export const createRole = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<CreateRoleInput>(createRoleSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    }
    const result = await rolesService.createRole(input, req.user!.id, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'ADMIN_CREATE_ROLE',
      entityType: 'Role',
      entityId: result.id,
      details: { name: input.name, permissions: input.permissions },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Role created successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'createRole');
  }
};

/**
 * GET /api/admin/roles
 */
export const listRoles = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const query = validate<ListRolesQuery>(listRolesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    }
    const result = await rolesService.listRoles(query, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Roles fetched successfully.',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listRoles');
  }
};

/**
 * GET /api/admin/roles/:id
 */
export const getRoleById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    }
    const result = await rolesService.getRoleById(id, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Role fetched successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'getRoleById');
  }
};

/**
 * PUT /api/admin/roles/:id
 */
export const updateRole = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;
  const input = validate<UpdateRoleInput>(updateRoleSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    }
    const result = await rolesService.updateRole(id, input, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'ADMIN_UPDATE_ROLE',
      entityType: 'Role',
      entityId: id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Role updated successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateRole');
  }
};

/**
 * GET /api/admin/roles/meta/permissions
 */
export const listPermissions = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const result = await rolesService.listPermissions();
    return res.status(200).json({
      success: true,
      message: 'Permissions fetched successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listPermissions');
  }
};

/**
 * DELETE /api/admin/roles/:id
 */
export const deleteRole = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const id = req.params['id'] as string;

  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    }
    await rolesService.deleteRole(id, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId: req.user?.workspaceId || undefined,
      action: 'ADMIN_DELETE_ROLE',
      entityType: 'Role',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Role deleted successfully.',
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'deleteRole');
  }
};
