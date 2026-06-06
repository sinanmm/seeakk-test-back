import { Request } from 'express';

/**
 * Builds a stable `/api/...` path for mounted Express routers.
 * `req.url` alone is mount-relative (e.g. `/bulk-extend`) and must be
 * combined with `req.baseUrl` (e.g. `/api/followups`) for correct matching.
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

const pathSpecificityScore = (path: string): number => {
  const segments = path.split('/').filter(Boolean);
  let score = segments.length * 10;
  if (path.includes('/followups/')) score += 5;
  if (path.includes('/holidays/')) score += 3;
  return score;
};

export const collectNormalizedApiPathCandidates = (req: Request): string[] => {
  const candidates = [
    req.originalUrl?.split('?')[0],
    `${req.baseUrl || ''}${req.path || ''}`,
    req.url?.split('?')[0],
    req.path,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const normalized = candidates
    .map(normalizeSinglePath)
    .filter((path) => path.startsWith('/api/'));

  return [...new Set(normalized)];
};

export const normalizeRequestApiPath = (req: Request): string => {
  const normalized = collectNormalizedApiPathCandidates(req);

  if (normalized.length === 0) {
    return '/api';
  }

  return normalized.sort((left, right) => pathSpecificityScore(right) - pathSpecificityScore(left))[0];
};
