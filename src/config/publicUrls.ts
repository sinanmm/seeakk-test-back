import { PRODUCTION_FRONTEND_URL } from './appDomains';

/**
 * Public URLs used in transactional emails and redirects.
 * Prefer explicit env; fallbacks reduce "manual invite only" when FRONTEND_URL is omitted but ALLOWED_ORIGINS is set.
 */

const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

/** First origin from comma/semicolon/space-separated list (preserves casing except trim). */
const firstOriginFromList = (value?: string | null): string => {
  const raw = (value || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[\s,;]+/).map((s) => trimTrailingSlashes(s)).filter(Boolean);
  return parts[0] || '';
};

export const getPublicFrontendUrl = (): string => {
  const fromEnv = trimTrailingSlashes(process.env.FRONTEND_URL || '');
  if (fromEnv) return fromEnv;

  const fromAllowed = firstOriginFromList(process.env.ALLOWED_ORIGINS);
  if (fromAllowed) return fromAllowed;

  if (process.env.NODE_ENV !== 'production') {
    return trimTrailingSlashes(process.env.VITE_DEV_FRONTEND_URL || 'http://localhost:5173');
  }

  return PRODUCTION_FRONTEND_URL;
};

/**
 * Backend public URL (email links to API routes). Prefer BACKEND_URL.
 * Render may expose the service URL via RENDER_EXTERNAL_URL on some setups.
 */
export const getPublicBackendUrl = (): string => {
  const fromEnv = trimTrailingSlashes(process.env.BACKEND_URL || '');
  if (fromEnv) return fromEnv;

  const renderUrl = trimTrailingSlashes(process.env.RENDER_EXTERNAL_URL || '');
  if (renderUrl) return renderUrl;

  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || '5000';
    return trimTrailingSlashes(process.env.VITE_DEV_BACKEND_URL || `http://localhost:${port}`);
  }
  return '';
};
