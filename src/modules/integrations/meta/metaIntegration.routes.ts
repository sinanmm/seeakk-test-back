import { Router } from 'express';
import { protect } from '../../../middlewares/authMiddleware';
import * as metaController from './metaIntegration.controller';

const router = Router();

// Public Meta Webhook Endpoints (Called by Meta servers)
router.get('/webhook', metaController.verifyWebhook);
router.post('/webhook', metaController.handleWebhookEvent);

// Public OAuth Callback endpoint (Meta redirects browser here)
router.get('/callback', metaController.handleCallback);

// Protected Workspace Settings Endpoints
router.get('/auth-url', protect, metaController.getAuthUrl);
router.get('/status', protect, metaController.getStatus);
router.get('/pages', protect, metaController.getPagesAndForms);
router.put('/forms/:formId', protect, metaController.saveFormConfig);
router.get('/sync-activity', protect, metaController.getSyncActivity);
router.post('/sync-activity/:importId/retry', protect, metaController.retryFailedImport);
router.post('/disconnect', protect, metaController.disconnectMeta);

export default router;
