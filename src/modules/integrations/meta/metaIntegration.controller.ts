import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../../../utils/logger';
import * as metaService from './metaIntegration.service';

const getWorkspaceId = (req: Request): string => {
  const workspaceId = (req as any).workspaceId || (req as any).user?.workspaceId;
  if (!workspaceId) {
    const error: any = new Error('Workspace identifier is required.');
    error.statusCode = 403;
    throw error;
  }
  return workspaceId;
};

export const getAuthUrl = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || 'system';
    const url = metaService.getMetaAuthUrl(workspaceId, userId);
    return res.json({ success: true, data: { url } });
  } catch (error) {
    next(error);
  }
};

export const handleCallback = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'Missing authorization code.' } });
    }

    let workspaceId = (req as any).workspaceId || (req as any).user?.workspaceId;
    let userId = (req as any).user?.id || 'system';

    if (state && typeof state === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        const parsed = JSON.parse(decoded.data);
        if (parsed.workspaceId) workspaceId = parsed.workspaceId;
        if (parsed.userId) userId = parsed.userId;
      } catch (err) {}
    }

    if (!workspaceId) {
      return res.status(403).json({ success: false, error: { message: 'Invalid state context.' } });
    }

    await metaService.handleMetaOAuthCallback(workspaceId, userId, code);

    // Redirect to frontend Settings -> Meta Ads page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/admin/meta-ads?connected=true`);
  } catch (error) {
    next(error);
  }
};

export const getStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getMetaStatus(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getPagesAndForms = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getPagesAndForms(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const saveFormConfig = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const formId = Array.isArray(req.params.formId) ? req.params.formId[0] : String(req.params.formId || '');
    const data = await metaService.saveFormConfig(workspaceId, formId, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const verifyWebhook = (req: Request, res: Response): any => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');

  logger.info('[MetaWebhook] meta.webhook.verification.received', {
    mode,
    hasToken: !!token,
    challenge,
  });

  try {
    const result = metaService.handleWebhookVerification(mode, token, challenge);
    logger.info('[MetaWebhook] meta.webhook.verification.success');
    return res.status(200).set('Content-Type', 'text/plain').send(result);
  } catch (error: any) {
    logger.error('[MetaWebhook] meta.webhook.verification.failed', { error: error.message });
    return res.status(403).set('Content-Type', 'text/plain').send(error?.message || 'Verification failed');
  }
};

export const handleWebhookEvent = async (req: Request, res: Response): Promise<any> => {
  const rawBody = (req as any).rawBody;
  const signatureHeader = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
  const appSecret = process.env.META_APP_SECRET || '';

  logger.info('[MetaWebhook] meta.webhook.received', {
    method: req.method,
    url: req.originalUrl,
    hasSignature: !!signatureHeader,
  });

  if (signatureHeader && rawBody) {
    try {
      const parts = String(signatureHeader).split('=');
      if (parts.length === 2) {
        const algorithm = parts[0]; // e.g. 'sha256' or 'sha1'
        const signature = parts[1];

        const hmac = crypto.createHmac(algorithm, appSecret);
        hmac.update(rawBody);
        const expectedSignature = hmac.digest('hex');

        const signatureBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
          logger.info('[MetaWebhook] meta.webhook.signature.valid');
        } else {
          logger.warn('[MetaWebhook] meta.webhook.signature.invalid');
          return res.status(401).send('Invalid signature');
        }
      } else {
        logger.warn('[MetaWebhook] meta.webhook.signature.invalid');
        return res.status(401).send('Invalid signature format');
      }
    } catch (e: any) {
      logger.error('[MetaWebhook] Signature verification error', { error: e.message });
      return res.status(401).send('Signature verification failed');
    }
  } else {
    logger.warn('[MetaWebhook] meta.webhook.signature.invalid - Missing signature or rawBody');
    return res.status(401).send('Missing signature or payload');
  }

  try {
    // Process asynchronously in background
    void metaService.processLeadGenWebhook(req.body).catch((err) => {
      logger.error('[MetaWebhook] meta.webhook.failed', { error: err?.message });
    });
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    return res.status(200).send('EVENT_RECEIVED');
  }
};

export const getSyncActivity = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getSyncActivity(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const retryFailedImport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const importId = Array.isArray(req.params.importId) ? req.params.importId[0] : String(req.params.importId || '');
    const data = await metaService.retryFailedImport(workspaceId, importId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const disconnectMeta = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.disconnectMeta(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const handleDataDeletionCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const signedRequest = req.body?.signed_request || req.body?.signedRequest;
    if (!signedRequest || typeof signedRequest !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'Missing signed_request parameter.' } });
    }

    const result = await metaService.processMetaSignedDataDeletion(signedRequest);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ success: false, error: { message: error?.message || 'Invalid signed request verification failed.' } });
  }
};
