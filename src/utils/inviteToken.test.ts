import test from 'node:test';
import assert from 'node:assert/strict';
import { createInviteTokenPair, hashInviteToken } from './inviteToken';

test('hashInviteToken is deterministic and does not equal the raw token', () => {
  const rawToken = 'sample-invite-token';
  const hashA = hashInviteToken(rawToken);
  const hashB = hashInviteToken(rawToken);

  assert.equal(hashA, hashB);
  assert.notEqual(hashA, rawToken);
  assert.equal(hashA.length, 64);
});

test('createInviteTokenPair returns a raw token with a matching hash', () => {
  const { rawToken, tokenHash } = createInviteTokenPair();

  assert.ok(rawToken.length > 20);
  assert.equal(tokenHash, hashInviteToken(rawToken));
});
