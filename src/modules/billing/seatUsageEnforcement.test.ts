import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../config/prisma';
import { getSeatUsage, verifySeatLimit } from './seatUsage.service';
import * as adminUserService from '../../services/User/adminUserService';

test('Seat Usage Enforcement Test Suite', async (t) => {
  // Helper to generate unique email
  const getUniqueEmail = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`;

  // Create test workspace owner
  const ownerUser = await prisma.user.create({
    data: {
      name: 'Owner User',
      email: getUniqueEmail('owner'),
      password: 'dummyhashedpassword',
      isActive: true,
      isOnboarded: true,
    },
  });

  // Create test workspace with approvedUserLimit = 6
  const workspace = await prisma.workspace.create({
    data: {
      companyName: 'Seat Test Company',
      employeeCount: '1-10',
      ownerId: ownerUser.id,
      billingStatus: 'ACTIVE',
      approvedUserLimit: 6,
      accessUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // Keep track of created user IDs for cleanup
  const createdUserIds: string[] = [ownerUser.id];

  const cleanup = async () => {
    try {
      await prisma.graceRecord.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.userLocationAssignment.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.user.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup error
    }
  };

  try {
    // Note: ownerUser does not have workspaceId set yet until associated or users are created in workspace.
    // 1. Initial state: 0 active users in workspace
    let usage = await getSeatUsage(workspace.id);
    assert.equal(usage.approvedUserLimit, 6);
    assert.equal(usage.activeUserCount, 0);
    assert.equal(usage.availableUserCount, 6);

    // Create 5 active users (users 1 to 5)
    for (let i = 1; i <= 5; i++) {
      const result = await adminUserService.createUser(
        {
          name: `User ${i}`,
          email: getUniqueEmail(`user${i}`),
          password: 'Password123!',
        },
        workspace.id,
        ownerUser.id
      );
      createdUserIds.push(result.user.id);
    }

    // 2. Limit 6, current users 5 -> creation of 6th user succeeds
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 5);
    assert.equal(usage.availableUserCount, 1);

    const user6Result = await adminUserService.createUser(
      {
        name: 'User 6',
        email: getUniqueEmail('user6'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );
    assert.ok(user6Result.user.id);
    createdUserIds.push(user6Result.user.id);

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);
    assert.equal(usage.availableUserCount, 0);

    // 3. Limit 6, current users 6 -> creation of 7th user MUST fail
    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          {
            name: 'User 7',
            email: getUniqueEmail('user7'),
            password: 'Password123!',
          },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.equal(
          err.message,
          'User limit reached. This workspace has reached its maximum of 6 users. Please remove an existing user or contact your administrator to increase the user limit.'
        );
        return true;
      }
    );

    // Invariant: activeUserCount remains 6
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);

    // 4. Limit 6, current users 7 -> creation remains blocked (simulating existing production bug condition)
    // Manually force an extra user to reach 7 active users
    const forcedUser7 = await prisma.user.create({
      data: {
        name: 'Forced User 7',
        email: getUniqueEmail('forced7'),
        password: 'dummy',
        workspaceId: workspace.id,
        isActive: true,
      },
    });
    createdUserIds.push(forcedUser7.id);

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 7);

    // Attempting to create another user must remain strictly blocked
    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          {
            name: 'User 8',
            email: getUniqueEmail('user8'),
            password: 'Password123!',
          },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(
          err.message,
          'User limit reached. This workspace has reached its maximum of 6 users. Please remove an existing user or contact your administrator to increase the user limit.'
        );
        return true;
      }
    );

    // 5. Removing/deactivating a user frees capacity and subsequent user creation succeeds
    // Soft-delete forced user 7 and deactivate user 6
    await prisma.user.update({
      where: { id: forcedUser7.id },
      data: { deletedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: user6Result.user.id },
      data: { isActive: false },
    });

    // Now active count should be 5
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 5);
    assert.equal(usage.availableUserCount, 1);

    // Creating a replacement user now succeeds
    const replacementUser = await adminUserService.createUser(
      {
        name: 'Replacement User',
        email: getUniqueEmail('replacement'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );
    assert.ok(replacementUser.user.id);
    createdUserIds.push(replacementUser.user.id);

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);

    // 6. Grace period behaviour follows existing implementation
    // Add an active GraceRecord with allowedUserLimit: 4
    const graceRecord = await prisma.graceRecord.create({
      data: {
        workspaceId: workspace.id,
        allowedUserLimit: 4,
        graceFrom: new Date(),
        graceUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
        reason: 'Temporary grace test',
        grantedBy: 'PLATFORM_OWNER',
      },
    });

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.entitlementSource, 'GRACE');
    assert.equal(usage.approvedUserLimit, 4);
    assert.equal(usage.effectiveUserLimit, 4);

    // Since active users = 6 and grace limit = 4, creation must fail with limit 4 message
    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          {
            name: 'Grace Exceeded User',
            email: getUniqueEmail('grace_exceeded'),
            password: 'Password123!',
          },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(
          err.message,
          'User limit reached. This workspace has reached its maximum of 4 users. Please remove an existing user or contact your administrator to increase the user limit.'
        );
        return true;
      }
    );

    // Revoke grace record to restore normal limit of 6
    await prisma.graceRecord.update({
      where: { id: graceRecord.id },
      data: { status: 'REVOKED' },
    });

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.entitlementSource, 'PAID');
    assert.equal(usage.approvedUserLimit, 6);

    // 7. Company-specific override takes precedence / updating limit dynamically
    // Update company limit via workspace update (simulating Control Software limit push)
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { approvedUserLimit: 8 },
    });

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.effectiveUserLimit, 8);
    assert.equal(usage.availableUserCount, 2);

    // Now 7th user can be created
    const user7Success = await adminUserService.createUser(
      {
        name: 'User 7 Allowed',
        email: getUniqueEmail('user7_ok'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );
    assert.ok(user7Success.user.id);
    createdUserIds.push(user7Success.user.id);

    // Restore limit back to 7
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { approvedUserLimit: 7 },
    });

    // 8. Concurrency protection: Simultaneous creation requests cannot exceed limit
    // Current active users: 7. Limit: 8. Exactly 1 seat available!
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { approvedUserLimit: 8 },
    });
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 7);
    assert.equal(usage.availableUserCount, 1);

    const concurrentAttempts = await Promise.allSettled([
      adminUserService.createUser(
        {
          name: 'Concurrent User A',
          email: getUniqueEmail('concurrent_a'),
          password: 'Password123!',
        },
        workspace.id,
        ownerUser.id
      ),
      adminUserService.createUser(
        {
          name: 'Concurrent User B',
          email: getUniqueEmail('concurrent_b'),
          password: 'Password123!',
        },
        workspace.id,
        ownerUser.id
      ),
    ]);

    const fulfilled = concurrentAttempts.filter((r) => r.status === 'fulfilled');
    const rejected = concurrentAttempts.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must fail
    assert.equal(fulfilled.length, 1, 'Exactly one concurrent request must succeed');
    assert.equal(rejected.length, 1, 'Exactly one concurrent request must be rejected');

    const rejectedReason: any = (rejected[0] as PromiseRejectedResult).reason;
    assert.equal(rejectedReason.statusCode, 400);
    assert.equal(
      rejectedReason.message,
      'User limit reached. This workspace has reached its maximum of 8 users. Please remove an existing user or contact your administrator to increase the user limit.'
    );

    // Invariant: Total active users in workspace is capped exactly at 8
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 8);
    assert.equal(usage.availableUserCount, 0);

  } finally {
    await cleanup();
  }
});
