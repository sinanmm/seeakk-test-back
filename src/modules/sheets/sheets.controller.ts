import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import logger from '../../utils/logger';
import * as sheetsService from './sheets.service';
import {
  createFromLeadExportSchema,
  createSheetSchema,
  duplicateSheetSchema,
  listSheetsQuerySchema,
  sheetRowsQuerySchema,
  syncSheetSchema,
  updateSheetSchema,
} from './sheets.validation';

const requireWorkspace = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return null;
  }
  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: Your account is not linked to any workspace.',
    });
    return null;
  }
  return workspaceId;
};

const validate = <T>(
  schema: { parse: (data: unknown) => T },
  data: unknown,
  res: Response,
): T | null => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: error.flatten().fieldErrors,
      });
      return null;
    }
    throw error;
  }
};

const handleError = (error: any, res: Response, next: NextFunction, action: string) => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  logger.error(`Sheets error during ${action}`, { message: error?.message, stack: error?.stack });
  next(error);
};

const actorFromRequest = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role ? { name: req.user.role.name } : null,
});

export const listSheets = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const query = validate(listSheetsQuerySchema, req.query, res);
  if (!query) return;
  try {
    const result = await sheetsService.listSheets(workspaceId, query);
    res.status(200).json({ success: true, message: 'Sheets fetched successfully.', ...result });
  } catch (error) {
    handleError(error, res, next, 'listSheets');
  }
};

export const createSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const input = validate(createSheetSchema, req.body, res);
  if (!input) return;
  try {
    const data = await sheetsService.createSheet(workspaceId, req.user?.id, input);
    res.status(201).json({ success: true, message: 'Sheet created successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'createSheet');
  }
};

export const createFromLeadExport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const input = validate(createFromLeadExportSchema, req.body, res);
  if (!input) return;
  try {
    const data = await sheetsService.createFromLeadExport(workspaceId, actorFromRequest(req), input);
    res.status(201).json({ success: true, message: 'Lead export imported to Sheets.', data });
  } catch (error) {
    handleError(error, res, next, 'createFromLeadExport');
  }
};

export const importFile = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  if (!req.file) {
    res.status(422).json({ success: false, message: 'Upload a CSV, XLS, or XLSX file.' });
    return;
  }
  try {
    const data = await sheetsService.importFile(workspaceId, req.user?.id, req.file, req.body?.name);
    res.status(201).json({ success: true, message: 'File imported successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'importFile');
  }
};

export const getSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const sheetId = String(req.params.id);
  try {
    const data = await sheetsService.getSheet(workspaceId, sheetId);
    res.status(200).json({ success: true, message: 'Sheet fetched successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'getSheet');
  }
};

export const getSheetRows = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const query = validate(sheetRowsQuerySchema, req.query, res);
  if (!query) return;
  const sheetId = String(req.params.id);
  try {
    const data = await sheetsService.getSheetRows(workspaceId, sheetId, query);
    res.status(200).json({ success: true, message: 'Sheet rows fetched successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'getSheetRows');
  }
};

export const updateSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const input = validate(updateSheetSchema, req.body, res);
  if (!input) return;
  const sheetId = String(req.params.id);
  try {
    const data = await sheetsService.updateSheet(workspaceId, req.user?.id, sheetId, input);
    res.status(200).json({ success: true, message: 'Sheet saved successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'updateSheet');
  }
};

export const duplicateSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const input = validate(duplicateSheetSchema, req.body, res);
  if (!input) return;
  const sheetId = String(req.params.id);
  try {
    const data = await sheetsService.duplicateSheet(workspaceId, req.user?.id, sheetId, input);
    res.status(201).json({ success: true, message: 'Sheet duplicated successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'duplicateSheet');
  }
};

export const deleteSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const sheetId = String(req.params.id);
  try {
    await sheetsService.deleteSheet(workspaceId, sheetId);
    res.status(200).json({ success: true, message: 'Sheet deleted successfully.' });
  } catch (error) {
    handleError(error, res, next, 'deleteSheet');
  }
};

export const listVersions = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const sheetId = String(req.params.id);
  try {
    const data = await sheetsService.listVersions(workspaceId, sheetId);
    res.status(200).json({ success: true, message: 'Sheet versions fetched successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'listVersions');
  }
};

export const restoreVersion = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const sheetId = String(req.params.id);
  const versionId = String(req.params.versionId);
  try {
    const data = await sheetsService.restoreVersion(workspaceId, req.user?.id, sheetId, versionId);
    res.status(200).json({ success: true, message: 'Sheet version restored successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'restoreVersion');
  }
};

export const exportSheet = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const sheetId = String(req.params.id);
  try {
    const exported = await sheetsService.exportSheet(workspaceId, sheetId, format);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.status(200).send(exported.content);
  } catch (error) {
    handleError(error, res, next, 'exportSheet');
  }
};

export const syncLeadChanges = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = await requireWorkspace(req, res);
  if (!workspaceId) return;
  const input = validate(syncSheetSchema, req.body, res);
  if (!input) return;

  if (!input.changes || !Array.isArray(input.changes) || input.changes.length === 0) {
    res.status(200).json({
      success: true,
      message: 'No changes to sync.',
      updated: 0,
      failed: 0,
    });
    return;
  }

  try {
    const actor = actorFromRequest(req);
    logger.info('[Sync Lead Started]', {
      sheetId: req.params.id,
      userId: actor.id,
      workspaceId,
      changesCount: input.changes.length,
      changes: input.changes.map((c) => ({
        rowId: c.rowId,
        leadId: c.leadId,
        fieldKey: c.fieldKey,
        oldValue: c.oldValue,
        newValue: c.newValue,
      })),
    });

    const data = await sheetsService.syncLeadChanges(workspaceId, actor, input);
    logger.info('[Sync Lead Completed]', {
      sheetId: req.params.id,
      appliedCount: data.applied?.length || 0,
      pendingCount: data.pending?.length || 0,
      blockedCount: data.blocked?.length || 0,
    });
    res.status(200).json({ success: true, message: 'Sheet lead sync completed successfully.', data });
  } catch (error: any) {
    logger.error('[Sync Lead Diagnostic] Controller error during syncLeadChanges', {
      file: 'sheets.controller.ts',
      function: 'syncLeadChanges',
      sheetId: req.params.id,
      error: error?.message,
      stack: error?.stack,
    });
    handleError(error, res, next, 'syncLeadChanges');
  }
};
