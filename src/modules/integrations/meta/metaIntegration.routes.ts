import { Router } from 'express';
import { protect } from '../../../middlewares/authMiddleware';
import * as metaController from './metaIntegration.controller';

const router = Router();

// -----------------------------------------------------------------------------
// Public Meta Webhook Endpoints (Called by Meta servers)
// -----------------------------------------------------------------------------
router.get(['/webhook', '/'], metaController.verifyWebhook);
router.post(['/webhook', '/'], metaController.handleWebhookEvent);

// Public OAuth Callback endpoint (Meta redirects browser here)
router.get(['/callback', '/oauth/callback'], metaController.handleCallback);

// Public Meta Data Deletion Callback
router.post('/data-deletion', metaController.handleDataDeletionCallback);

// -----------------------------------------------------------------------------
// Protected Workspace Settings Endpoints
// -----------------------------------------------------------------------------

// OAuth Init
router.get('/auth-url', protect, metaController.getAuthUrl);

// Connections Management
router.get('/connections', protect, metaController.getConnections);
router.delete('/connections/:id', protect, metaController.disconnectConnection);

// Pages & Lead Forms Discovery
router.get('/connections/:connectionId/pages', protect, metaController.getPages);
router.post('/connections/:connectionId/pages/refresh', protect, metaController.getPages);
router.get('/pages/:pageId/forms', protect, metaController.getForms);
router.post('/pages/:pageId/forms/refresh', protect, metaController.getForms);
router.get('/pages/:pageId/forms/:formId/fields', protect, metaController.getFormFields);

// Automations CRUD & Control
router.get('/automations', protect, metaController.getAutomations);
router.post('/automations', protect, metaController.createAutomation);
router.get('/automations/:id', protect, metaController.getAutomationById);
router.put('/automations/:id', protect, metaController.updateAutomation);
router.delete('/automations/:id', protect, metaController.deleteAutomation);
router.post('/automations/:id/duplicate', protect, metaController.duplicateAutomation);
router.post('/automations/:id/toggle', protect, metaController.toggleAutomation);
router.post('/automations/:id/test', protect, metaController.testAutomation);

// Automation Logs & Retries
router.get(['/runs', '/logs', '/sync-activity'], protect, metaController.getAutomationLogs);
router.post(['/runs/:runId/retry', '/sync-activity/:importId/retry'], protect, metaController.retryAutomationRun);

export default router;
