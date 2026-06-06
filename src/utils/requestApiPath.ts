import { Request } from 'express';
import logger from './logger';

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
  const candidatesRaw = [
    req.originalUrl?.split('?')[0],
    `${req.baseUrl || ''}${req.path || ''}`,
    req.url?.split('?')[0],
    req.path,
  ];
  
  const candidates = candidatesRaw.filter((value): value is string => Boolean(value && value.trim()));

  const normalized = candidates
    .map(normalizeSinglePath)
    .filter((path) => path.startsWith('/api/'));

  if (normalized.length === 0) {
    logger.warn('[PathNormalization] No valid API path candidates found', {
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      url: req.url,
      candidatesRaw
    });
    return '/api';
  }

  const sorted = normalized.sort((left, right) => pathSpecificityScore(right) - pathSpecificityScore(left));
  
  if (sorted[0]?.includes('bulk-extend') || sorted[0]?.includes('alerts')) {
    logger.info('[PathNormalization] Path resolved', {
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      url: req.url,
      candidatesRaw,
      normalizedCandidates: normalized,
      finalPath: sorted[0]
    });
  }

  return sorted[0];
};
