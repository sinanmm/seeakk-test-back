import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLockSubjectMatchesAssignment,
  getAssignedUserId,
  isNonAssigneeStakeholderOnAssignment,
  shouldSkipLockForExemptPeriod,
} from './targetLockEvaluation.service';

test('assertLockSubjectMatchesAssignment rejects locking non-assigned users', () => {
  const assignment = {
    id: 'asg_1',
    userId: 'david',
    assignedById: 'john_supervisor',
    targetCycleId: 'cycle_1',
  };

  assert.equal(assertLockSubjectMatchesAssignment(assignment, 'david'), true);
  assert.equal(assertLockSubjectMatchesAssignment(assignment, 'john_supervisor'), false);
  assert.equal(getAssignedUserId(assignment), 'david');
  assert.equal(
    isNonAssigneeStakeholderOnAssignment(assignment, 'john_supervisor', 'john_supervisor'),
    true,
  );
  assert.equal(isNonAssigneeStakeholderOnAssignment(assignment, 'david', 'john_supervisor'), false);
});

test('shouldSkipLockForExemptPeriod skips re-lock during exempted period', () => {
  const assignment = {
    id: 'asg_1',
    userId: 'user_1',
    targetCycleId: 'cycle_1',
    isLockExempt: true,
    exemptPeriodId: 'period_1',
    exemptUntilPeriodEnd: new Date('2026-06-07T23:59:59.000Z'),
  };

  const period = {
    id: 'period_1',
    periodIndex: 1,
    endDate: new Date('2026-06-07T23:59:59.000Z'),
  };

  assert.equal(shouldSkipLockForExemptPeriod(assignment, period), true);
  assert.equal(
    shouldSkipLockForExemptPeriod(assignment, {
      id: 'period_2',
      periodIndex: 2,
      endDate: new Date('2026-06-14T23:59:59.000Z'),
    }),
    false,
  );
});
