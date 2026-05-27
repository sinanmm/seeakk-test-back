import type { NextFunction, Request, Response } from 'express';

const normalizeOrigin = (origin: string): string =>
  origin.trim().toLowerCase().replace(/\/+$/, '');

/** Always permitted CRM frontends (used when Render env vars are missing/outdated). */
const BUILTIN_ALLOWED_ORIGINS = [
  'https://lms-frontend-amber-beta.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

export const CORS_ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-device-id',
  'x-request-id',
  'x-workspace-id',
  'Accept',
  'Origin',
  'X-Requested-With',
].join(', ');

/** Split on comma, semicolon, or whitespace (common in Render / .env pastes). */
const splitOrigins = (value?: string | null): string[] =>
  (value || '')
    .split(/[\s,;]+/)
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

const parseHostname = (origin: string): string | null => {
  try {
    const withProtocol = origin.includes('://') ? origin : `https://${origin}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const getVercelProjectSlug = (): string => {
  const explicit = process.env.CORS_VERCEL_PROJECT_SLUG?.trim().toLowerCase();
  if (explicit) return explicit;

  for (const entry of splitOrigins(process.env.FRONTEND_URL)) {
    const host = parseHostname(entry);
    if (host?.endsWith('.vercel.app')) {
      const match = host.match(/^(lms-frontend[a-z0-9-]*)/);
      if (match) return match[1];
    }
  }

  return 'lms-frontend';
};

/**
 * Vercel production + preview URLs (e.g. lms-frontend-amber-beta.vercel.app).
 * Disable with CORS_ALLOW_VERCEL=false on the server if you need a strict allowlist only.
 */
const isVercelDeploymentOrigin = (origin: string): boolean => {
  if (String(process.env.CORS_ALLOW_VERCEL || 'true').toLowerCase() === 'false') {
    return false;
  }

  const host = parseHostname(origin);
  if (!host || !host.endsWith('.vercel.app')) return false;

  const slug = getVercelProjectSlug();
  if (host === `${slug}.vercel.app` || host.startsWith(`${slug}-`)) return true;

  // Fallback: allow any Vercel deployment host (preview branches, renamed projects).
  return true;
};

export const getAllowedOrigins = (): string[] =>
  Array.from(
    new Set([
      ...BUILTIN_ALLOWED_ORIGINS.map(normalizeOrigin),
      ...splitOrigins(process.env.FRONTEND_URL),
      ...splitOrigins(process.env.ALLOWED_ORIGINS),
    ]),
  );

export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();

  if (isVercelDeploymentOrigin(normalized)) return true;

  return allowed.some((entry) => {
    const candidate = normalizeOrigin(entry);
    if (candidate === normalized) return true;

    const stripWww = (value: string) => value.replace(/^https?:\/\/(www\.)?/, '');
    return stripWww(candidate) === stripWww(normalized);
  });
};

export const corsOriginHandler = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin || isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  console.warn(`[CORS] Blocked origin: "${origin}"`, {
    allowedOrigins: getAllowedOrigins(),
    vercelSlug: getVercelProjectSlug(),
    vercelAllowed: isVercelDeploymentOrigin(normalizeOrigin(origin)),
  });
  callback(null, false);
};

/** Ensure error JSON responses still include CORS headers for allowed browser origins. */
export const applyCorsHeadersIfAllowed = (req: Request, res: Response): void => {
  const origin = req.headers.origin as string | undefined;
  if (!origin || !isAllowedOrigin(origin)) return;

  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
};

/**
 * Answer browser preflight (OPTIONS) before auth/rate-limit middleware runs.
 * Prevents "No Access-Control-Allow-Origin" when downstream handlers reject OPTIONS.
 */
export const handlePreflightRequest = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin as string | undefined;
  if (!origin || !isAllowedOrigin(origin)) {
    next();
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);

  const requestedHeaders = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' && requestedHeaders.trim()
      ? requestedHeaders
      : CORS_ALLOWED_HEADERS,
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
};
