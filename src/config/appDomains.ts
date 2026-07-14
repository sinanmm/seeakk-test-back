/**
 * Canonical production frontend hostnames for Seeakk CRM.
 * Runtime behavior still prefers FRONTEND_URL / ALLOWED_ORIGINS on the server.
 */

export const PRODUCTION_FRONTEND_URL = 'https://www.seeakk.com';

/** Origins always trusted for CORS / Socket.io (www + apex). */
export const PRODUCTION_FRONTEND_ORIGINS = [
  PRODUCTION_FRONTEND_URL,
  'https://seeakk.com',
  'https://prkqafwj4vbevbh4a6v8a7nm.65.108.51.208.sslip.io',
] as const;
