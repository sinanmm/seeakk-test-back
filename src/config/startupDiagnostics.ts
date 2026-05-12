import { SOCKET_IO_PATH } from './socketConstants';

/**
 * Logs safe deployment diagnostics once at boot (no secrets).
 */
const warnIfMissingProductionUrl = (key: string, value: string | undefined): void => {
  if (process.env.NODE_ENV === 'production' && !value?.trim()) {
    console.warn(`[Startup] WARNING: ${key} is missing — emails and OAuth redirects may use wrong URLs.`);
  }
};

export const logStartupDiagnostics = (): void => {
  const port = process.env.PORT || '5000';
  console.log('[Startup] diagnostics', {
    NODE_ENV: process.env.NODE_ENV || '(unset)',
    PORT: port,
    PID: process.pid,
    bindHint: 'listening on 0.0.0.0 (all interfaces)',
  });

  warnIfMissingProductionUrl('FRONTEND_URL', process.env.FRONTEND_URL);
  warnIfMissingProductionUrl('BACKEND_URL', process.env.BACKEND_URL);

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL?.trim()) {
      console.warn('[Startup] FRONTEND_URL unset — CORS allowlist and email deep links may break.');
    }
    if (!process.env.BACKEND_URL?.trim()) {
      console.warn('[Startup] BACKEND_URL unset — verification/reset email links may be wrong.');
    }
    if (!process.env.ALLOWED_ORIGINS?.trim() && !process.env.FRONTEND_URL?.trim()) {
      console.warn('[Startup] ALLOWED_ORIGINS and FRONTEND_URL both unset — browsers may be blocked by CORS.');
    }
  }

  console.log('[Startup] CORS env:', {
    FRONTEND_URL: process.env.FRONTEND_URL ? '(set)' : '(missing)',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? '(set)' : '(missing)',
  });
  console.log('[Startup] Engine.IO path:', SOCKET_IO_PATH, '(must match client path)');
};
