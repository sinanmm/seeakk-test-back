import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import * as service from './callTracking.service';
import { initiateCallSchema, saveCallOutcomeSchema } from './callTracking.validation';
import { emitWorkspaceEvent } from '../../realtime/socket';

const getWorkspaceId = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked to your account' });
    return null;
  }
  return workspaceId;
};

const validate = <T>(schema: any, data: unknown, res: Response): T | null => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const firstMsg = (Object.values(fieldErrors).flat()[0] as string) || 'Validation failed';
    res.status(422).json({ success: false, message: firstMsg, errors: fieldErrors });
    return null;
  }
  return result.data as T;
};

export const initiateCall = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(initiateCallSchema, req.body, res);
  if (!input) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const result = await service.initiateCallSession(workspaceId, leadId, req.user!.id, input);
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getActiveCallSession = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const session = await service.getActiveCallSession(workspaceId, leadId, req.user!.id);
    return res.status(200).json({ success: true, session });
  } catch (error) {
    next(error);
  }
};

export const saveCallOutcome = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const input = validate<any>(saveCallOutcomeSchema, req.body, res);
  if (!input) return;

  try {
    const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
    const result = await service.saveCallOutcome(workspaceId, leadId, req.user!.id, input);

    emitWorkspaceEvent(workspaceId, 'lead_updated', {
      leadId,
      action: 'call_outcome_saved',
      isStageChanged: result.isStageChanged,
      isApprovalTriggered: result.isApprovalTriggered,
      stageId: (result as any).lead?.stageId,
      substageId: (result as any).lead?.substageId,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[saveCallOutcome Error]:', error);
    const statusCode = error?.statusCode || 400;
    let message = error?.message || 'Failed to save call outcome. Please try again.';

    if (error?.name?.includes('Prisma') || message.includes('prisma') || message.includes('Unknown argument')) {
      message = 'Unable to update lead stage. Please try again.';
    }

    return res.status(statusCode).json({ success: false, message });
  }
};

const callRecordingMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

export const uploadCallRecordingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  callRecordingMulter.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: 'File size exceeds maximum allowed limit of 50MB.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid file upload.',
      });
    }
    next();
  });
};

export const uploadCallRecording = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = getWorkspaceId(req, res);
  if (!workspaceId) return;

  const leadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'Recording audio file is required.',
    });
  }

  try {
    const rawDuration = req.body?.duration ?? req.body?.recordingDuration;
    const duration =
      rawDuration !== undefined && rawDuration !== null && rawDuration !== ''
        ? Number(rawDuration)
        : null;

    const result = await service.uploadCallRecording({
      workspaceId,
      leadId,
      userId: req.user!.id,
      callSessionId: req.body?.callSessionId || null,
      duration: isNaN(duration as number) ? null : duration,
      fileName: req.body?.fileName || file.originalname,
      mimeType: req.body?.mimeType || file.mimetype,
      direction: req.body?.direction || null,
      file,
    });

    emitWorkspaceEvent(workspaceId, 'lead_updated', {
      leadId,
      action: 'recording_available',
      callSessionId: result.data?.callSessionId,
      recordingUrl: result.url,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error?.message || 'Failed to upload call recording.',
    });
  }
};

