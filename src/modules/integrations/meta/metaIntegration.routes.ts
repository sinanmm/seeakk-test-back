import { Router } from 'express';
import { protect } from '../../../middlewares/authMiddleware';
import { requireModule } from '../../../middlewares/moduleGuard';
import * as metaController from './metaIntegration.controller';

const router = Router();

// Public Meta Webhook Endpoints (Called by Meta servers)
router.get('/webhook', metaController.verifyWebhook);
router.post('/webhook', metaController.handleWebhookEvent);

// Public OAuth Callback endpoint (Meta redirects browser here)
router.get('/callback', metaController.handleCallback);
router.get('/oauth/callback', metaController.handleCallback);

// Public Meta Data Deletion Callback (Called by Meta servers on user data deletion)
router.post('/data-deletion', metaController.handleDataDeletionCallback);

// Protected Workspace Settings Endpoints
router.get('/auth-url', protect, requireModule('META_ADS'), metaController.getAuthUrl);
router.get('/status', protect, requireModule('META_ADS'), metaController.getStatus);
router.get('/pages', protect, requireModule('META_ADS'), metaController.getPagesAndForms);
router.put('/forms/:formId', protect, requireModule('META_ADS'), metaController.saveFormConfig);
router.get('/sync-activity', protect, requireModule('META_ADS'), metaController.getSyncActivity);
router.post('/sync-activity/:importId/retry', protect, requireModule('META_ADS'), metaController.retryFailedImport);
router.post('/disconnect', protect, requireModule('META_ADS'), metaController.disconnectMeta);

// Multi-Automation System Endpoints
router.get('/connections', protect, requireModule('META_ADS'), metaController.getConnections);
router.get('/connections/:connectionId/pages', protect, requireModule('META_ADS'), metaController.getPagesForConnection);
router.get('/pages/:pageConnectionId/forms', protect, requireModule('META_ADS'), metaController.fetchPageLeadForms);
router.get('/pages/:pageConnectionId/forms/:metaFormId/fields', protect, requireModule('META_ADS'), metaController.fetchFormFields);
router.get('/seeakk-lead-fields', protect, requireModule('META_ADS'), metaController.getSeeakkLeadFields);

router.get('/automations', protect, requireModule('META_ADS'), metaController.listAutomations);
router.post('/automations', protect, requireModule('META_ADS'), metaController.createAutomation);
router.get('/automations/:id', protect, requireModule('META_ADS'), metaController.getAutomationById);
router.put('/automations/:id', protect, requireModule('META_ADS'), metaController.updateAutomation);
router.patch('/automations/:id/toggle', protect, requireModule('META_ADS'), metaController.toggleAutomation);
router.post('/automations/:id/duplicate', protect, requireModule('META_ADS'), metaController.duplicateAutomation);
router.delete('/automations/:id', protect, requireModule('META_ADS'), metaController.deleteAutomation);

export default router;
