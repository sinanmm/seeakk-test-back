import { Request, Response, NextFunction } from 'express';
import * as adminUserService from '../../services/User/adminUserService';
import {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
  listUsersQuerySchema,
  type CreateUserInput,
  type UpdateUserInput,
  type UpdateStatusInput,
  type ResetPasswordInput,
  type ListUsersQuery,
} from '../../validations/adminUserValidation';
import {
  createInviteSchema,
  type CreateInviteInput,
} from '../../modules/invites/invite.validation';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
import { inviteService } from '../../modules/invites/invite.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the workspaceId from the authenticated user, or short-circuit with 403.
 */
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

/**
 * Zod parse helper with typed schema.
 * Returns parsed data on success, null + 422 response on failure.
 */
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

/**
 * Map service errors (with statusCode) to proper HTTP responses.
 * Unhandled errors are forwarded to the global error middleware.
 */
const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  logger.error(`Admin user error during ${action}`, { error: error?.message });
  next(error);
};

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/users
 * Create a new user in the admin's workspace.
 */
export const createUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateUserInput>(createUserSchema, req.body, res);
  if (!input) return;

  try {
    const result = await adminUserService.createUser(input, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_CREATE_USER',
      entityType: 'User',
      entityId: (result as any).user.id,
      details: { email: input.email, name: input.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'createUser');
  }
};

/**
 * POST /api/admin/users/invite
 * Create an inactive user and send a one-time invite link.
 */
export const inviteUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateInviteInput>(createInviteSchema, req.body, res);
  if (!input) return;

  try {
    const result = await inviteService.createInvite(
      input,
      {
        id: req.user!.id,
        workspaceId,
        name: req.user?.name || null,
      },
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );

    return res.status(201).json({
      success: true,
      message: 'Invitation sent successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'inviteUser');
  }
};

/**
 * GET /api/admin/users
 * Paginated, filterable list of workspace users.
 */
export const listUsers = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListUsersQuery>(listUsersQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await adminUserService.listUsers(query, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully.',
      data: result,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listUsers');
  }
};

/**
 * GET /api/admin/users/:id
 * Fetch a single user by ID (workspace-scoped).
 */
export const getUserById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['id'] as string;

  try {
    const user = await adminUserService.getUserById(userId, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'User fetched successfully.',
      data: { user },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'getUserById');
  }
};

/**
 * PUT /api/admin/users/:id
 * Update user profile, role, department, or supervisor.
 */
export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['id'] as string;
  const input = validate<UpdateUserInput>(updateUserSchema, req.body, res);
  if (!input) return;

  try {
    const user = await adminUserService.updateUser(userId, input, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_UPDATE_USER',
      entityType: 'User',
      entityId: userId,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: { user },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateUser');
  }
};

/**
 * DELETE /api/admin/users/:id
 * Soft-delete a user (sets deletedAt, kills sessions).
 */
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['id'] as string;
  const requestingUserId = req.user!.id;

  try {
    const result = await adminUserService.deleteUser(userId, workspaceId, requestingUserId);

    await auditService.log({
      userId: requestingUserId,
      workspaceId,
      action: 'ADMIN_DELETE_USER',
      entityType: 'User',
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: null,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'deleteUser');
  }
};

/**
 * PATCH /api/admin/users/:id/status
 * Activate or deactivate a user.
 */
export const updateUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['id'] as string;
  const input = validate<UpdateStatusInput>(updateStatusSchema, req.body, res);
  if (!input) return;

  const requestingUserId = req.user!.id;

  try {
    const user = await adminUserService.updateUserStatus(userId, input, workspaceId, requestingUserId);

    await auditService.log({
      userId: requestingUserId,
      workspaceId,
      action: input.isActive ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
      entityType: 'User',
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: `User ${input.isActive ? 'activated' : 'deactivated'} successfully.`,
      data: { user },
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateUserStatus');
  }
};

/**
 * POST /api/admin/users/:id/reset-password
 * Reset a user's password and invalidate all their sessions.
 */
export const resetUserPassword = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['id'] as string;
  const input = validate<ResetPasswordInput>(resetPasswordSchema, req.body, res);
  if (!input) return;

  try {
    const result = await adminUserService.resetUserPassword(userId, input, workspaceId);

    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'ADMIN_RESET_PASSWORD',
      entityType: 'User',
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: 'generatedPassword' in result ? { generatedPassword: result.generatedPassword } : null,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'resetUserPassword');
  }
};
