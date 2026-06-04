import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLeadAssigneeFilter } from './followupService';

test('resolveLeadAssigneeFilter returns no lead filter when scope is ALL and assignee is ALL', () => {
  assert.deepEqual(resolveLeadAssigneeFilter('ALL', 'ALL'), {});
  assert.deepEqual(resolveLeadAssigneeFilter(undefined, 'ALL'), {});
});

test('resolveLeadAssigneeFilter scopes ALL assignee to manageable user ids', () => {
  assert.deepEqual(resolveLeadAssigneeFilter('ALL', ['u1', 'u2']), {
    leadAssignedToId: { in: ['u1', 'u2'] },
  });
});

test('resolveLeadAssigneeFilter targets a single lead assignee', () => {
  assert.deepEqual(resolveLeadAssigneeFilter('user_a', 'ALL'), {
    leadAssignedToId: 'user_a',
  });
});

test('resolveLeadAssigneeFilter rejects assignee outside scope', () => {
  assert.throws(
    () => resolveLeadAssigneeFilter('outsider', ['u1']),
    (error: Error & { statusCode?: number }) => error.statusCode === 403,
  );
});
