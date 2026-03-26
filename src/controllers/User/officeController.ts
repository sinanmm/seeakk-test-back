import { Request, Response, NextFunction } from 'express';
import * as officeService from '../../services/User/officeService';
import logger from '../../utils/logger';
import {
  createOfficeSchema,
  listOfficesQuerySchema,
  officeIdParamSchema,
  toggleOfficeStatusSchema,
  type CreateOfficeInput,
  type ListOfficesQuery,
  type OfficeIdParamInput,
  type ToggleOfficeStatusInput,
  type UpdateOfficeInput,
  updateOfficeSchema,
} from '../../validations/officeValidation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
    return null;
  }
  return workspaceId;
};

const handleServiceError = (error: any, res: Response, next: NextFunction) => {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  logger.error('Office controller error', { error: error?.message });
  next(error);
};

export const listOffices = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const query = listOfficesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: query.error.flatten().fieldErrors,
      });
    }

    const result = await officeService.listOffices(workspaceId, query.data as ListOfficesQuery);
    res.status(200).json({
      success: true,
      message: 'Offices fetched successfully',
      data: {
        offices: result.offices,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const createOffice = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const input = createOfficeSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: input.error.flatten().fieldErrors,
      });
    }

    const office = await officeService.createOffice(workspaceId, input.data as CreateOfficeInput, req.user?.id);
    res.status(201).json({
      success: true,
      message: 'Office created successfully',
      data: { office },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const getOfficeById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const params = officeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: params.error.flatten().fieldErrors,
      });
    }

    const office = await officeService.getOfficeById((params.data as OfficeIdParamInput).id, workspaceId);
    res.status(200).json({
      success: true,
      message: 'Office fetched successfully',
      data: { office },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const updateOffice = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const params = officeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: params.error.flatten().fieldErrors,
      });
    }

    const input = updateOfficeSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: input.error.flatten().fieldErrors,
      });
    }

    const office = await officeService.updateOffice(
      (params.data as OfficeIdParamInput).id,
      workspaceId,
      input.data as UpdateOfficeInput,
    );

    res.status(200).json({
      success: true,
      message: 'Office updated successfully',
      data: { office },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const deleteOffice = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const params = officeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: params.error.flatten().fieldErrors,
      });
    }

    await officeService.deleteOffice((params.data as OfficeIdParamInput).id, workspaceId);

    res.status(200).json({
      success: true,
      message: 'Office deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};

export const toggleOfficeStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  try {
    const params = officeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: params.error.flatten().fieldErrors,
      });
    }

    const input = toggleOfficeStatusSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: input.error.flatten().fieldErrors,
      });
    }

    const office = await officeService.toggleOfficeStatus(
      (params.data as OfficeIdParamInput).id,
      workspaceId,
      input.data as ToggleOfficeStatusInput,
    );

    res.status(200).json({
      success: true,
      message: 'Office status updated successfully',
      data: { office },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
};
