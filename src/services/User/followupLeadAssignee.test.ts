import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUpLeadOwnerFilter, resolveBulkRescheduleUserFilter, resolveLeadFollowUpOwnerId } from './followupService';

test('resolveBulkRescheduleUserFilter returns no user filter when scope is ALL and assignee is ALL', () => {
  assert.deepEqual(resolveBulkRescheduleUserFilter('ALL', 'ALL'), {});
  assert.deepEqual(resolveBulkRescheduleUserFilter(undefined, 'ALL'), {});
});

test('resolveBulkRescheduleUserFilter scopes ALL assignee to visible user ids', () => {
  assert.deepEqual(resolveBulkRescheduleUserFilter('ALL', ['u1', 'u2']), {
    userId: ['u1', 'u2'],
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


test('resolveLeadFollowUpOwnerId prefers assigned user and falls back to creator', () => {
  assert.equal(resolveLeadFollowUpOwnerId({ assignedToId: 'assignee', createdById: 'creator' }), 'assignee');
  assert.equal(resolveLeadFollowUpOwnerId({ assignedToId: null, createdById: 'creator' }), 'creator');
});

test('buildFollowUpLeadOwnerFilter matches assignee or creator fallback for the current user', () => {
  assert.deepEqual(buildFollowUpLeadOwnerFilter('user_1'), {
    OR: [
      { assignedToId: 'user_1' },
      { assignedToId: null, createdById: 'user_1' },
    ],
  });
});

test('buildFollowUpLeadOwnerFilter supports multiple visible owners', () => {
  assert.deepEqual(buildFollowUpLeadOwnerFilter(['u1', 'u2']), {
    OR: [
      { assignedToId: { in: ['u1', 'u2'] } },
      { assignedToId: null, createdById: { in: ['u1', 'u2'] } },
    ],
  });
  assert.equal(buildFollowUpLeadOwnerFilter('ALL'), undefined);
});


