import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import * as rosterService from './roster.service';
import {
  bulkAssignDepartmentSchema,
  createRosterEntrySchema,
  listRosterUsersQuerySchema,
  updateRosterEntrySchema,
  type BulkAssignDepartmentInput,
  type CreateRosterEntryInput,
  type ListRosterUsersQuery,
  type UpdateRosterEntryInput,
} from './roster.validator';

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
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }
  logger.error(`Roster error during ${action}`, { error: error?.message });
  next(error);
};

export const createRosterEntry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateRosterEntryInput>(createRosterEntrySchema, req.body, res);
  if (!input) return;

  try {
    const data = await rosterService.createRosterEntry(input, workspaceId, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'ADMIN_CREATE_ROSTER_ENTRY',
      entityType: 'RosterEntry',
      entityId: data.id,
      details: { userId: data.userId, rosterType: data.rosterType, startDate: data.startDate },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Roster created successfully',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'createRosterEntry');
  }
};

export const listRosterUsers = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListRosterUsersQuery>(listRosterUsersQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await rosterService.listRosterUsers(query, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Roster users fetched successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'listRosterUsers');
  }
};

export const getUserRosterEntries = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const userId = req.params['userId'] as string;
  try {
    const data = await rosterService.getUserRosterEntries(userId, workspaceId);
    return res.status(200).json({
      success: true,
      message: 'Roster entries fetched successfully',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'getUserRosterEntries');
  }
};

export const updateRosterEntry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;
  const input = validate<UpdateRosterEntryInput>(updateRosterEntrySchema, req.body, res);
  if (!input) return;

  try {
    const data = await rosterService.updateRosterEntry(id, input, workspaceId);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'ADMIN_UPDATE_ROSTER_ENTRY',
      entityType: 'RosterEntry',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Roster updated successfully',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'updateRosterEntry');
  }
};

export const deleteRosterEntry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const id = req.params['id'] as string;
  try {
    await rosterService.deleteRosterEntry(id, workspaceId);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'ADMIN_DELETE_ROSTER_ENTRY',
      entityType: 'RosterEntry',
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Roster deleted successfully',
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'deleteRosterEntry');
  }
};

export const bulkAssignDepartment = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<BulkAssignDepartmentInput>(bulkAssignDepartmentSchema, req.body, res);
  if (!input) return;

  try {
    const data = await rosterService.bulkAssignDepartment(input, workspaceId, req.user?.id);

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'ADMIN_BULK_ASSIGN_ROSTER',
      entityType: 'RosterEntry',
      details: {
        departmentId: input.departmentId,
        rosterType: input.rosterType,
        createdCount: data.createdCount,
        skippedCount: data.skippedCount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Roster assigned to department successfully',
      data,
    });
  } catch (error: any) {
    handleServiceError(error, res, next, 'bulkAssignDepartment');
  }
};
