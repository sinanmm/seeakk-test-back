import { Request, Response } from 'express';
import logger from '../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import * as customPipelineService from './customPipeline.service';
import {
  createSectionSchema,
  updateSectionSchema,
  reorderSectionsSchema,
  createPipelineSchema,
  updatePipelineSchema,
  reorderPipelinesSchema,
  previewPipelineSchema,
  CreateSectionInput,
  UpdateSectionInput,
  CreatePipelineInput,
  UpdatePipelineInput,
  PreviewPipelineInput,
} from './customPipeline.validation';

const requireWorkspace = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Not authorized' });
    return null;
  }

  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }

  return workspaceId;
};

const getActor = (req: Request): customPipelineService.RequestActor => {
  const user = req.user as any;
  return {
    id: user.id,
    roleId: user.roleId || undefined,
    role: user.role ? { name: user.role.name } : undefined,
    officeId: user.officeId || undefined,
    departmentId: user.departmentId || undefined,
    isSuperAdmin: Boolean(user.isSuperAdmin || user.role?.name === 'SUPER_ADMIN'),
  };
};

const validate = <T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null => {
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
};

export const getSections = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const sections = await customPipelineService.getPipelineSections(workspaceId, actor);
    res.json({ success: true, data: sections });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch pipeline sections' });
  }
};

export const createSection = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const body = validate<CreateSectionInput>(createSectionSchema, req.body, res);
    if (!body) return;
    const section = await customPipelineService.createPipelineSection(workspaceId, actor, body);
    res.status(201).json({ success: true, data: section });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to create section' });
  }
};

export const updateSection = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const sectionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = validate<UpdateSectionInput>(updateSectionSchema, req.body, res);
    if (!body) return;
    const updated = await customPipelineService.updatePipelineSection(workspaceId, sectionId, actor, body);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to update section' });
  }
};

export const deleteSection = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const sectionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const movePipelinesToSectionId = typeof req.query.movePipelinesToSectionId === 'string' ? req.query.movePipelinesToSectionId : undefined;
    const result = await customPipelineService.deletePipelineSection(workspaceId, sectionId, actor, movePipelinesToSectionId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to delete section' });
  }
};

export const reorderSections = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const body = validate<{ sections: Array<{ id: string; sortOrder: number }> }>(
      reorderSectionsSchema,
      req.body,
      res,
    );
    if (!body) return;
    const result = await customPipelineService.reorderPipelineSections(workspaceId, body.sections);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to reorder sections' });
  }
};

export const createPipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const body = validate<CreatePipelineInput>(createPipelineSchema, req.body, res);
    if (!body) return;
    const pipeline = await customPipelineService.createPipeline(workspaceId, actor, body);
    res.status(201).json({ success: true, data: pipeline });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to create pipeline' });
  }
};

export const updatePipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const pipelineId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const body = validate<UpdatePipelineInput>(updatePipelineSchema, req.body, res);
    if (!body) return;
    const updated = await customPipelineService.updatePipeline(workspaceId, pipelineId, actor, body);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to update pipeline' });
  }
};

export const deletePipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const pipelineId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await customPipelineService.deletePipeline(workspaceId, pipelineId, actor);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to delete pipeline' });
  }
};

export const duplicatePipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const pipelineId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const duplicated = await customPipelineService.duplicatePipeline(workspaceId, pipelineId, actor);
    res.status(201).json({ success: true, data: duplicated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to duplicate pipeline' });
  }
};

export const previewPipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const body = validate<PreviewPipelineInput>(previewPipelineSchema, req.body, res);
    if (!body) return;
    const preview = await customPipelineService.previewPipeline(workspaceId, actor, body);
    res.json({ success: true, data: preview });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to preview pipeline' });
  }
};

export const getPipelineResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = await requireWorkspace(req, res);
    if (!workspaceId) return;
    const actor = getActor(req);
    const pipelineId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const results = await customPipelineService.getPipelineResults(workspaceId, pipelineId, actor, page, limit);
    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to fetch pipeline results' });
  }
};
