import { Router } from 'express';
import { protect, checkAnyPermission } from '../../middlewares/authMiddleware';
import { requireModule } from '../../middlewares/moduleGuard';
import * as telephonyController from './telephony.controller';

const router = Router();

// Public Webhook Ingestion Endpoint for Providers (Knowlarity, Plivo, Exotel, etc.)
router.post('/webhook/:providerKey', telephonyController.handleWebhook);
router.get('/webhook/:providerKey', telephonyController.handleWebhook);

// Protected Telephony Settings & Provider Configuration Endpoints
router.get('/settings', protect, requireModule('TELEPHONY'), telephonyController.getSettings);
router.put('/settings', protect, requireModule('TELEPHONY'), telephonyController.updateSettings);
router.get('/providers', protect, requireModule('TELEPHONY'), telephonyController.getProviders);
router.put('/providers/:providerKey', protect, requireModule('TELEPHONY'), telephonyController.saveProviderConfig);
router.post('/providers/:providerKey/test', protect, requireModule('TELEPHONY'), telephonyController.testConnection);
router.get('/providers/:providerKey/agents', protect, requireModule('TELEPHONY'), telephonyController.getProviderAgents);
router.get('/user-mappings', protect, requireModule('TELEPHONY'), telephonyController.getUserMappings);
router.put('/user-mappings', protect, requireModule('TELEPHONY'), telephonyController.saveUserMapping);

// Protected Audio Playback, Streaming & Diagnostic Endpoints
router.get(
  '/recordings/:sessionId/play',
  protect,
  checkAnyPermission([
    'CALL_OUTCOMES_VIEW',
    'CALL_OUTCOMES_CREATE',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'LEADS_EDIT',
  ]),
  telephonyController.getRecordingPlayback,
);

router.get(
  '/recordings/:sessionId/stream',
  protect,
  checkAnyPermission([
    'CALL_OUTCOMES_VIEW',
    'CALL_OUTCOMES_CREATE',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'LEADS_EDIT',
  ]),
  telephonyController.getRecordingStream,
);

router.get(
  '/recordings/:sessionId/diagnostic',
  protect,
  checkAnyPermission([
    'CALL_OUTCOMES_VIEW',
    'CALL_OUTCOMES_CREATE',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'LEADS_EDIT',
  ]),
  telephonyController.getRecordingDiagnostic,
);

export default router;
