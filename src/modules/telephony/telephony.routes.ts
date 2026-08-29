import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
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

// Protected Audio Playback & Streaming Endpoint
router.get('/recordings/:sessionId/play', protect, requireModule('TELEPHONY'), telephonyController.getRecordingPlayback);

export default router;
