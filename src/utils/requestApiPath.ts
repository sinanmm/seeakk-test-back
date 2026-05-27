import { Request } from 'express';

/**
 * Builds a stable `/api/...` path for mounted Express routers.
 * `req.url` alone is mount-relative (e.g. `/meta/assignees`) and must be
 * combined with `req.baseUrl` (e.g. `/api/leads`) for correct matching.
 */
export const normalizeRequestApiPath = (req: Request): string => {
  const fromOriginal = (req.originalUrl || '').split('?')[0].trim();
  if (fromOriginal) {
    const lowered = fromOriginal.toLowerCase();
    if (lowered.startsWith('/api/')) return lowered;
  }

  const base = (req.baseUrl || '').split('?')[0].toLowerCase();
  const pathPart = (req.path || req.url || '').split('?')[0].toLowerCase();
  let combined = `${base}${pathPart}`;
  if (!combined.startsWith('/')) combined = `/${combined}`;
  combined = combined.replace(/\/{2,}/g, '/');
  if (combined.length > 1 && combined.endsWith('/')) {
    combined = combined.slice(0, -1);
  }

  if (combined.startsWith('/api/')) return combined;
  if (combined.startsWith('/')) return `/api${combined}`;
  return `/api/${combined}`;
};
