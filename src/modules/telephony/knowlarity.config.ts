/**
 * Centralized Provider Configuration for Knowlarity Telephony Integration.
 * 
 * IMPORTANT:
 * Official Knowlarity production API contracts, live endpoints, and authentication schemes
 * must be inserted here once official Knowlarity documentation & credentials are provided.
 */

export const KNOWLARITY_CONFIG = {
  // Configurable Placeholders for Provider Adapter
  apiBaseUrl: process.env.KNOWLARITY_API_BASE_URL || 'TODO_KNOWLARITY_OFFICIAL_VALUE',
  clickToCallPath: process.env.KNOWLARITY_CLICK_TO_CALL_PATH || '/agent/make_call',
  callStatusPath: process.env.KNOWLARITY_CALL_STATUS_PATH || '/call_status',
  recordingPath: process.env.KNOWLARITY_RECORDING_PATH || '/recording',
  apiVersion: process.env.KNOWLARITY_API_VERSION || 'v1',
  authScheme: process.env.KNOWLARITY_AUTH_SCHEME || 'X-API-KEY', // 'X-API-KEY', 'BEARER', 'BASIC'
  webhookVerificationMode: process.env.KNOWLARITY_WEBHOOK_VERIFICATION_MODE || 'UNCONFIGURED', // 'SIGNATURE', 'SECRET_HEADER', 'IP_WHITELIST', 'UNCONFIGURED'
  
  // Status Code Mapping Table (Knowlarity Status -> SEEAKK Normalized Status)
  statusMap: {
    'queued': 'QUEUED',
    'initiated': 'INITIATED',
    'ringing': 'RINGING',
    'answered': 'ANSWERED',
    'connected': 'ANSWERED',
    'completed': 'COMPLETED',
    'busy': 'BUSY',
    'no_answer': 'NO_ANSWER',
    'failed': 'FAILED',
    'cancelled': 'CANCELLED',
  } as Record<string, 'QUEUED' | 'INITIATED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'BUSY' | 'NO_ANSWER' | 'FAILED' | 'CANCELLED'>,
};

export const KNOWLARITY_PLACEHOLDERS = {
  ACCOUNT_ID: 'KNOWLARITY_PLACEHOLDER_ACCOUNT_ID',
  API_KEY: 'KNOWLARITY_PLACEHOLDER_API_KEY',
  API_SECRET: 'KNOWLARITY_PLACEHOLDER_API_SECRET',
  SERVICE_ID: 'KNOWLARITY_PLACEHOLDER_SERVICE_ID',
  VIRTUAL_NUMBER: 'KNOWLARITY_PLACEHOLDER_VIRTUAL_NUMBER',
};
