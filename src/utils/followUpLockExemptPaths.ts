import { Request } from 'express';
import { normalizeRequestApiPath } from './requestApiPath';

/** Prefix routes that must stay reachable while follow-up locks are active. */
export const FOLLOWUP_LOCK_RESOLUTION_PREFIXES = [
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/followups/overdue-mandatory',
  '/api/followups/mandatory-continuation',
  '/api/followups/lifecycle-extension-limit',
  '/api/followups/today-utilization',
  '/api/followups/users',
  '/api/followups/history',
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

type MethodPattern = {
  methods: ReadonlyArray<string>;
  pattern: RegExp;
};

/** Method-specific follow-up resolution routes (complete, extend, schedule, bulk). */
export const FOLLOWUP_LOCK_RESOLUTION_METHOD_PATTERNS: MethodPattern[] = [
  { methods: ['POST'], pattern: /^\/api\/followups$/ },
  { methods: ['POST'], pattern: /^\/api\/followups\/[^/]+\/complete$/ },
  { methods: ['PATCH'], pattern: /^\/api\/followups\/[^/]+\/snooze$/ },
  { methods: ['POST'], pattern: /^\/api\/followups\/bulk-extend$/ },
];

export const isFollowUpLockResolutionPath = (req: Request): boolean => {
  if (req.method === 'OPTIONS') return true;

  const path = normalizeRequestApiPath(req);
  const method = (req.method || 'GET').toUpperCase();

  if (
    FOLLOWUP_LOCK_RESOLUTION_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  return FOLLOWUP_LOCK_RESOLUTION_METHOD_PATTERNS.some(
    ({ methods, pattern }) => methods.includes(method) && pattern.test(path),
  );
};

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
