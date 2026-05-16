import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FRONTEND_URL = 'https://app.example.com';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildInviteAcceptUrl, resolveAdminFrontendOrigin } = require('./inviteLinks') as typeof import('./inviteLinks');

test('buildInviteAcceptUrl uses FRONTEND_URL and encodes token', () => {
  const url = buildInviteAcceptUrl('raw token+1');
  assert.equal(url, 'https://app.example.com/activate-account?token=raw%20token%2B1');
});

test('buildInviteAcceptUrl prefers admin UI origin when provided', () => {
  const url = buildInviteAcceptUrl('abc', 'https://admin.vercel.app');
  assert.equal(url, 'https://admin.vercel.app/activate-account?token=abc');
});

test('resolveAdminFrontendOrigin reads Origin header', () => {
  assert.equal(
    resolveAdminFrontendOrigin({ headers: { origin: 'https://lms.example.com' } }),
    'https://lms.example.com',
  );
});

test('resolveAdminFrontendOrigin falls back to Referer', () => {
  assert.equal(
    resolveAdminFrontendOrigin({
      headers: { referer: 'https://lms.example.com/admin/users?page=1' },
    }),
    'https://lms.example.com',
  );
});
