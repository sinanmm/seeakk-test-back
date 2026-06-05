import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBulkRescheduleUserFilter } from './followupService';

test('resolveBulkRescheduleUserFilter returns no user filter when scope is ALL and assignee is ALL', () => {
  assert.deepEqual(resolveBulkRescheduleUserFilter('ALL', 'ALL'), {});
  assert.deepEqual(resolveBulkRescheduleUserFilter(undefined, 'ALL'), {});
});

test('resolveBulkRescheduleUserFilter scopes ALL assignee to visible user ids', () => {
  assert.deepEqual(resolveBulkRescheduleUserFilter('ALL', ['u1', 'u2']), {
    userId: { in: ['u1', 'u2'] },
  });
});

test('resolveBulkRescheduleUserFilter targets a single follow-up assignee', () => {
  assert.deepEqual(resolveBulkRescheduleUserFilter('user_a', 'ALL'), {
    userId: 'user_a',
  });
});

test('resolveBulkRescheduleUserFilter rejects assignee outside scope', () => {
  assert.throws(
    () => resolveBulkRescheduleUserFilter('outsider', ['u1']),
    (error: Error & { statusCode?: number }) => error.statusCode === 403,
  );
});
