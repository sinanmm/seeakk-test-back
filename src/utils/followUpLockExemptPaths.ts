import { Request } from 'express';
import logger from './logger';
import { collectNormalizedApiPathCandidates, normalizeRequestApiPath } from './requestApiPath';

/** Bump when bypass logic changes — visible on /healthz to confirm Render deploy. */
export const FOLLOWUP_LOCK_BYPASS_VERSION = '2026-06-06-haystack-v2';

export type FollowUpLockPathDiagnostics = {
  method: string;
  haystack: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  baseUrl?: string;
  routePath?: string;
  normalizedCandidates: string[];
  primaryPath: string;
  checks: {
    hardcodedHaystack: boolean;
    expressRoute: boolean;
    rawMarker: boolean;
    normalizedAny: boolean;
    normalizedPrimary: boolean;
    finalAllowed: boolean;
  };
  followUpLockBypassVersion: string;
};

export const buildRequestPathHaystack = (req: Request): string =>
  [
    req.originalUrl,
    req.url,
    req.path,
    req.baseUrl,
    req.route?.path,
    `${req.baseUrl || ''}${req.path || ''}`,
    `${req.baseUrl || ''}${req.route?.path || ''}`,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('|')
    .toLowerCase();

/**
 * Proxy-safe haystack matcher — runs before prefix/suffix normalization.
 * Covers Render mount-relative paths like `/bulk-extend` and `/weekly-off`.
 */
export const isHardcodedFollowUpLockResolutionRequest = (req: Request): boolean => {
  const method = (req.method || 'GET').toUpperCase();
  const haystack = buildRequestPathHaystack(req);
  if (!haystack) return false;

  const alwaysAllowMarkers = [
    'overdue-mandatory',
    'mandatory-continuation',
    'lifecycle-extension-limit',
    'today-utilization',
    'followup-extension-reasons',
    'weekly-off',
    'weekly_off',
  ];

  if (alwaysAllowMarkers.some((marker) => haystack.includes(marker))) {
    return true;
  }

  if (haystack.includes('bulk-extend') || haystack.includes('bulk_extend')) {
    return method === 'POST';
  }

  if (haystack.includes('/alerts') || haystack.endsWith('|alerts') || haystack === 'alerts') {
    return true;
  }

  if (method === 'POST' && haystack.includes('/complete') && haystack.includes('followup')) {
    return true;
  }

  if (['PATCH', 'POST'].includes(method) && haystack.includes('followup')) {
    if (haystack.includes('/snooze') || haystack.includes('/extend')) {
      return true;
    }
  }

  if (['PUT', 'POST', 'PATCH'].includes(method) && (haystack.includes('/leads/') || haystack.includes('/leads'))) {
    return true;
  }

  if (method === 'POST' && haystack.includes('followup') && !haystack.includes('bulk-extend')) {
    return haystack
      .split('|')
      .some((part) => /\/followups\/?$/.test(part) || part.endsWith('/followups'));
  }

  return false;
};

/** Prefix routes that must stay reachable while follow-up locks are active. */
export const FOLLOWUP_LOCK_RESOLUTION_PREFIXES = [
  '/api/auth/me',
  '/api/leads',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/notifications',
  '/api/users/profile',
  '/api/followups/overdue-mandatory',
  '/api/followups/mandatory-continuation',
  '/api/followups/lifecycle-extension-limit',
  '/api/followups/today-utilization',
  '/api/followups/alerts',
  '/api/followups/users',
  '/api/followups/history',
  '/api/followups/lead-context',
  '/api/followups/bulk-extend',
  '/api/followup-extension-reasons',
  '/api/holidays/weekly-off',
  '/api/leads/meta/assignees',
  '/api/admin/users',
  '/api/attendance/today',
  '/api/attendance/check-in',
  '/api/attendance/settings',
  '/api/attendance/networks',
  '/api/location-tracking',
  '/api/lead-dynamics',
  '/api/admin/lead-dynamics',
  '/api/dashboard',
  '/api/master',
  '/api/lob-reasons',
  '/api/admin/lead-life-cycles',
  '/api/workspace',
  '/api/workspace/config-meta',
  '/api/workspace/setup',
] as const;

/** Stable suffixes used as a fallback when proxy/baseUrl combinations vary. */
export const FOLLOWUP_LOCK_RESOLUTION_SUFFIXES = [
  '/notifications',
  '/users/profile',
  '/workspace/config-meta',
  '/workspace/setup',
  '/config-meta',
  '/followups/overdue-mandatory',
  '/overdue-mandatory',
  '/followups/mandatory-continuation',
  '/mandatory-continuation',
  '/followups/lifecycle-extension-limit',
  '/lifecycle-extension-limit',
  '/followups/today-utilization',
  '/today-utilization',
  '/followups/alerts',
  '/alerts',
  '/followups/bulk-extend',
  '/bulk-extend',
  '/followups/users',
  '/followups/history',
  '/followups/lead-context',
  '/lead-context',
  '/followup-extension-reasons/active',
  '/followup-extension-reasons',
  '/holidays/weekly-off',
  '/weekly-off',
  '/location-tracking',
  '/lead-dynamics',
  '/dashboard',
] as const;

/** Raw URL markers for reverse-proxy / Render mount-relative paths. */
const RAW_RESOLUTION_MARKERS = [
  '/workspace/config-meta',
  '/workspace/setup',
  'config-meta',
  '/followups/overdue-mandatory',
  '/followups/mandatory-continuation',
  '/followups/lifecycle-extension-limit',
  '/followups/today-utilization',
  '/followups/alerts',
  '/followups/users',
  '/followups/history',
  '/followups/lead-context',
  '/followups/bulk-extend',
  '/followup-extension-reasons',
  '/holidays/weekly-off',
  '/location-tracking',
  '/lead-dynamics',
  '/dashboard',
] as const;

type MethodPattern = {
  methods: ReadonlyArray<string>;
  pattern: RegExp;
};

/**
 * Method-specific follow-up resolution routes (complete, extend/snooze, schedule, bulk).
 * Covers actual API routes and legacy alias shapes used by clients/proxies.
 */
export const FOLLOWUP_LOCK_RESOLUTION_METHOD_PATTERNS: MethodPattern[] = [
  { methods: ['POST'], pattern: /^\/api\/followups\/?$/ },
  { methods: ['POST'], pattern: /^\/api\/(?:followups\/)?[^/]+\/complete$/ },
  { methods: ['PATCH', 'POST'], pattern: /^\/api\/(?:followups\/)?[^/]+\/snooze$/ },
  { methods: ['PATCH', 'POST'], pattern: /^\/api\/(?:followups\/)?[^/]+\/extend$/ },
  { methods: ['POST'], pattern: /^\/api\/(?:followups\/)?[^/]+\/schedule$/ },
  { methods: ['POST'], pattern: /^\/api\/(?:followups\/)?bulk-extend$/ },
];

const matchesResolutionPrefix = (path: string): boolean =>
  FOLLOWUP_LOCK_RESOLUTION_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

const matchesResolutionSuffix = (path: string): boolean =>
  FOLLOWUP_LOCK_RESOLUTION_SUFFIXES.some(
    (suffix) => path === `/api${suffix}` || path.endsWith(suffix),
  );

const matchesResolutionMethodPattern = (path: string, method: string): boolean =>
  FOLLOWUP_LOCK_RESOLUTION_METHOD_PATTERNS.some(
    ({ methods, pattern }) => methods.includes(method) && pattern.test(path),
  );

const pathMatchesResolution = (path: string, method: string): boolean =>
  matchesResolutionPrefix(path) ||
  matchesResolutionSuffix(path) ||
  matchesResolutionMethodPattern(path, method);

const getRawRequestPath = (req: Request): string =>
  `${req.originalUrl || ''}${req.url || ''}`.toLowerCase().split('?')[0];

const FOLLOWUPS_RESOLUTION_ROUTE_PATHS = new Set([
  '/overdue-mandatory',
  '/mandatory-continuation',
  '/lifecycle-extension-limit',
  '/today-utilization',
  '/alerts',
  '/users',
  '/history',
  '/bulk-extend',
  '/:id/complete',
  '/:id/snooze',
  '/',
]);

/** Uses Express route match — most reliable once the router has bound the request. */
const matchesExpressResolvedRoute = (req: Request, method: string): boolean => {
  const routePath = req.route?.path;
  if (!routePath || typeof routePath !== 'string') {
    return false;
  }

  const base = (req.baseUrl || '').toLowerCase();
  const isFollowupsMount = base === '/api/followups' || base.endsWith('/followups');
  const isHolidaysMount = base === '/api/holidays' || base.endsWith('/holidays');

  if (isFollowupsMount) {
    if (routePath === '/bulk-extend') {
      return method === 'POST';
    }
    if (routePath === '/') {
      return method === 'POST';
    }
    if (routePath === '/:id/complete') {
      return method === 'POST';
    }
    if (routePath === '/:id/snooze') {
      return method === 'PATCH' || method === 'POST';
    }
    return FOLLOWUPS_RESOLUTION_ROUTE_PATHS.has(routePath);
  }

  if (isHolidaysMount && routePath === '/weekly-off') {
    return true;
  }

  return false;
};

const matchesRawResolutionMarker = (req: Request, method: string): boolean => {
  const raw = getRawRequestPath(req);

  if (method === 'POST' && (raw.includes('bulk-extend') || raw.includes('bulk_extend'))) {
    return true;
  }

  if (RAW_RESOLUTION_MARKERS.some((marker) => raw.includes(marker))) {
    return true;
  }

  if (method === 'POST' && /\/followups\/[^/?#]+\/complete(?:\/|$|\?)/.test(raw)) {
    return true;
  }

  if (['PATCH', 'POST'].includes(method) && /\/followups\/[^/?#]+\/(?:snooze|extend)(?:\/|$|\?)/.test(raw)) {
    return true;
  }

  if (method === 'POST' && /\/followups\/?(?:\?|$)/.test(raw) && !raw.includes('/bulk-extend')) {
    return true;
  }

  return false;
};

export const diagnoseFollowUpLockPath = (req: Request): FollowUpLockPathDiagnostics => {
  const method = (req.method || 'GET').toUpperCase();
  const paths = collectNormalizedApiPathCandidates(req);
  const primaryPath = normalizeRequestApiPath(req);
  const hardcodedHaystack = isHardcodedFollowUpLockResolutionRequest(req);
  const expressRoute = matchesExpressResolvedRoute(req, method);
  const rawMarker = matchesRawResolutionMarker(req, method);
  const normalizedAny = paths.some((path) => pathMatchesResolution(path, method));
  const normalizedPrimary = pathMatchesResolution(primaryPath, method);
  const finalAllowed =
    req.method === 'OPTIONS' ||
    hardcodedHaystack ||
    expressRoute ||
    rawMarker ||
    normalizedAny ||
    normalizedPrimary;

  return {
    method,
    haystack: buildRequestPathHaystack(req),
    originalUrl: req.originalUrl,
    url: req.url,
    path: req.path,
    baseUrl: req.baseUrl,
    routePath: req.route?.path,
    normalizedCandidates: paths,
    primaryPath,
    checks: {
      hardcodedHaystack,
      expressRoute,
      rawMarker,
      normalizedAny,
      normalizedPrimary,
      finalAllowed,
    },
    followUpLockBypassVersion: FOLLOWUP_LOCK_BYPASS_VERSION,
  };
};

export const isFollowUpLockResolutionPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const path = normalizeRequestApiPath(req);
  const method = (req.method || 'GET').toUpperCase();

  const isPrefixMatch = matchesResolutionPrefix(path);
  const isSuffixMatch = matchesResolutionSuffix(path);
  const isMethodMatch = matchesResolutionMethodPattern(path, method);

  if (path.includes('bulk-extend') || path.includes('alerts')) {
    logger.info('[FollowUpLockExempt] Checking exemption', {
      originalPath: req.originalUrl,
      normalizedPath: path,
      method,
      isPrefixMatch,
      isSuffixMatch,
      isMethodMatch,
      isExempt: isPrefixMatch || isSuffixMatch || isMethodMatch
    });
  }

  if (isPrefixMatch || isSuffixMatch) {
    return true;
  }

  if (isMethodMatch) {
    return true;
  }

  if (isHardcodedFollowUpLockResolutionRequest(req)) {
    return true;
  }

  if (matchesExpressResolvedRoute(req, method)) {
    return true;
  }

  if (matchesRawResolutionMarker(req, method)) {
    return true;
  }

  const paths = collectNormalizedApiPathCandidates(req);
  if (paths.some((path) => pathMatchesResolution(path, method))) {
    return true;
  }

  const primaryPath = normalizeRequestApiPath(req);
  return pathMatchesResolution(primaryPath, method);
};

/** Overdue mandatory popup resolution paths (subset used by overdue lock bypass). */
export const isOverdueFollowUpResolutionPath = (req: Request): boolean => isFollowUpLockResolutionPath(req);

export const isFollowUpLockDebugEnabled = (): boolean =>
  String(process.env.FOLLOWUP_LOCK_DEBUG || '').trim().toLowerCase() === 'true';

export const describeFollowUpUnlockCondition = (lockReason: string): string => {
  switch (lockReason) {
    case 'MANDATORY_FOLLOWUP_REQUIRED':
      return 'Schedule a future follow-up for each active lifecycle lead missing one';
    case 'OVERDUE_FOLLOWUP_REQUIRED':
      return 'Complete or extend every overdue follow-up';
    case 'ACCOUNT_LOCKED':
      return 'Resolve target lock or mandatory follow-up requirements';
    default:
      return 'Resolve active account restriction';
  }
};
