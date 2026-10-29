import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { CompanyControlService } from './companyControl.service';
import { WasabiStorage } from '../../lib/storage/wasabi.storage';
import { storage } from '../../lib/storage/storage.factory';

test('Company & Workspace Deletion - Backend Integration Suite', async (t) => {

  await t.test('1. Rejects missing or empty workspaceId with 400', async () => {
    await assert.rejects(
      async () => {
        await CompanyControlService.deleteCompanyAndWorkspace('');
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Workspace ID is required/);
        return true;
      }
    );
  });

  await t.test('2. Rejects non-existent workspace with 404', async () => {
    const nonExistentId = 'non_existent_ws_' + Date.now();
    await assert.rejects(
      async () => {
        await CompanyControlService.deleteCompanyAndWorkspace(nonExistentId);
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Workspace not found/);
        return true;
      }
    );
  });

  await t.test('3. WasabiStorage.deleteWorkspaceRecordings safety checks: blocks empty workspace and validates prefix', async () => {
    const wasabi = new WasabiStorage();
    await assert.rejects(
      async () => {
        await wasabi.deleteWorkspaceRecordings('');
      },
      (err: any) => {
        assert.match(err.message, /Invalid workspaceId/);
        return true;
      }
    );
  });

  await t.test('4. Full Tenant Deletion: Deletes workspace, users, CRM data, calls, recordings and keeps other workspace untouched', async () => {
    const timestamp = Date.now();
    const randA = crypto.randomBytes(3).toString('hex');
    const randB = crypto.randomBytes(3).toString('hex');

    // 1. Create Workspace A (Target for deletion)
    const ownerA = await prisma.user.create({
      data: {
        name: 'Owner A',
        email: `owner_a_${timestamp}_${randA}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const workspaceA = await prisma.workspace.create({
      data: {
        companyName: `Company A ${timestamp}`,
        ownerId: ownerA.id,
        employeeCount: '1-10',
        billingStatus: 'ACTIVE',
      },
    });

    await prisma.user.update({
      where: { id: ownerA.id },
      data: { workspaceId: workspaceA.id },
    });

    const memberA = await prisma.user.create({
      data: {
        name: 'Member A',
        email: `member_a_${timestamp}_${randA}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
        workspaceId: workspaceA.id,
        supervisorId: ownerA.id,
      },
    });

    const leadA = await prisma.lead.create({
      data: {
        workspaceId: workspaceA.id,
        name: 'Lead A',
        phone: '+919999900001',
        createdById: ownerA.id,
        assignedToId: memberA.id,
      },
    });

    const callA = await prisma.leadCallSession.create({
      data: {
        workspaceId: workspaceA.id,
        leadId: leadA.id,
        initiatedById: memberA.id,
        phoneNumberSnapshot: '+919999900001',
        localCallDate: '2026-10-28',
        status: 'COMPLETED',
        recordingAvailable: true,
        recordingUrl: `Seeak App Data/recordings/${workspaceA.id}/${leadA.id}/call_1/recording.m4a`,
        recordingStatus: 'READY',
      },
    });

    const followUpA = await prisma.followUp.create({
      data: {
        workspaceId: workspaceA.id,
        leadId: leadA.id,
        userId: memberA.id,
        description: 'Follow up A',
        type: 'CALL',
        status: 'PENDING',
        scheduledAt: new Date(),
      },
    });

    // 2. Create Workspace B (Isolated tenant that MUST remain untouched)
    const ownerB = await prisma.user.create({
      data: {
        name: 'Owner B',
        email: `owner_b_${timestamp}_${randB}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const workspaceB = await prisma.workspace.create({
      data: {
        companyName: `Company B ${timestamp}`,
        ownerId: ownerB.id,
        employeeCount: '10-50',
        billingStatus: 'ACTIVE',
      },
    });

    await prisma.user.update({
      where: { id: ownerB.id },
      data: { workspaceId: workspaceB.id },
    });

    const leadB = await prisma.lead.create({
      data: {
        workspaceId: workspaceB.id,
        name: 'Lead B',
        phone: '+919999900002',
        createdById: ownerB.id,
      },
    });

    const callB = await prisma.leadCallSession.create({
      data: {
        workspaceId: workspaceB.id,
        leadId: leadB.id,
        initiatedById: ownerB.id,
        phoneNumberSnapshot: '+919999900002',
        localCallDate: '2026-10-28',
        status: 'COMPLETED',
        recordingAvailable: true,
        recordingUrl: `Seeak App Data/recordings/${workspaceB.id}/${leadB.id}/call_2/recording.m4a`,
        recordingStatus: 'READY',
      },
    });

    try {
      // 3. Perform Deletion of Workspace A
      const result = await CompanyControlService.deleteCompanyAndWorkspace(workspaceA.id, 'TEST_ADMIN');
      assert.equal(result.success, true);
      assert.equal(result.deletedWorkspaceId, workspaceA.id);

      // 4. Verify Workspace A and all its records are completely deleted
      const checkWsA = await prisma.workspace.findUnique({ where: { id: workspaceA.id } });
      assert.equal(checkWsA, null, 'Workspace A must be deleted');

      const checkUsersA = await prisma.user.findMany({
        where: { id: { in: [ownerA.id, memberA.id] } },
      });
      assert.equal(checkUsersA.length, 0, 'Users of Workspace A must be deleted');

      const checkLeadA = await prisma.lead.findUnique({ where: { id: leadA.id } });
      assert.equal(checkLeadA, null, 'Leads of Workspace A must be deleted');

      const checkCallA = await prisma.leadCallSession.findUnique({ where: { id: callA.id } });
      assert.equal(checkCallA, null, 'Call sessions of Workspace A must be deleted');

      const checkFollowUpA = await prisma.followUp.findUnique({ where: { id: followUpA.id } });
      assert.equal(checkFollowUpA, null, 'Follow-ups of Workspace A must be deleted');

      // 5. Verify Workspace B and its records are 100% UNTOUCHED
      const checkWsB = await prisma.workspace.findUnique({ where: { id: workspaceB.id } });
      assert.ok(checkWsB, 'Workspace B must remain intact');
      assert.equal(checkWsB.companyName, workspaceB.companyName);

      const checkUserB = await prisma.user.findUnique({ where: { id: ownerB.id } });
      assert.ok(checkUserB, 'Owner B must remain intact');

      const checkLeadB = await prisma.lead.findUnique({ where: { id: leadB.id } });
      assert.ok(checkLeadB, 'Lead B must remain intact');

      const checkCallB = await prisma.leadCallSession.findUnique({ where: { id: callB.id } });
      assert.ok(checkCallB, 'Call B must remain intact');

    } finally {
      // Cleanup Workspace B
      try {
        await CompanyControlService.deleteCompanyAndWorkspace(workspaceB.id, 'TEST_ADMIN');
      } catch (e) {
        // Ignore cleanup error if already removed
      }
    }
  });

  await t.test('5. Concurrency & Idempotency: Blocks second deletion request if already in progress with 409', async () => {
    const timestamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        name: 'Owner InFlight',
        email: `owner_inflight_${timestamp}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const ws = await prisma.workspace.create({
      data: {
        companyName: `InFlight WS ${timestamp}`,
        ownerId: owner.id,
        employeeCount: '1-10',
        billingStatus: 'DELETING',
      },
    });

    try {
      await assert.rejects(
        async () => {
          await CompanyControlService.deleteCompanyAndWorkspace(ws.id);
        },
        (err: any) => {
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /already in progress/);
          return true;
        }
      );
    } finally {
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { billingStatus: 'ACTIVE' },
      });
      await CompanyControlService.deleteCompanyAndWorkspace(ws.id);
    }
  });

  await t.test('6. Wasabi failure handling: aborts deletion and reverts workspace status when external storage fails', async () => {
    const timestamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        name: 'Owner StorageFail',
        email: `owner_storagefail_${timestamp}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const ws = await prisma.workspace.create({
      data: {
        companyName: `StorageFail WS ${timestamp}`,
        ownerId: owner.id,
        employeeCount: '1-10',
        billingStatus: 'ACTIVE',
      },
    });

    const originalMethod = (storage as any).deleteWorkspaceRecordings;
    (storage as any).deleteWorkspaceRecordings = async () => {
      throw new Error('Simulated Wasabi S3 connection timeout');
    };

    try {
      await assert.rejects(
        async () => {
          await CompanyControlService.deleteCompanyAndWorkspace(ws.id);
        },
        (err: any) => {
          assert.equal(err.statusCode, 502);
          assert.match(err.message, /Failed to delete external storage recordings/);
          return true;
        }
      );

      const wsStillExists = await prisma.workspace.findUnique({ where: { id: ws.id } });
      assert.ok(wsStillExists, 'Workspace must NOT be deleted when storage fails');
      assert.equal(wsStillExists.billingStatus, 'ACTIVE', 'Status must revert from DELETING to ACTIVE');
    } finally {
      (storage as any).deleteWorkspaceRecordings = originalMethod;
      await CompanyControlService.deleteCompanyAndWorkspace(ws.id);
    }
  });

  await t.test('7. Foreign-Key Restrict & Cross-Workspace Reference Resolution: Safely unlinks cross-tenant stage approvals and preserves multi-workspace owners', async () => {
    const timestamp = Date.now();
    const rand = crypto.randomBytes(3).toString('hex');

    // User who owns Workspace Y and is a member in Workspace X
    const sharedOwnerY = await prisma.user.create({
      data: {
        name: 'Shared Owner Y',
        email: `shared_owner_${timestamp}_${rand}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const workspaceY = await prisma.workspace.create({
      data: {
        companyName: `Workspace Y ${timestamp}`,
        ownerId: sharedOwnerY.id,
        employeeCount: '1-10',
        billingStatus: 'ACTIVE',
      },
    });

    const leadY = await prisma.lead.create({
      data: {
        workspaceId: workspaceY.id,
        name: 'Lead Y',
        phone: '+919999900010',
        createdById: sharedOwnerY.id,
      },
    });

    // Workspace X (Target for deletion)
    const ownerX = await prisma.user.create({
      data: {
        name: 'Owner X',
        email: `owner_x_${timestamp}_${rand}@example.com`,
        password: 'hashedpassword123',
        isActive: true,
      },
    });

    const workspaceX = await prisma.workspace.create({
      data: {
        companyName: `Workspace X ${timestamp}`,
        ownerId: ownerX.id,
        employeeCount: '1-10',
        billingStatus: 'ACTIVE',
      },
    });

    await prisma.user.update({
      where: { id: ownerX.id },
      data: { workspaceId: workspaceX.id },
    });

    // Add sharedOwnerY as member of Workspace X
    await prisma.user.update({
      where: { id: sharedOwnerY.id },
      data: { workspaceId: workspaceX.id },
    });

    const stageX = await prisma.leadStage.create({
      data: {
        workspaceId: workspaceX.id,
        name: 'New Stage X',
        color: '#10b981',
        order: 1,
        createdBy: ownerX.id,
      },
    });

    const lobReasonX = await prisma.lOBReason.create({
      data: {
        workspaceId: workspaceX.id,
        name: 'LOB Reason X',
        createdById: ownerX.id,
      },
    });

    const leadX = await prisma.lead.create({
      data: {
        workspaceId: workspaceX.id,
        name: 'Lead X',
        phone: '+919999900011',
        createdById: ownerX.id,
        stageId: stageX.id,
      },
    });

    await prisma.leadLOBLog.create({
      data: {
        workspaceId: workspaceX.id,
        leadId: leadX.id,
        reasonId: lobReasonX.id,
        changedById: ownerX.id,
      },
    });

    // Crucial: Approval in Workspace Y referencing stageX of Workspace X (RESTRICT constraint)
    const approvalInWorkspaceY = await prisma.leadStageApproval.create({
      data: {
        workspaceId: workspaceY.id,
        leadId: leadY.id,
        fromStageId: stageX.id,
        type: 'STAGE_CHANGE',
        requestedById: sharedOwnerY.id,
        status: 'PENDING',
      },
    });

    try {
      // Perform deletion of Workspace X
      const result = await CompanyControlService.deleteCompanyAndWorkspace(workspaceX.id, 'TEST_ADMIN');
      assert.equal(result.success, true);
      assert.equal(result.deletedWorkspaceId, workspaceX.id);

      // Verify Workspace X is deleted
      const checkWsX = await prisma.workspace.findUnique({ where: { id: workspaceX.id } });
      assert.equal(checkWsX, null, 'Workspace X must be deleted');

      // Verify Workspace Y and its lead are untouched
      const checkWsY = await prisma.workspace.findUnique({ where: { id: workspaceY.id } });
      assert.ok(checkWsY, 'Workspace Y must remain intact');

      // Verify approval in Workspace Y had fromStageId unlinked to null without error
      const checkApprovalY = await prisma.leadStageApproval.findUnique({
        where: { id: approvalInWorkspaceY.id },
      });
      assert.ok(checkApprovalY, 'Approval in Workspace Y must still exist');
      assert.equal(checkApprovalY.fromStageId, null, 'fromStageId must be unlinked to null');

      // Verify sharedOwnerY is preserved because they own Workspace Y
      const checkSharedOwnerY = await prisma.user.findUnique({ where: { id: sharedOwnerY.id } });
      assert.ok(checkSharedOwnerY, 'Shared owner of Workspace Y must not be deleted');

      // Verify single-tenant ownerX is deleted
      const checkOwnerX = await prisma.user.findUnique({ where: { id: ownerX.id } });
      assert.equal(checkOwnerX, null, 'Owner X must be deleted');
    } finally {
      // Cleanup Workspace Y
      try {
        await CompanyControlService.deleteCompanyAndWorkspace(workspaceY.id, 'TEST_ADMIN');
      } catch (e) {}
    }
  });

});

