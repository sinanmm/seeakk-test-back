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
}
