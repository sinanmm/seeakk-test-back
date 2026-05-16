import test from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getInviteSendBlockReason,
  toInviteEligibilityUser,
  userHasActivatedAccount,
  userIsInvitePending,
} = require('./inviteEligibility') as typeof import('./inviteEligibility');

test('userIsInvitePending is true for inactive unverified users with a role', () => {
  assert.equal(
    userIsInvitePending({
      isActive: false,
      isEmailVerified: false,
      isOnboarded: false,
      hasPassword: false,
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
      hasPassword: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('userIsInvitePending stays true when active but has no password', () => {
  assert.equal(
    userIsInvitePending({
      isActive: true,
      isEmailVerified: true,
      isOnboarded: true,
      hasPassword: false,
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
      hasPassword: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('userHasActivatedAccount is false when hasPassword is false', () => {
  assert.equal(
    userHasActivatedAccount({
      isActive: true,
      isEmailVerified: true,
      isOnboarded: true,
      hasPassword: false,
    }),
    false,
  );
});

test('toInviteEligibilityUser derives hasPassword from password field', () => {
  const mapped = toInviteEligibilityUser({
    password: '$2a$12$hash',
    isActive: true,
    isEmailVerified: true,
    isOnboarded: true,
    role: { id: 'role_1' },
  });
  assert.equal(mapped.hasPassword, true);
  assert.equal(userHasActivatedAccount(mapped), true);
});

test('getInviteSendBlockReason requires a role', () => {
  assert.match(
    getInviteSendBlockReason({
      isActive: false,
      isEmailVerified: false,
      isOnboarded: false,
      hasPassword: false,
      role: null,
    }) || '',
    /Assign a role/i,
  );
});

test('getInviteSendBlockReason allows active accounts', () => {
  assert.equal(
    getInviteSendBlockReason({
      isActive: true,
      isEmailVerified: true,
      isOnboarded: true,
      hasPassword: true,
      role: { id: 'role_1' },
    }),
    null,
  );
});
