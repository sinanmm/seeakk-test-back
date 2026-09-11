import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../config/prisma';
import { getSeatUsage, verifySeatLimit } from './seatUsage.service';
import * as adminUserService from '../../services/User/adminUserService';
import { inviteService } from '../invites/invite.service';
import * as inviteRepository from '../invites/invite.repository';

// Helper to generate unique email
const getUniqueEmail = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`;

// Fixture helper to create an isolated workspace with a given limit and pre-populated active users
async function createTestFixture(options: {
  approvedUserLimit?: number;
  activeUsers?: number;
  billingStatus?: string;
}) {
  const limit = options.approvedUserLimit ?? 6;
  const initialActive = options.activeUsers ?? 0;

  // 1. Create workspace owner (not associated with workspace yet)
  const ownerUser = await prisma.user.create({
    data: {
      name: 'Owner User',
      email: getUniqueEmail('fixture_owner'),
      password: 'dummyhashedpassword',
      isActive: true,
      isOnboarded: true,
    },
  });

  // 2. Create workspace with approvedUserLimit
  const workspace = await prisma.workspace.create({
    data: {
      companyName: `Test Company ${Date.now()}`,
      employeeCount: '1-10',
      ownerId: ownerUser.id,
      billingStatus: options.billingStatus ?? 'ACTIVE',
      approvedUserLimit: limit,
      accessUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // 3. Create default role for workspace
  const role = await prisma.role.create({
    data: {
      name: `Role_${Date.now()}`,
      workspaceId: workspace.id,
    },
  });

  // 4. Pre-populate active users directly in DB
  const preCreatedUsers = [];
  for (let i = 1; i <= initialActive; i++) {
    const u = await prisma.user.create({
      data: {
        name: `Active User ${i}`,
        email: getUniqueEmail(`active_${i}`),
        password: 'dummyhashedpassword',
        workspaceId: workspace.id,
        isActive: true,
        roleId: role.id,
      },
    });
    preCreatedUsers.push(u);
  }

  const cleanup = async () => {
    try {
      await prisma.graceRecord.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.userLocationAssignment.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.invite.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.user.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.role.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup error
    }
  };

  return { workspace, ownerUser, role, preCreatedUsers, cleanup };
}

test('TEST 1: Limit = 6, Active users = 5, Create user -> Expected: SUCCESS', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    const result = await adminUserService.createUser(
      {
        name: 'User 6',
        email: getUniqueEmail('user6'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );
    assert.ok(result.user.id, 'User 6 was created successfully');

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);
    assert.equal(usage.availableUserCount, 0);
  } finally {
    await cleanup();
  }
});

test('TEST 2: Limit = 6, Active users = 6, Create user -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 6 });
  try {
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
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6, 'Active user count must remain 6');
  } finally {
    await cleanup();
  }
});

test('TEST 3: Limit = 6, Active users = 7, Create user -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 7 });
  try {
    // Current state has 7 users with limit 6 (existing production scenario)
    const initialUsage = await getSeatUsage(workspace.id);
    assert.equal(initialUsage.activeUserCount, 7);

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
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 7, 'User 7 must NOT be deleted or modified');
  } finally {
    await cleanup();
  }
});

test('TEST 4: Limit = 6, Active users = 5, Create invitation -> Expected: SUCCESS', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    const result = await inviteService.createInvite(
      {
        name: 'Invited User 6',
        email: getUniqueEmail('invite_success'),
        roleId: role.id,
      },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );
    assert.ok(result.invite.id, 'Invitation was created successfully');
    assert.ok(result.inviteLink, 'Invite link was generated');
  } finally {
    await cleanup();
  }
});

test('TEST 5: Limit = 6, Active users = 6, Create invitation -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 6 });
  try {
    await assert.rejects(
      async () => {
        await inviteService.createInvite(
          {
            name: 'Overflow Invitee',
            email: getUniqueEmail('invite_overflow'),
            roleId: role.id,
          },
          { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test('TEST 6: Limit = 6, Active users = 5, Accept invitation -> Expected: SUCCESS', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    const inviteResult = await inviteService.createInvite(
      {
        name: 'Pending Invitee',
        email: getUniqueEmail('accept_pending'),
        roleId: role.id,
      },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );
    const inviteUrl = new URL(inviteResult.inviteLink!);
    const rawToken = inviteUrl.searchParams.get('token')!;
    assert.ok(rawToken);

    // Accept invite
    const acceptResult = await inviteService.acceptInvite({
      token: rawToken,
      password: 'Password123!',
    });
    assert.ok(acceptResult.user.id, 'Invite accepted successfully');

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6, 'Active user count reached 6');
  } finally {
    await cleanup();
  }
});

test('TEST 7: Limit = 6, Active users = 6, Accept invitation -> Expected: USER_LIMIT_REACHED', async () => {
  // Create fixture with 5 active users so an invite can initially be created
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    const inviteResult = await inviteService.createInvite(
      {
        name: 'Pending Invitee',
        email: getUniqueEmail('accept_overflow'),
        roleId: role.id,
      },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );
    const inviteUrl = new URL(inviteResult.inviteLink!);
    const rawToken = inviteUrl.searchParams.get('token')!;
    assert.ok(rawToken);

    // Now fill the last seat with a direct user creation so active user count reaches 6
    await adminUserService.createUser(
      {
        name: 'Direct User 6',
        email: getUniqueEmail('direct6'),
        password: 'Password123!',
      },
      workspace.id,
      ownerUser.id
    );

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);

    // Now attempting to accept the pending invite MUST fail because capacity is full
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
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );

    // Active count must remain strictly 6
    const finalUsage = await getSeatUsage(workspace.id);
    assert.equal(finalUsage.activeUserCount, 6);
  } finally {
    await cleanup();
  }
});

test('TEST 8: Limit = 6, Active users = 5, Reactivate inactive user -> Expected: SUCCESS', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    // Create an inactive user in this workspace
    const inactiveUser = await prisma.user.create({
      data: {
        name: 'Inactive User',
        email: getUniqueEmail('inactive_u'),
        password: 'dummyhashedpassword',
        workspaceId: workspace.id,
        isActive: false,
        roleId: role.id,
      },
    });

    const usageBefore = await getSeatUsage(workspace.id);
    assert.equal(usageBefore.activeUserCount, 5);

    // Reactivate user
    const updated = await adminUserService.updateUserStatus(
      inactiveUser.id,
      { isActive: true },
      workspace.id,
      ownerUser.id
    );
    assert.ok(updated);

    const usageAfter = await getSeatUsage(workspace.id);
    assert.equal(usageAfter.activeUserCount, 6);
  } finally {
    await cleanup();
  }
});

test('TEST 9: Limit = 6, Active users = 6, Reactivate inactive user -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 6 });
  try {
    // Create an inactive user in this workspace
    const inactiveUser = await prisma.user.create({
      data: {
        name: 'Inactive User',
        email: getUniqueEmail('inactive_fail'),
        password: 'dummyhashedpassword',
        workspaceId: workspace.id,
        isActive: false,
        roleId: role.id,
      },
    });

    await assert.rejects(
      async () => {
        await adminUserService.updateUserStatus(
          inactiveUser.id,
          { isActive: true },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6);
  } finally {
    await cleanup();
  }
});

test('TEST 10: Grace Period active, Grace allowedUserLimit = 6, Active users = 6, Create user -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 10, activeUsers: 6 });
  try {
    // Create an active grace record restricting the workspace to 6 users
    const graceRecord = await prisma.graceRecord.create({
      data: {
        workspaceId: workspace.id,
        allowedUserLimit: 6,
        graceFrom: new Date(),
        graceUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
        reason: 'Temporary grace limit',
        grantedBy: 'PLATFORM_ADMIN',
      },
    });

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.entitlementSource, 'GRACE');
    assert.equal(usage.effectiveUserLimit, 6);

    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          {
            name: 'Grace Limit Exceeded User',
            email: getUniqueEmail('grace_fail'),
            password: 'Password123!',
          },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test('TEST 11: Control Software approvedUserLimit = 6, SEEAKK approvedUserLimit = 6, Active users = 6, Create user -> Expected: USER_LIMIT_REACHED', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 6 });
  try {
    // Verify approvedUserLimit in SEEAKK workspace is 6
    const ws = await prisma.workspace.findUnique({
      where: { id: workspace.id },
      select: { approvedUserLimit: true },
    });
    assert.equal(ws?.approvedUserLimit, 6);

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.effectiveUserLimit, 6);
    assert.equal(usage.activeUserCount, 6);

    await assert.rejects(
      async () => {
        await adminUserService.createUser(
          {
            name: 'User 7 Over Limit',
            email: getUniqueEmail('user7_over'),
            password: 'Password123!',
          },
          workspace.id,
          ownerUser.id
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'USER_LIMIT_REACHED');
        assert.match(err.message, /maximum of 6 users/);
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test('TEST 12: Concurrent user creation: Limit = 6, Active users = 5, Two simultaneous user creation requests', async () => {
  const { workspace, ownerUser, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    const usageBefore = await getSeatUsage(workspace.id);
    assert.equal(usageBefore.activeUserCount, 5);
    assert.equal(usageBefore.availableUserCount, 1);

    // Two simultaneous direct creation requests targeting the last remaining seat
    const [resA, resB] = await Promise.allSettled([
      adminUserService.createUser(
        {
          name: 'Concurrent User A',
          email: getUniqueEmail('conc_a'),
          password: 'Password123!',
        },
        workspace.id,
        ownerUser.id
      ),
      adminUserService.createUser(
        {
          name: 'Concurrent User B',
          email: getUniqueEmail('conc_b'),
          password: 'Password123!',
        },
        workspace.id,
        ownerUser.id
      ),
    ]);

    const successes = [resA, resB].filter((r) => r.status === 'fulfilled');
    const failures = [resA, resB].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly ONE concurrent creation request must succeed');
    assert.equal(failures.length, 1, 'Exactly ONE concurrent creation request must be rejected');

    const err: any = (failures[0] as PromiseRejectedResult).reason;
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'USER_LIMIT_REACHED');

    const usageAfter = await getSeatUsage(workspace.id);
    assert.equal(usageAfter.activeUserCount, 6, 'Final active user count must be exactly 6');
    assert.equal(usageAfter.availableUserCount, 0);
  } finally {
    await cleanup();
  }
});

test('TEST 13: Concurrent invitation acceptance: Limit = 6, Active users = 5, Two simultaneous accept operations', async () => {
  const { workspace, ownerUser, role, cleanup } = await createTestFixture({ approvedUserLimit: 6, activeUsers: 5 });
  try {
    // Create two invites when active users = 5
    // Note: To create the two invites for concurrent testing, temporarily permit invite creation
    await prisma.workspace.update({ where: { id: workspace.id }, data: { approvedUserLimit: 7 } });

    const invite1 = await inviteService.createInvite(
      { name: 'Invitee 1', email: getUniqueEmail('inv1'), roleId: role.id },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );
    const invite2 = await inviteService.createInvite(
      { name: 'Invitee 2', email: getUniqueEmail('inv2'), roleId: role.id },
      { id: ownerUser.id, workspaceId: workspace.id, name: 'Owner' }
    );

    // Set limit back to 6 (Active = 5, Limit = 6 -> exactly 1 seat left)
    await prisma.workspace.update({ where: { id: workspace.id }, data: { approvedUserLimit: 6 } });

    const token1 = new URL(invite1.inviteLink!).searchParams.get('token')!;
    const token2 = new URL(invite2.inviteLink!).searchParams.get('token')!;

    // Two simultaneous accept operations racing for the 6th seat
    const [acc1, acc2] = await Promise.allSettled([
      inviteService.acceptInvite({ token: token1, password: 'Password123!' }),
      inviteService.acceptInvite({ token: token2, password: 'Password123!' }),
    ]);

    const successes = [acc1, acc2].filter((r) => r.status === 'fulfilled');
    const failures = [acc1, acc2].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly ONE concurrent invite acceptance must succeed');
    assert.equal(failures.length, 1, 'Exactly ONE concurrent invite acceptance must be rejected');

    const err: any = (failures[0] as PromiseRejectedResult).reason;
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'USER_LIMIT_REACHED');

    const usage = await getSeatUsage(workspace.id);
    assert.equal(usage.activeUserCount, 6, 'Final active user count must be strictly 6');
  } finally {
    await cleanup();
  }
});
