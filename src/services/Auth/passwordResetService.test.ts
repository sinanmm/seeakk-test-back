import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createPasswordResetService, PasswordResetError, FORGOT_PASSWORD_GENERIC_MESSAGE } =
  require('./passwordResetService') as typeof import('./passwordResetService');

const NOW = new Date('2026-06-12T10:00:00.000Z');

const baseUser = {
  id: 'user_1',
  name: 'Test User',
  email: 'user@example.com',
  workspaceId: 'ws_1',
  deletedAt: null,
  isActive: true,
};

const buildService = (overrides: Partial<any> = {}) => {
  const sentEmails: any[] = [];
  const auditLogs: any[] = [];
  const invalidatedSessions: string[] = [];
  const createdTokens: any[] = [];
  const deletedTokenFilters: any[] = [];
  const transactions: any[] = [];

  const prismaMock = {
    user: {
      findFirst: overrides.findUser || (async () => baseUser),
      update: async (args: any) => transactions.push(['user.update', args]),
    },
    passwordResetToken: {
      findUnique: overrides.findToken || (async () => null),
      create: async (args: any) => {
        createdTokens.push(args.data);
        return { id: 'prt_1', ...args.data };
      },
      deleteMany: async (args: any) => deletedTokenFilters.push(args.where),
      update: async (args: any) => transactions.push(['token.update', args]),
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };

  const service = createPasswordResetService({
    prisma: prismaMock,
    tokenFactory: overrides.tokenFactory || (() => ({ rawToken: 'raw-reset-token-1234567890', tokenHash: 'hashed-reset-token' })),
    hashToken: overrides.hashToken || ((token: string) => `hashed:${token}`),
    hashPassword: async (password: string, rounds: number) => `bcrypt:${password}:${rounds}`,
    sendResetEmail:
      overrides.sendResetEmail ||
      (async (...args: any[]) => {
        sentEmails.push(args);
        return true;
      }),
    invalidateSessions: async (userId: string) => void invalidatedSessions.push(userId),
    audit: { log: async (payload: any) => void auditLogs.push(payload) },
    now: () => NOW,
  });

  return { service, sentEmails, auditLogs, invalidatedSessions, createdTokens, deletedTokenFilters, transactions };
};

const validTokenRecord = {
  id: 'prt_1',
  userId: 'user_1',
  tokenHash: 'hashed:raw-reset-token-1234567890',
  expiresAt: new Date('2026-06-12T10:30:00.000Z'),
  usedAt: null,
  user: baseUser,
};

test('requestReset stores only the token hash and emails the raw token', async () => {
  const { service, sentEmails, createdTokens, auditLogs } = buildService();

  const result = await service.requestReset('USER@example.com ', { ipAddress: '1.2.3.4' });

  assert.equal(result.message, FORGOT_PASSWORD_GENERIC_MESSAGE);
  assert.equal(createdTokens.length, 1);
  assert.equal(createdTokens[0].tokenHash, 'hashed-reset-token');
  assert.equal(createdTokens[0].requestedIp, '1.2.3.4');
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0][0], 'user@example.com');
  assert.equal(sentEmails[0][2], 'raw-reset-token-1234567890');
  assert.equal(auditLogs[0].action, 'PASSWORD_RESET_REQUESTED');
});

test('requestReset returns the same generic message for unknown emails and sends nothing', async () => {
  const { service, sentEmails, createdTokens } = buildService({ findUser: async () => null });

  const result = await service.requestReset('nobody@example.com');

  assert.equal(result.message, FORGOT_PASSWORD_GENERIC_MESSAGE);
  assert.equal(sentEmails.length, 0);
  assert.equal(createdTokens.length, 0);
});

test('requestReset invalidates previous unused tokens before issuing a new one', async () => {
  const { service, deletedTokenFilters } = buildService();

  await service.requestReset('user@example.com');

  assert.equal(deletedTokenFilters.length, 1);
  assert.deepEqual(deletedTokenFilters[0].OR[0], { userId: 'user_1', usedAt: null });
});

test('validateToken returns masked email for a valid token', async () => {
  const { service } = buildService({ findToken: async () => validTokenRecord });

  const result = await service.validateToken('raw-reset-token-1234567890');

  assert.equal(result.valid, true);
  assert.match(result.email, /^us\*+@example\.com$/);
});

test('validateToken rejects unknown, used, and expired tokens with generic message', async () => {
  const cases = [
    { record: null, code: 'RESET_TOKEN_INVALID', status: 400 },
    { record: { ...validTokenRecord, usedAt: new Date('2026-06-12T09:00:00.000Z') }, code: 'RESET_TOKEN_USED', status: 410 },
    { record: { ...validTokenRecord, expiresAt: new Date('2026-06-12T09:59:59.000Z') }, code: 'RESET_TOKEN_EXPIRED', status: 410 },
    { record: { ...validTokenRecord, user: { ...baseUser, isActive: false } }, code: 'RESET_TOKEN_INVALID', status: 400 },
  ];

  const genericMessage = 'This password reset link is invalid or has expired. Please request a new one.';
  for (const { record, code, status } of cases) {
    const { service } = buildService({ findToken: async () => record });
    await assert.rejects(
      () => service.validateToken('raw-reset-token-1234567890'),
      (error: any) => {
        assert.ok(error instanceof PasswordResetError);
        assert.equal(error.code, code);
        assert.equal(error.statusCode, status);
        // Same message in every failure case so the reason is never leaked.
        assert.equal(error.message, genericMessage);
        return true;
      },
    );
  }
});

test('resetPassword hashes password, marks token used, invalidates sessions, and audits', async () => {
  const { service, transactions, invalidatedSessions, auditLogs } = buildService({
    findToken: async () => validTokenRecord,
  });

  const result = await service.resetPassword('raw-reset-token-1234567890', 'NewStrongPass123');

  const userUpdate = transactions.find(([op]) => op === 'user.update');
  assert.equal(userUpdate[1].data.password, 'bcrypt:NewStrongPass123:12');
  const tokenUpdate = transactions.find(([op]) => op === 'token.update');
  assert.equal(tokenUpdate[1].data.usedAt, NOW);
  assert.deepEqual(invalidatedSessions, ['user_1']);
  assert.equal(auditLogs[auditLogs.length - 1].action, 'PASSWORD_RESET');
  assert.match(result.message, /Password updated/);
});

test('resetPassword rejects a replayed (already used) token', async () => {
  const { service, transactions } = buildService({
    findToken: async () => ({ ...validTokenRecord, usedAt: new Date('2026-06-12T09:30:00.000Z') }),
  });

  await assert.rejects(
    () => service.resetPassword('raw-reset-token-1234567890', 'NewStrongPass123'),
    (error: any) => error instanceof PasswordResetError && error.code === 'RESET_TOKEN_USED',
  );
  assert.equal(transactions.length, 0);
});
