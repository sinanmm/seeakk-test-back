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

// -----------------------------------------------------------------------------
// 1. OAUTH ENDPOINTS
// -----------------------------------------------------------------------------

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

export const handleCallback = async (req: Request, res: Response): Promise<any> => {
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
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - parsed.timestamp > tenMinutes) {
      logger.warn('[MetaOAuth] State has expired.');
      return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
    }

    workspaceId = parsed.workspaceId;
    userId = parsed.userId;
  } catch (err: any) {
    logger.error('[MetaOAuth] Failed to parse state', { error: err.message });
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }

  try {
    await metaService.handleMetaOAuthCallback(workspaceId, userId, code);
    return res.redirect(`${frontendUrl}/admin/meta-ads?connected=true`);
  } catch (err: any) {
    logger.error('[MetaOAuth] Callback processing failed', { error: err.message });
    return res.redirect(`${frontendUrl}/admin/meta-ads?meta_connection=failed`);
  }
};

// -----------------------------------------------------------------------------
// 2. CONNECTIONS ENDPOINTS
// -----------------------------------------------------------------------------

export const getConnections = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getMetaConnections(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const disconnectConnection = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const connectionId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.disconnectMetaConnection(workspaceId, connectionId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 3. PAGES & FORMS DISCOVERY ENDPOINTS
// -----------------------------------------------------------------------------

export const getPages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const connectionId = Array.isArray(req.params.connectionId)
      ? req.params.connectionId[0]
      : String(req.params.connectionId || '');
    const forceRefresh = req.query.refresh === 'true';

    const data = await metaService.getPagesForConnection(workspaceId, connectionId, forceRefresh);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getForms = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const pageId = Array.isArray(req.params.pageId) ? req.params.pageId[0] : String(req.params.pageId || '');
    const forceRefresh = req.query.refresh === 'true';

    const data = await metaService.getFormsForPage(workspaceId, pageId, forceRefresh);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getFormFields = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const pageId = Array.isArray(req.params.pageId) ? req.params.pageId[0] : String(req.params.pageId || '');
    const formId = Array.isArray(req.params.formId) ? req.params.formId[0] : String(req.params.formId || '');

    const data = await metaService.getFormFields(workspaceId, pageId, formId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 4. AUTOMATIONS ENDPOINTS
// -----------------------------------------------------------------------------

export const getAutomations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getAutomations(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getAutomationById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.getAutomationById(workspaceId, id);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || 'system';
    const data = await metaService.createAutomation(workspaceId, userId, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const updateAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.updateAutomation(workspaceId, id, req.body);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const deleteAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.deleteAutomation(workspaceId, id);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const duplicateAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const userId = (req as any).user?.id || 'system';
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.duplicateAutomation(workspaceId, userId, id);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const toggleAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const isActive = Boolean(req.body.isActive);
    const data = await metaService.toggleAutomationStatus(workspaceId, id, isActive);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const testAutomation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const data = await metaService.testAutomation(workspaceId, id);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getAutomationLogs = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const data = await metaService.getAutomationLogs(workspaceId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const retryAutomationRun = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = getWorkspaceId(req);
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : String(req.params.runId || '');
    const data = await metaService.retryAutomationRun(workspaceId, runId);
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 5. WEBHOOK & COMPLIANCE ENDPOINTS
// -----------------------------------------------------------------------------

export const verifyWebhook = (req: Request, res: Response): any => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');

  logger.info('[MetaWebhook] Verification request received', { mode, challenge });

  try {
    const result = metaService.handleWebhookVerification(mode, token, challenge);
    return res.status(200).set('Content-Type', 'text/plain').send(result);
  } catch (error: any) {
    logger.error('[MetaWebhook] Verification failed', { error: error.message });
    return res.status(403).set('Content-Type', 'text/plain').send(error?.message || 'Verification failed');
  }
};

export const handleWebhookEvent = async (req: Request, res: Response): Promise<any> => {
  const rawBody = (req as any).rawBody;
  const signatureHeader = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
  const appSecret = process.env.META_APP_SECRET || '';

  if (signatureHeader && rawBody) {
    try {
      const parts = String(signatureHeader).split('=');
      if (parts.length === 2) {
        const algorithm = parts[0];
        const signature = parts[1];

        const hmac = crypto.createHmac(algorithm, appSecret);
        hmac.update(rawBody);
        const expectedSignature = hmac.digest('hex');

        const signatureBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
          logger.warn('[MetaWebhook] Signature verification failed');
          return res.status(401).send('Invalid signature');
        }
      }
    } catch (e: any) {
      logger.error('[MetaWebhook] Signature error', { error: e.message });
      return res.status(401).send('Signature verification failed');
    }
  }

  try {
    void metaService.processLeadGenWebhook(req.body).catch((err) => {
      logger.error('[MetaWebhook] Leadgen processing error', { error: err?.message });
    });
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    return res.status(200).send('EVENT_RECEIVED');
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
    return res.status(400).json({ success: false, error: { message: error?.message || 'Invalid signature' } });
  }
};
