import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
import { evaluateCompanyAccess } from './companyAccess.service';

export interface GrantGraceInput {
  workspaceId: string;
  allowedUserLimit: number;
  graceFrom?: Date | string;
  graceUntil: Date | string;
  reason: string;
  grantedBy?: string;
  auditContext?: { ipAddress?: string; userAgent?: string };
}

export class CompanyControlService {
  /**
   * Grants temporary Grace access to a company without generating revenue.
   */
  static async grantGrace(input: GrantGraceInput) {
    const { workspaceId, allowedUserLimit, graceFrom = new Date(), graceUntil, reason, grantedBy = 'PLATFORM_OWNER', auditContext } = input;

    if (!workspaceId || !allowedUserLimit || !graceUntil || !reason) {
      const err: any = new Error('Missing required fields for granting Grace period.');
      err.statusCode = 400;
      throw err;
    }

    const numLimit = Number(allowedUserLimit);
    if (!Number.isInteger(numLimit) || numLimit <= 0) {
      const err: any = new Error('Allowed user limit must be a positive integer.');
      err.statusCode = 400;
      throw err;
    }

    const fromDate = new Date(graceFrom);
    const untilDate = new Date(graceUntil);

    if (isNaN(fromDate.getTime()) || isNaN(untilDate.getTime()) || untilDate <= fromDate) {
      const err: any = new Error('Invalid grace period dates. Grace Until must be in the future.');
      err.statusCode = 400;
      throw err;
    }

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    const graceRecord = await prisma.$transaction(async (tx) => {
      // Deactivate older active grace records
      await tx.graceRecord.updateMany({
        where: { workspaceId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', revokedAt: new Date() },
      });

      // Create new Grace record (Revenue remains ₹0)
      const record = await tx.graceRecord.create({
        data: {
          workspaceId,
          graceFrom: fromDate,
          graceUntil: untilDate,
          allowedUserLimit: numLimit,
          reason,
          status: 'ACTIVE',
          grantedBy,
          grantedAt: new Date(),
        },
      });

      // Update workspace billingStatus to GRACE if not actively paid
      if (workspace.billingStatus !== 'ACTIVE') {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { billingStatus: 'GRACE' },
        });
      }

      return record;
    });

    await auditService.log({
      action: 'GRACE_GRANTED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: {
        allowedUserLimit: numLimit,
        graceFrom: fromDate.toISOString(),
        graceUntil: untilDate.toISOString(),
        reason,
        grantedBy,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Grace period granted to workspace', { workspaceId, graceUntil: untilDate.toISOString(), allowedUserLimit: numLimit });

    return graceRecord;
  }

  /**
   * Revokes active Grace from a company.
   */
  static async revokeGrace(workspaceId: string, revokedBy: string = 'PLATFORM_OWNER', reason?: string, auditContext?: any) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    await prisma.graceRecord.updateMany({
      where: { workspaceId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    // Re-evaluate company access
    const updated = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    const decision = await evaluateCompanyAccess(updated);

    if (updated && updated.billingStatus === 'GRACE') {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { billingStatus: decision.isAllowed ? 'ACTIVE' : 'EXPIRED' },
      });
    }

    await auditService.log({
      action: 'GRACE_REVOKED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { reason, revokedBy },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    return { success: true, message: 'Grace access revoked.' };
  }

  /**
   * Manually locks a company.
   */
  static async lockCompany(workspaceId: string, reason: string, lockedBy: string = 'PLATFORM_OWNER', auditContext?: any) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        lockedAt: new Date(),
        lockReason: reason || 'Locked by administrator',
      },
    });

    await auditService.log({
      action: 'COMPANY_LOCKED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { reason, lockedBy },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Company locked', { workspaceId, reason, lockedBy });
    return { success: true, message: 'Company locked successfully.' };
  }

  /**
   * Unlocks a company and recalculates real entitlement.
   */
  static async unlockCompany(workspaceId: string, unlockedBy: string = 'PLATFORM_OWNER', auditContext?: any) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        lockedAt: null,
        lockReason: null,
      },
    });

    const decision = await evaluateCompanyAccess(updated);

    await auditService.log({
      action: 'COMPANY_UNLOCKED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { unlockedBy, effectiveAccess: decision.reason },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Company unlocked', { workspaceId, unlockedBy, effectiveAccess: decision.reason });
    return { success: true, message: 'Company unlocked successfully.', effectiveAccess: decision };
  }

  /**
   * Suspends a company.
   */
  static async suspendCompany(workspaceId: string, reason: string, suspendedBy: string = 'PLATFORM_OWNER', auditContext?: any) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        suspendReason: reason || 'Suspended by platform administration',
      },
    });

    await auditService.log({
      action: 'COMPANY_SUSPENDED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { reason, suspendedBy },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Company suspended', { workspaceId, reason, suspendedBy });
    return { success: true, message: 'Company suspended successfully.' };
  }

  /**
   * Unsuspends a company and recalculates real entitlement.
   */
  static async unsuspendCompany(workspaceId: string, unsuspendedBy: string = 'PLATFORM_OWNER', auditContext?: any) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        suspendReason: null,
      },
    });

    const decision = await evaluateCompanyAccess(updated);

    await auditService.log({
      action: 'COMPANY_UNSUSPENDED',
      entityType: 'Workspace',
      entityId: workspaceId,
      workspaceId,
      details: { unsuspendedBy, effectiveAccess: decision.reason },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Company unsuspended', { workspaceId, unsuspendedBy, effectiveAccess: decision.reason });
    return { success: true, message: 'Company unsuspended successfully.', effectiveAccess: decision };
  }

  /**
   * Permanently deletes a Company workspace, all workspace-scoped records,
   * all Wasabi call recordings, and associated users atomically.
   */
  static async deleteCompanyAndWorkspace(
    workspaceId: string,
    actorAdminId: string = 'CONTROL_ADMIN',
    auditContext?: any
  ) {
    if (!workspaceId || typeof workspaceId !== 'string') {
      const err: any = new Error('Workspace ID is required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanWorkspaceId = workspaceId.trim();

    // 1. Resolve workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: cleanWorkspaceId },
      include: {
        users: { select: { id: true, email: true } },
      },
    });

    if (!workspace) {
      const err: any = new Error('Workspace not found.');
      err.statusCode = 404;
      throw err;
    }

    // 2. Concurrency guard: check if already in DELETING state
    if (workspace.billingStatus === 'DELETING') {
      const err: any = new Error('Workspace deletion is already in progress.');
      err.statusCode = 409;
      throw err;
    }

    // Mark as DELETING immediately to prevent concurrent operations
    await prisma.workspace.update({
      where: { id: cleanWorkspaceId },
      data: {
        billingStatus: 'DELETING',
        lockReason: 'Workspace deletion in progress',
        lockedAt: new Date(),
      },
    });

    logger.info('Starting permanent deletion of workspace and tenant data', {
      workspaceId: cleanWorkspaceId,
      companyName: workspace.companyName,
      actorAdminId,
    });

    // 3. Collect Wasabi call recordings
    const callSessions = await prisma.leadCallSession.findMany({
      where: { workspaceId: cleanWorkspaceId, recordingUrl: { not: null } },
      select: { id: true, recordingUrl: true },
    });
    const recordingKeys = callSessions
      .map((s) => s.recordingUrl)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    // 4. Delete Wasabi recordings
    let storageResult = { deletedCount: 0, keys: [] as string[] };
    try {
      const { storage } = await import('../../lib/storage/storage.factory');
      if (typeof (storage as any).deleteWorkspaceRecordings === 'function') {
        storageResult = await (storage as any).deleteWorkspaceRecordings(
          cleanWorkspaceId,
          recordingKeys
        );
      }
    } catch (storageErr: any) {
      logger.error('Wasabi storage deletion failed for workspace', {
        workspaceId: cleanWorkspaceId,
        error: storageErr?.message || String(storageErr),
      });
      // Revert DELETING status so state is not locked forever
      await prisma.workspace.update({
        where: { id: cleanWorkspaceId },
        data: {
          billingStatus: workspace.billingStatus || 'ACTIVE',
          lockReason: 'Wasabi deletion failed',
        },
      });
      const err: any = new Error(`Failed to delete external storage recordings: ${storageErr?.message || 'Storage error'}`);
      err.statusCode = 502;
      throw err;
    }

    // 5. Atomic Database Transaction: Delete all workspace-scoped records
    const userIds = workspace.users.map((u) => u.id);
    if (workspace.ownerId && !userIds.includes(workspace.ownerId)) {
      userIds.push(workspace.ownerId);
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          // STEP 0: Resolve stages of this workspace and unlink any external/internal stage approvals
          // that reference these stages (e.g. from historical stage selections or cross-workspace references)
          // because lead_stage_approvals.fromStageId / toStageId have RESTRICT foreign keys.
          const stages = await tx.leadStage.findMany({
            where: { workspaceId: cleanWorkspaceId },
            select: { id: true },
          });
          const stageIds = stages.map((s) => s.id);

          if (stageIds.length > 0) {
            await tx.leadStageApproval.updateMany({
              where: { fromStageId: { in: stageIds } },
              data: { fromStageId: null },
            });
            await tx.leadStageApproval.updateMany({
              where: { toStageId: { in: stageIds } },
              data: { toStageId: null },
            });
          }

          if (userIds.length > 0) {
            await tx.leadStageApproval.updateMany({
              where: {
                OR: [
                  { requestedById: { in: userIds } },
                  { assignedToId: { in: userIds } },
                  { approvedById: { in: userIds } },
                ],
              },
              data: {
                assignedToId: null,
                approvedById: null,
              },
            });
          }

          // BATCH 1: Independent child and leaf records
          await Promise.all([
            // Telephony & Meta Integrations
            tx.telephonyUserMapping.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.telephonyProviderConfig.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.telephonySetting.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.metaLeadImport.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.metaLeadForm.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.metaPageConnection.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.metaConnection.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.whatsAppTemplate.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // Automations
            tx.automationActionExecution.deleteMany({ where: { workflowExecution: { workspaceId: cleanWorkspaceId } } }),
            tx.automationExecution.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.automationAction.deleteMany({ where: { workflow: { workspaceId: cleanWorkspaceId } } }),
            tx.automationWorkflow.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // Dashboards & Pipelines
            tx.dashboardPipelineShare.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.dashboardPipelineAudit.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.dashboardPipeline.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.dashboardPipelineSection.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.dashboardLayoutPreference.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // Calls & Outcomes
            tx.leadCallOutcome.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadCallSession.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // CRM Leads detail records
            tx.leadRemark.deleteMany({ where: { lead: { workspaceId: cleanWorkspaceId } } }),
            tx.leadTotalAmountHistory.deleteMany({ where: { lead: { workspaceId: cleanWorkspaceId } } }),
            tx.leadFieldEditHistory.deleteMany({ where: { lead: { workspaceId: cleanWorkspaceId } } }),
            tx.leadStar.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadActivity.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadStageApproval.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadStageHistory.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadProduct.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadLOBLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.followupActivityLog.deleteMany({ where: { followUp: { workspaceId: cleanWorkspaceId } } }),
            tx.followUp.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // User-scoped targets & activities
            ...(userIds.length > 0 ? [
              tx.targetViolation.deleteMany({ where: { userId: { in: userIds } } }),
              tx.targetUnlockLog.deleteMany({
                where: {
                  OR: [
                    { userId: { in: userIds } },
                    { unlockedById: { in: userIds } },
                  ],
                },
              }),
              tx.targetLockLog.deleteMany({ where: { userId: { in: userIds } } }),
              tx.targetAssignment.deleteMany({ where: { userId: { in: userIds } } }),
              tx.targetSetting.deleteMany({ where: { userId: { in: userIds } } }),
              tx.locationStop.deleteMany({ where: { userId: { in: userIds } } }),
              tx.locationPoint.deleteMany({ where: { userId: { in: userIds } } }),
              tx.locationSession.deleteMany({ where: { userId: { in: userIds } } }),
              tx.attendanceRecord.deleteMany({ where: { userId: { in: userIds } } }),
              tx.attendanceSchedule.deleteMany({ where: { userId: { in: userIds } } }),
              tx.attendanceUserSetting.deleteMany({ where: { userId: { in: userIds } } }),
              tx.rosterEntry.deleteMany({ where: { userId: { in: userIds } } }),
              tx.device.deleteMany({ where: { userId: { in: userIds } } }),
              tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }),
              tx.userLocationAssignment.deleteMany({ where: { userId: { in: userIds } } }),
            ] : []),

            // Attendance unlinked records
            tx.attendanceAuditLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.attendanceWarning.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.attendanceSetting.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.attendanceNetwork.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.attendanceNotification.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.attendanceOfficeLocation.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.targetFollowupLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // Billing, Salaries & Finance
            tx.verifiedPayment.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.paymentSubmission.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.paymentRequest.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.graceRecord.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.advancePayment.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.salaryHistory.deleteMany({ where: { salaryRecord: { workspaceId: cleanWorkspaceId } } }),
            tx.salaryApproval.deleteMany({ where: { salaryRecord: { workspaceId: cleanWorkspaceId } } }),
            tx.salaryRecord.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.salaryApprovalStage.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.salarySetting.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.revenueTransaction.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),

            // Settings, Extensions, Reports, Sheets, Invites
            tx.followUpSettings.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.temporaryBulkExtensionAccess.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.bulkFollowUpExtension.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.followUpExtensionReason.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.fieldHighlightConfig.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.sheetVersion.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.sheet.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.reportLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.report.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.importJob.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.invite.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.holidaySyncLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.auditLog.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
          ]);

          // BATCH 2: CRM Core Models & Dependent Master Records
          // Delete leads first
          await tx.lead.deleteMany({ where: { workspaceId: cleanWorkspaceId } });

          // Delete dynamic field children before dynamic fields (to prevent RESTRICT on lead_dynamic_values)
          await tx.leadDynamicValue.deleteMany({ where: { field: { workspaceId: cleanWorkspaceId } } });
          await tx.leadDynamicOption.deleteMany({ where: { field: { workspaceId: cleanWorkspaceId } } });

          // Delete role permissions before roles (to prevent RESTRICT on role_permissions)
          await tx.rolePermission.deleteMany({ where: { role: { workspaceId: cleanWorkspaceId } } });

          // Delete report types after reports have been deleted
          await tx.reportType.deleteMany({ where: { workspaceId: cleanWorkspaceId } });

          // Delete remaining core models and masters
          await Promise.all([
            tx.leadSubstage.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.stageRule.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadStage.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadLifeCycleTransition.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadLifeCycle.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadDynamicField.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.leadSource.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.product.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.targetCycle.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.holiday.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.lOBReason.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.locationLevel.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.country.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.office.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.department.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
            tx.role.deleteMany({ where: { workspaceId: cleanWorkspaceId } }),
          ]);

          // BATCH 3: Break User circular references and finalize workspace deletion
          if (userIds.length > 0) {
            await tx.user.updateMany({
              where: { id: { in: userIds } },
              data: {
                supervisorId: null,
                workspaceId: null,
                roleId: null,
                departmentId: null,
                officeId: null,
                countryId: null,
                stateId: null,
                districtId: null,
                assignedTargetCycleId: null,
                attendanceOfficeLocationId: null,
              },
            });
          }

          // Delete the Workspace itself
          await tx.workspace.delete({ where: { id: cleanWorkspaceId } });

          // Identify users who own other active workspaces to preserve them
          let usersToDelete = userIds;
          if (userIds.length > 0) {
            const otherOwnedWorkspaces = await tx.workspace.findMany({
              where: { ownerId: { in: userIds }, id: { not: cleanWorkspaceId } },
              select: { ownerId: true },
            });
            const protectedOwnerIds = new Set(otherOwnedWorkspaces.map((w) => w.ownerId));
            usersToDelete = userIds.filter((id) => !protectedOwnerIds.has(id));

            if (usersToDelete.length > 0) {
              await tx.user.deleteMany({ where: { id: { in: usersToDelete } } });
            }
          }
        },
        { maxWait: 15000, timeout: 60000 }
      );
    } catch (dbErr: any) {
      const errorDetail = dbErr?.meta?.message || dbErr?.message || String(dbErr);
      logger.error('Database transaction failed during workspace deletion - rolled back', {
        workspaceId: cleanWorkspaceId,
        code: dbErr?.code,
        meta: dbErr?.meta,
        error: errorDetail,
      });
      try {
        await prisma.workspace.update({
          where: { id: cleanWorkspaceId },
          data: {
            billingStatus: workspace.billingStatus || 'ACTIVE',
            lockReason: `Database deletion transaction failed: ${dbErr?.code || 'ERROR'}`,
          },
        });
      } catch (revertErr) {
        // If workspace was already deleted, ignore
      }
      const err: any = new Error(`Database transaction failed during tenant deletion: ${errorDetail}`);
      err.statusCode = 500;
      err.originalError = dbErr;
      throw err;
    }

    // Invalidate Redis sessions for deleted users
    try {
      const { redisClient } = await import('../../config/redis');
      if (redisClient.isOpen && userIds.length > 0) {
        let cursor = 0;
        do {
          const reply = await (redisClient as any).scan(cursor, { MATCH: 'refresh:*', COUNT: 100 });
          cursor = Number(reply.cursor);
          for (const key of reply.keys) {
            const storedUserId = await redisClient.get(key);
            if (storedUserId && userIds.includes(storedUserId)) {
              await redisClient.del(key);
            }
          }
        } while (cursor !== 0);
      }
    } catch (redisErr: any) {
      logger.warn('Failed to clear redis sessions for deleted workspace users', {
        workspaceId: cleanWorkspaceId,
        error: redisErr?.message,
      });
    }

    // 6. Global Platform Audit Log
    try {
      await auditService.log({
        action: 'COMPANY_DELETED',
        entityType: 'Workspace',
        entityId: cleanWorkspaceId,
        workspaceId: undefined,
        details: {
          companyName: workspace.companyName,
          actorAdminId,
          deletedAt: new Date().toISOString(),
          recordingsDeleted: storageResult.deletedCount,
          usersDeleted: userIds.length,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });
    } catch (auditErr: any) {
      logger.warn('Failed to record global audit log for company deletion', {
        workspaceId: cleanWorkspaceId,
        error: auditErr?.message,
      });
    }

    logger.info('Workspace, external storage, and all associated tenant records permanently deleted', {
      workspaceId: cleanWorkspaceId,
      companyName: workspace.companyName,
      storageDeletedCount: storageResult.deletedCount,
      usersDeletedCount: userIds.length,
    });

    return {
      success: true,
      message: 'Company and workspace deleted successfully.',
      deletedWorkspaceId: cleanWorkspaceId,
      storageObjectsDeleted: storageResult.deletedCount,
      usersDeleted: userIds.length,
    };
  }
}
