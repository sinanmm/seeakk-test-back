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
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error('[MetaOAuth] Meta returned error during authorization', { error, error_description });
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  if (!code || typeof code !== 'string') {
    logger.warn('[MetaOAuth] Missing authorization code.');
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  let workspaceId = '';
  let userId = '';

  if (!state || typeof state !== 'string') {
    logger.warn('[MetaOAuth] Missing state parameter.');
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    const stateData = decoded.data;
    const signature = decoded.hmac;

    const appSecret = process.env.META_APP_SECRET || '';
    const expectedHmac = crypto.createHmac('sha256', appSecret).update(stateData).digest('hex');

    if (signature !== expectedHmac) {
      logger.warn('[MetaOAuth] State signature mismatch.');
      return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
    }

    const parsed = JSON.parse(stateData);
    
    // Check expiry: 10 minutes (600,000 ms)
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - parsed.timestamp > tenMinutes) {
      logger.warn('[MetaOAuth] State has expired.');
      return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
    }

    workspaceId = parsed.workspaceId;
    userId = parsed.userId;
  } catch (err: any) {
    logger.error('[MetaOAuth] Failed to parse or validate state', { error: err.message });
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  if (!workspaceId) {
    logger.warn('[MetaOAuth] Invalid workspaceId in state.');
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  try {
    await metaService.handleMetaOAuthCallback(workspaceId, userId, code);
    return res.redirect(`${frontendUrl}/admin/meta-ads?connected=true`);
  } catch (err: any) {
    logger.error('[MetaOAuth] handleMetaOAuthCallback failed', { error: err.message });
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
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
