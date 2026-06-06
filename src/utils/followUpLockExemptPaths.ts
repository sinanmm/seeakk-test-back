import { Request } from 'express';
import { collectNormalizedApiPathCandidates, normalizeRequestApiPath } from './requestApiPath';

/** Prefix routes that must stay reachable while follow-up locks are active. */
export const FOLLOWUP_LOCK_RESOLUTION_PREFIXES = [
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/followups/overdue-mandatory',
  '/api/followups/mandatory-continuation',
  '/api/followups/lifecycle-extension-limit',
  '/api/followups/today-utilization',
  '/api/followups/alerts',
  '/api/followups/users',
  '/api/followups/history',
  '/api/followups/bulk-extend',
  '/api/followup-extension-reasons',
  '/api/holidays/weekly-off',
  '/api/leads/meta/assignees',
  '/api/admin/users',
  '/api/attendance/today',
  '/api/attendance/check-in',
  '/api/attendance/settings',
  '/api/attendance/networks',
  '/api/master',
  '/api/lob-reasons',
  '/api/admin/lead-life-cycles',
] as const;

/** Stable suffixes used as a fallback when proxy/baseUrl combinations vary. */
export const FOLLOWUP_LOCK_RESOLUTION_SUFFIXES = [
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
  '/followup-extension-reasons/active',
  '/followup-extension-reasons',
  '/holidays/weekly-off',
  '/weekly-off',
] as const;

/** Raw URL markers for reverse-proxy / Render mount-relative paths. */
const RAW_RESOLUTION_MARKERS = [
  '/followups/overdue-mandatory',
  '/followups/mandatory-continuation',
  '/followups/lifecycle-extension-limit',
  '/followups/today-utilization',
  '/followups/alerts',
  '/followups/users',
  '/followups/history',
  '/followups/bulk-extend',
  '/followup-extension-reasons',
  '/holidays/weekly-off',
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

const matchesRawResolutionMarker = (req: Request, method: string): boolean => {
  const raw = getRawRequestPath(req);

  if (raw.includes('/followups/bulk-extend')) {
    return method === 'POST';
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

export const isFollowUpLockResolutionPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const method = (req.method || 'GET').toUpperCase();

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
