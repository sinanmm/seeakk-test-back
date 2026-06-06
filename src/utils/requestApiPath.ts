import { Request } from 'express';

/**
 * Builds a stable `/api/...` path for mounted Express routers.
 * `req.url` alone is mount-relative (e.g. `/meta/assignees`) and must be
 * combined with `req.baseUrl` (e.g. `/api/leads`) for correct matching.
 */
const stripTrailingSlash = (path: string): string => {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
};

export const normalizeRequestApiPath = (req: Request): string => {
  const fromOriginal = stripTrailingSlash((req.originalUrl || '').split('?')[0].trim().toLowerCase());
  if (fromOriginal) {
    if (fromOriginal.startsWith('/api/')) return fromOriginal;
  }

  const base = (req.baseUrl || '').split('?')[0].toLowerCase();
  const pathPart = (req.path || req.url || '').split('?')[0].toLowerCase();
  let combined = stripTrailingSlash(`${base}${pathPart}`.replace(/\/{2,}/g, '/'));
  if (!combined.startsWith('/')) combined = `/${combined}`;

  if (combined.startsWith('/api/')) return combined;
  if (combined.startsWith('/')) return `/api${combined}`;
  return `/api/${combined}`;
};
