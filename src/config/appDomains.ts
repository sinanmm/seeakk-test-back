/**
 * Canonical production frontend hostnames for Seeakk CRM.
 * Runtime behavior still prefers FRONTEND_URL / ALLOWED_ORIGINS on the server.
 */

export const PRODUCTION_FRONTEND_URL = 'https://www.seeakk.com';

/** Origins always trusted for CORS / Socket.io (www + apex). */
export const PRODUCTION_FRONTEND_ORIGINS = [
  PRODUCTION_FRONTEND_URL,
  'https://seeakk.com',
] as const;
