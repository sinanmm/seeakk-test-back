import test from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getInviteSendBlockReason,
  userHasActivatedAccount,
  userIsInvitePending,
} = require('./inviteEligibility') as typeof import('./inviteEligibility');

test('userIsInvitePending is true for inactive unverified users with a role', () => {
  assert.equal(
    userIsInvitePending({
      isActive: false,
      isEmailVerified: false,
      isOnboarded: false,
      role: { id: 'role_1', name: 'Executive' },
    }),
    true,
  );
});

test('userIsInvitePending is false for fully onboarded accounts', () => {
  assert.equal(
    userIsInvitePending({
      isActive: true,
      isEmailVerified: true,
      isOnboarded: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('userIsInvitePending stays true when isActive is true but user has not onboarded', () => {
  assert.equal(
    userIsInvitePending({
      isActive: true,
      isEmailVerified: false,
      isOnboarded: false,
      role: { id: 'role_1' },
    }),
    true,
  );
});

test('userIsInvitePending is false for deactivated verified accounts', () => {
  assert.equal(
    userIsInvitePending({
      isActive: false,
      isEmailVerified: true,
      isOnboarded: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('userHasActivatedAccount is false when isOnboarded is explicitly false', () => {
  assert.equal(
    userHasActivatedAccount({
      isActive: true,
      isEmailVerified: true,
      isOnboarded: false,
    }),
    false,
  );
});

test('getInviteSendBlockReason requires a role', () => {
  assert.match(
    getInviteSendBlockReason({ isActive: false, isEmailVerified: false, isOnboarded: false, role: null }) || '',
    /Assign a role/i,
  );
});
