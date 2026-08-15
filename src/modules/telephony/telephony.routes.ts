import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as telephonyController from './telephony.controller';

const router = Router();

// Public Webhook Ingestion Endpoint for Providers (Knowlarity, Plivo, Exotel, etc.)
router.post('/webhook/:providerKey', telephonyController.handleWebhook);
router.get('/webhook/:providerKey', telephonyController.handleWebhook);

// Protected Telephony Settings & Provider Configuration Endpoints
router.get('/settings', protect, telephonyController.getSettings);
router.put('/settings', protect, telephonyController.updateSettings);
router.get('/providers', protect, telephonyController.getProviders);
router.put('/providers/:providerKey', protect, telephonyController.saveProviderConfig);
router.post('/providers/:providerKey/test', protect, telephonyController.testConnection);
router.get('/user-mappings', protect, telephonyController.getUserMappings);
router.put('/user-mappings', protect, telephonyController.saveUserMapping);

// Protected Audio Playback & Streaming Endpoint
router.get('/recordings/:sessionId/play', protect, telephonyController.getRecordingPlayback);

export default router;
