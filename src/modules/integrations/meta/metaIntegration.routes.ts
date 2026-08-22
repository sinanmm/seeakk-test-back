import { Router } from 'express';
import { protect } from '../../../middlewares/authMiddleware';
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
router.get('/auth-url', protect, metaController.getAuthUrl);
router.get('/status', protect, metaController.getStatus);
router.get('/pages', protect, metaController.getPagesAndForms);
router.put('/forms/:formId', protect, metaController.saveFormConfig);
router.get('/sync-activity', protect, metaController.getSyncActivity);
router.post('/sync-activity/:importId/retry', protect, metaController.retryFailedImport);
router.post('/disconnect', protect, metaController.disconnectMeta);

// Multi-Automation System Endpoints
router.get('/connections', protect, metaController.getConnections);
router.get('/connections/:connectionId/pages', protect, metaController.getPagesForConnection);
router.get('/pages/:pageConnectionId/forms', protect, metaController.fetchPageLeadForms);
router.get('/pages/:pageConnectionId/forms/:metaFormId/fields', protect, metaController.fetchFormFields);
router.get('/seeakk-lead-fields', protect, metaController.getSeeakkLeadFields);

router.get('/automations', protect, metaController.listAutomations);
router.post('/automations', protect, metaController.createAutomation);
router.get('/automations/:id', protect, metaController.getAutomationById);
router.put('/automations/:id', protect, metaController.updateAutomation);
router.patch('/automations/:id/toggle', protect, metaController.toggleAutomation);
router.post('/automations/:id/duplicate', protect, metaController.duplicateAutomation);
router.delete('/automations/:id', protect, metaController.deleteAutomation);

export default router;
