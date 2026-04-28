import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require('../../config/prisma').default as any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { redisClient } = require('../../config/redis') as typeof import('../../config/redis');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const accountLockService = require('./accountLockService') as typeof import('./accountLockService');

test('unlockUser allows only the selected supervisor', async () => {
  const originalFindFirst = prisma.user.findFirst;
  const originalUpdate = prisma.user.update;
  const originalIsReady = redisClient.isReady;

  prisma.user.findFirst = async () => ({
    id: 'user_1',
    isLocked: true,
    supervisorId: 'sup_1',
    workspaceId: 'ws_1',
  });
  prisma.user.update = async () => ({
    id: 'user_1',
    isLocked: false,
  });
  Object.defineProperty(redisClient, 'isReady', { value: false, configurable: true });

  try {
    const unlocked = await accountLockService.unlockUser('user_1', 'ws_1', {
      id: 'sup_1',
      roleName: 'manager',
    });

    assert.equal(unlocked.id, 'user_1');
    assert.equal(unlocked.isLocked, false);

    await assert.rejects(
      () =>
        accountLockService.unlockUser('user_1', 'ws_1', {
          id: 'superadmin_1',
          roleName: 'superadmin',
        }),
      (error: any) => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /only the selected supervisor/i);
        return true;
      },
    );
  } finally {
    prisma.user.findFirst = originalFindFirst;
    prisma.user.update = originalUpdate;
    Object.defineProperty(redisClient, 'isReady', { value: originalIsReady, configurable: true });
  }
});
