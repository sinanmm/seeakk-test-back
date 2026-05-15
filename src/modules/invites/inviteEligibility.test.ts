import test from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getInviteSendBlockReason, userIsInvitePending } = require('./inviteEligibility') as typeof import('./inviteEligibility');

test('userIsInvitePending is true for inactive unverified users with a role', () => {
  assert.equal(
    userIsInvitePending({
      isActive: false,
      isEmailVerified: false,
      role: { id: 'role_1', name: 'Executive' },
    }),
    true,
  );
});

test('userIsInvitePending is false for active accounts', () => {
  assert.equal(
    userIsInvitePending({
      isActive: true,
      isEmailVerified: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('userIsInvitePending is false for deactivated accounts', () => {
  assert.equal(
    userIsInvitePending({
      isActive: false,
      isEmailVerified: true,
      role: { id: 'role_1' },
    }),
    false,
  );
});

test('getInviteSendBlockReason requires a role', () => {
  assert.match(
    getInviteSendBlockReason({ isActive: false, isEmailVerified: false, role: null }) || '',
    /Assign a role/i,
  );
});
