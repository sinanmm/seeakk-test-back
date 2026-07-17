/**
 * Canonical production frontend hostnames for Seeakk CRM.
 * Runtime behavior still prefers FRONTEND_URL / ALLOWED_ORIGINS on the server.
 */

export const PRODUCTION_FRONTEND_URL = 'https://app.seeakk.com';

/** Origins always trusted for CORS / Socket.io. */
export const PRODUCTION_FRONTEND_ORIGINS = [
  PRODUCTION_FRONTEND_URL,
  'https://seeakk.com',
  'https://www.seeakk.com',
] as const;
