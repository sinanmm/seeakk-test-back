import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../config/prisma';
import { getSeatUsage, verifySeatLimit } from './seatUsage.service';
import * as adminUserService from '../../services/User/adminUserService';
import { inviteService } from '../invites/invite.service';
import * as inviteRepository from '../invites/invite.repository';

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

  // Keep track of created user IDs and second workspace for cleanup
  const createdUserIds: string[] = [ownerUser.id];
  let workspace2: any = null;
  let ownerUser2: any = null;

  const cleanup = async () => {
    try {
      const wsIds = [workspace.id, workspace2?.id].filter(Boolean);
      await prisma.graceRecord.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await prisma.userLocationAssignment.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await prisma.invite.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await prisma.user.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await prisma.role.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
      if (ownerUser?.id) await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
      if (ownerUser2?.id) await prisma.user.delete({ where: { id: ownerUser2.id } }).catch(() => {});
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

    // 9. Invitation creation is rejected when seat limit is reached
    // Create a role for invite testing
    const testRole = await prisma.role.create({
      data: {
        name: 'Seat Test Role',
        workspaceId: workspace.id,
      },
    });

    await assert.rejects(
      async () => {
        await inviteService.createInvite(
          {
            name: 'Invite Overflow User',
            email: getUniqueEmail('invite_overflow'),
            roleId: testRole.id,
          },
          { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        return true;
      }
    );

    // Direct repository invite creation is also blocked with row-level locking
    await assert.rejects(
      async () => {
        await inviteRepository.createInvitedUserWithInvite({
          workspaceId: workspace.id,
          createdBy: ownerUser.id,
          tokenHash: 'dummy_overflow_token_hash',
          expiresAt: new Date(Date.now() + 86400000),
          userData: {
            name: 'Direct Repo Overflow',
            email: getUniqueEmail('direct_overflow'),
            roleId: testRole.id,
          },
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        return true;
      }
    );

    // 10. Invitation acceptance cannot bypass seat limit
    // Increase limit to 9 so exactly 1 seat is available
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { approvedUserLimit: 9 },
    });
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 8);
    assert.equal(usage.availableUserCount, 1);

    // Create an invite while capacity allows
    const validInviteResult = await inviteService.createInvite(
      {
        name: 'Pending Invitee',
        email: getUniqueEmail('pending_invitee'),
        roleId: testRole.id,
      },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );
    assert.ok(validInviteResult.inviteLink);

    // Extract token from invite link
    const inviteUrl = new URL(validInviteResult.inviteLink!);
    const rawToken = inviteUrl.searchParams.get('token')!;
    assert.ok(rawToken);

    // Fill the last available seat directly before invite is accepted
    const user9 = await adminUserService.createUser(
      {
        name: 'User 9',
        email: getUniqueEmail('user9'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );
    assert.ok(user9.user.id);
    createdUserIds.push(user9.user.id);

    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 9);
    assert.equal(usage.availableUserCount, 0);

    // Now accepting the pending invite MUST fail because capacity is full
    await assert.rejects(
      async () => {
        await inviteService.acceptInvite({
          token: rawToken,
          password: 'Password123!',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        return true;
      }
    );

    // 11. Different companies have independent limits
    ownerUser2 = await prisma.user.create({
      data: {
        name: 'Owner User 2',
        email: getUniqueEmail('owner2'),
        password: 'dummyhashedpassword',
        isActive: true,
        isOnboarded: true,
      },
    });

    workspace2 = await prisma.workspace.create({
      data: {
        companyName: 'Second Company',
        employeeCount: '1-5',
        ownerId: ownerUser2.id,
        billingStatus: 'ACTIVE',
        approvedUserLimit: 2,
        accessUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    let usage2 = await getSeatUsage(workspace2.id);
    assert.equal(usage2.effectiveUserLimit, 2);
    assert.equal(usage2.activeUserCount, 0);
    assert.equal(usage2.availableUserCount, 2);

    // Workspace 1 remains unaffected at 9 users
    usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 9);
    assert.equal(usage.availableUserCount, 0);

    // Create 2 users in workspace 2
    const ws2User1 = await adminUserService.createUser(
      { name: 'WS2 User 1', email: getUniqueEmail('ws2_u1'), password: 'Password123!' },
      workspace2.id,
      ownerUser2.id
    );
    const ws2User2 = await adminUserService.createUser(
      { name: 'WS2 User 2', email: getUniqueEmail('ws2_u2'), password: 'Password123!' },
      workspace2.id,
      ownerUser2.id
    );
    createdUserIds.push(ws2User1.user.id, ws2User2.user.id);

    usage2 = await getSeatUsage(workspace2.id);
    assert.equal(usage2.activeUserCount, 2);
    assert.equal(usage2.availableUserCount, 0);

    // 3rd user in workspace 2 must fail
    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          { name: 'WS2 User 3', email: getUniqueEmail('ws2_u3'), password: 'Password123!' },
          workspace2.id,
          ownerUser2.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 2 users/);
        return true;
      }
    );

  } finally {
    await cleanup();
  }
});
