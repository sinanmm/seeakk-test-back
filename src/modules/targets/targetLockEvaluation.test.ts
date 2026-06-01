import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLockSubjectMatchesAssignment,
  getAssignedUserId,
  isNonAssigneeStakeholderOnAssignment,
  shouldSkipLockForExemptPeriod,
  isUserActingAsSupervisorOrStakeholder,
} from './targetLockEvaluation.service';

const prisma = require('../../config/prisma').default as any;

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

test('isUserActingAsSupervisorOrStakeholder matches supervisor roles and relations', async () => {
  const originalFindFirst = prisma.user.findFirst;
  const originalFindFirstAssignment = prisma.targetAssignment.findFirst;
  const originalFindFirstCycle = prisma.targetCycle.findFirst;
  const originalFindFirstUnlockLog = prisma.targetUnlockLog.findFirst;

  try {
    // Case 0: User is superadmin
    prisma.user.findFirst = async () => ({
      id: 'superadmin_id',
      role: { name: 'superadmin' },
    });
    prisma.targetAssignment.findFirst = async () => null;
    prisma.targetCycle.findFirst = async () => null;
    prisma.targetUnlockLog.findFirst = async () => null;

    let res = await isUserActingAsSupervisorOrStakeholder('superadmin_user');
    assert.equal(res, true);

    // Case 1: User has subordinates
    prisma.user.findFirst = async () => ({ id: 'subordinate_1' });
    prisma.targetAssignment.findFirst = async () => null;
    prisma.targetCycle.findFirst = async () => null;
    prisma.targetUnlockLog.findFirst = async () => null;

    res = await isUserActingAsSupervisorOrStakeholder('supervisor_1');
    assert.equal(res, true);

    // Case 2: User is target assigner
    prisma.user.findFirst = async () => null;
    prisma.targetAssignment.findFirst = async (args: any) => {
      if (args.where.assignedById) return { id: 'asg_1' };
      return null;
    };
    res = await isUserActingAsSupervisorOrStakeholder('assigner_1');
    assert.equal(res, true);

    // Case 3: User is supervisor on assignment
    prisma.targetAssignment.findFirst = async (args: any) => {
      if (args.where.supervisorId) return { id: 'asg_2' };
      return null;
    };
    res = await isUserActingAsSupervisorOrStakeholder('supervisor_2');
    assert.equal(res, true);

    // Case 4: User is creator of cycle
    prisma.targetAssignment.findFirst = async () => null;
    prisma.targetCycle.findFirst = async () => ({ id: 'cycle_1' });
    res = await isUserActingAsSupervisorOrStakeholder('creator_1');
    assert.equal(res, true);

    // Case 5: User unlocked someone
    prisma.targetCycle.findFirst = async () => null;
    prisma.targetUnlockLog.findFirst = async () => ({ id: 'log_1' });
    res = await isUserActingAsSupervisorOrStakeholder('unlocker_1');
    assert.equal(res, true);

    // Case 6: Plain user
    prisma.targetUnlockLog.findFirst = async () => null;
    res = await isUserActingAsSupervisorOrStakeholder('plain_user');
    assert.equal(res, false);

  } finally {
    prisma.user.findFirst = originalFindFirst;
    prisma.targetAssignment.findFirst = originalFindFirstAssignment;
    prisma.targetCycle.findFirst = originalFindFirstCycle;
    prisma.targetUnlockLog.findFirst = originalFindFirstUnlockLog;
  }
});
