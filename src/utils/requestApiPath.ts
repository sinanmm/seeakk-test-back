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

const normalizeSinglePath = (raw: string): string => {
  let path = stripTrailingSlash(raw.trim().toLowerCase().replace(/\/{2,}/g, '/'));
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.startsWith('/api/')) path = `/api${path}`;
  return path;
};

export const normalizeRequestApiPath = (req: Request): string => {
  const candidates = [
    req.originalUrl?.split('?')[0],
    `${req.baseUrl || ''}${req.path || ''}`,
    req.url?.split('?')[0],
    req.path,
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    const normalized = normalizeSinglePath(candidate);
    if (normalized.startsWith('/api/')) {
      return normalized;
    }
  }

  return '/api';
};
