import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
import { getSeatUsage } from './seatUsage.service';

export interface ApprovePaymentInput {
  paymentRequestId: string;
  approvedUserLimit?: number;
  accessFrom?: Date | string;
  accessUntil?: Date | string;
  remarks?: string;
  approvedBy?: string;
  auditContext?: { ipAddress?: string; userAgent?: string };
}

export interface RejectPaymentInput {
  paymentRequestId: string;
  rejectionReason: string;
  remarks?: string;
  rejectedBy?: string;
  auditContext?: { ipAddress?: string; userAgent?: string };
}

export class PaymentApprovalService {
  /**
   * Approves a payment request transactionally and idempotently.
   */
  static async approvePayment(input: ApprovePaymentInput) {
    const { paymentRequestId, remarks, approvedBy = 'PLATFORM_OWNER', auditContext } = input;

    if (!paymentRequestId) {
      const err: any = new Error('Payment Request ID is required.');
      err.statusCode = 400;
      throw err;
    }

    if (input.approvedUserLimit !== undefined && input.approvedUserLimit !== null) {
      const numLimit = Number(input.approvedUserLimit);
      if (!Number.isInteger(numLimit) || numLimit <= 0) {
        const err: any = new Error('Approved user limit must be a positive integer.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.accessFrom !== undefined && input.accessUntil !== undefined) {
      const startDate = new Date(input.accessFrom);
      const endDate = new Date(input.accessUntil);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        const err: any = new Error('Invalid access dates provided.');
        err.statusCode = 400;
        throw err;
      }
      if (endDate <= startDate) {
        const err: any = new Error('Access Until date must be strictly after Access From date.');
        err.statusCode = 400;
        throw err;
      }
    }

    // Check payment request
    const existingRequest = await prisma.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      include: {
        workspace: true,
        paymentSubmissions: { orderBy: { submittedAt: 'desc' } },
        verifiedPayments: true,
      },
    });

    if (!existingRequest) {
      const err: any = new Error('Payment request not found.');
      err.statusCode = 404;
      throw err;
    }

    // Default or validate approvedUserLimit
    let numLimit: number;
    if (input.approvedUserLimit !== undefined && input.approvedUserLimit !== null) {
      numLimit = Number(input.approvedUserLimit);
    } else {
      numLimit = existingRequest.requestedUsers;
    }

    if (!Number.isInteger(numLimit) || numLimit <= 0) {
      const err: any = new Error('Approved user limit must be a positive integer.');
      err.statusCode = 400;
      throw err;
    }

    // Default or validate accessFrom and accessUntil
    const startDate = input.accessFrom ? new Date(input.accessFrom) : new Date();
    let endDate: Date;
    if (input.accessUntil) {
      endDate = new Date(input.accessUntil);
    } else {
      const months = existingRequest.requestedMonths && existingRequest.requestedMonths > 0 ? existingRequest.requestedMonths : 1;
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + months);
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      const err: any = new Error('Invalid access dates provided.');
      err.statusCode = 400;
      throw err;
    }

    if (endDate <= startDate) {
      const err: any = new Error('Access Until date must be strictly after Access From date.');
      err.statusCode = 400;
      throw err;
    }

    // Idempotency: If already approved and verified payment exists, return safe success
    if (existingRequest.status === 'APPROVED' && existingRequest.verifiedPayments.length > 0) {
      logger.info('Payment request already approved — idempotent response returned', {
        paymentRequestId,
        workspaceId: existingRequest.workspaceId,
      });
      return {
        success: true,
        alreadyApproved: true,
        message: 'Payment request is already approved.',
        verifiedPayment: existingRequest.verifiedPayments[0],
      };
    }

    // Check seat usage limit constraint (Part 19)
    const seatUsage = await getSeatUsage(existingRequest.workspaceId);
    if (seatUsage.activeUserCount > numLimit) {
      const err: any = new Error(
        `Approved user limit (${numLimit}) cannot be lower than the company's current ${seatUsage.activeUserCount} active users.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Find or resolve submission for this payment request
    let pendingSubmission = existingRequest.paymentSubmissions.find(
      (sub) =>
        sub.paymentRequestId === existingRequest.id &&
        sub.workspaceId === existingRequest.workspaceId &&
        ['PENDING_VERIFICATION', 'PENDING', 'SUBMITTED'].includes(sub.status)
    );

    if (!pendingSubmission && existingRequest.paymentSubmissions.length > 0) {
      pendingSubmission = existingRequest.paymentSubmissions[0];
    }

    // Perform approval in atomic database transaction (Part 3)
    const result = await prisma.$transaction(async (tx) => {
      // Re-verify request status inside transaction
      const reqInTx = await tx.paymentRequest.findUnique({
        where: { id: paymentRequestId },
        include: {
          paymentSubmissions: {
            where: {
              workspaceId: existingRequest.workspaceId,
            },
            orderBy: { submittedAt: 'desc' },
          },
        },
      });

      if (!reqInTx) {
        throw new Error('Payment request not found inside transaction.');
      }

      let submissionInTx = reqInTx.paymentSubmissions.find((s) =>
        ['PENDING_VERIFICATION', 'PENDING', 'SUBMITTED'].includes(s.status)
      ) || reqInTx.paymentSubmissions[0];

      if (!submissionInTx) {
        // If no submission exists (e.g. offline bank transfer / admin direct verification),
        // create a verified submission record transactionally so data integrity and relations remain intact.
        submissionInTx = await tx.paymentSubmission.create({
          data: {
            workspaceId: reqInTx.workspaceId,
            paymentRequestId: reqInTx.id,
            submittedBy: reqInTx.createdBy,
            paymentMethod: 'OFFLINE_APPROVAL',
            utrNumber: reqInTx.paymentReference,
            paymentDate: new Date(),
            proofStorageKey: 'OFFLINE_VERIFIED',
            status: 'VERIFIED',
            remarks: remarks || 'Verified directly via Control Software',
          },
        });
      }

      // 1. Create VerifiedPayment record (Part 5)
      const verifiedPayment = await tx.verifiedPayment.create({
        data: {
          workspaceId: reqInTx.workspaceId,
          paymentRequestId: reqInTx.id,
          paymentSubmissionId: submissionInTx.id,
          planId: reqInTx.requestedPlanId || null,
          planCodeSnapshot: reqInTx.planCodeSnapshot || null,
          planNameSnapshot: reqInTx.planNameSnapshot || null,
          amount: reqInTx.calculatedAmount,
          currency: reqInTx.currency,
          unitPriceSnapshot: reqInTx.unitPrice,
          requestedUsers: reqInTx.requestedUsers,
          requestedMonths: reqInTx.requestedMonths,
          approvedUserLimit: numLimit,
          paymentMethod: submissionInTx.paymentMethod || 'UPI',
          utrNumber: submissionInTx.utrNumber || null,
          paymentDate: submissionInTx.paymentDate || new Date(),
          accessFrom: startDate,
          accessUntil: endDate,
          status: 'VERIFIED',
          remarks: remarks || null,
          approvedBy,
          approvedAt: new Date(),
        },
      });

      // 2. Update PaymentRequest status
      await tx.paymentRequest.update({
        where: { id: paymentRequestId },
        data: { status: 'APPROVED' },
      });

      // 3. Update PaymentSubmission status
      if (submissionInTx.status !== 'VERIFIED') {
        await tx.paymentSubmission.update({
          where: { id: submissionInTx.id },
          data: { status: 'VERIFIED' },
        });
      }

      // Supersede any active grace records for this workspace now that paid entitlement is activated
      await tx.graceRecord.updateMany({
        where: {
          workspaceId: reqInTx.workspaceId,
          status: 'ACTIVE',
        },
        data: {
          status: 'SUPERSEDED',
          revokedAt: new Date(),
        },
      });

      // 4. Update Workspace entitlement and activate company (Part 8 & 10)
      await tx.workspace.update({
        where: { id: reqInTx.workspaceId },
        data: {
          billingStatus: 'ACTIVE',
          ...(reqInTx.requestedPlanId ? { activePlanId: reqInTx.requestedPlanId } : {}),
          approvedUserLimit: numLimit,
          accessFrom: startDate,
          accessUntil: endDate,
          lockedAt: null,
          lockReason: null,
          suspendReason: null,
        },
      });

      return verifiedPayment;
    });

    // Write audit log (Part 62)
    await auditService.log({
      action: 'PAYMENT_APPROVED',
      entityType: 'PaymentRequest',
      entityId: paymentRequestId,
      workspaceId: existingRequest.workspaceId,
      details: {
        amount: existingRequest.calculatedAmount,
        currency: existingRequest.currency,
        planId: existingRequest.requestedPlanId,
        planCode: existingRequest.planCodeSnapshot,
        approvedUserLimit: numLimit,
        accessFrom: startDate.toISOString(),
        accessUntil: endDate.toISOString(),
        approvedBy,
        remarks,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Payment approved successfully', {
      paymentRequestId,
      workspaceId: existingRequest.workspaceId,
      amount: existingRequest.calculatedAmount,
      approvedUserLimit: numLimit,
      accessUntil: endDate.toISOString(),
    });

    return {
      success: true,
      alreadyApproved: false,
      message: 'Payment approved successfully and company entitlement activated.',
      verifiedPayment: result,
    };
  }

  /**
   * Rejects a payment request transactionally.
   */
  static async rejectPayment(input: RejectPaymentInput) {
    const { paymentRequestId, rejectionReason, remarks, rejectedBy = 'PLATFORM_OWNER', auditContext } = input;

    if (!paymentRequestId || !rejectionReason) {
      const err: any = new Error('Payment Request ID and rejection reason are required.');
      err.statusCode = 400;
      throw err;
    }

    const existingRequest = await prisma.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      include: { paymentSubmissions: true },
    });

    if (!existingRequest) {
      const err: any = new Error('Payment request not found.');
      err.statusCode = 404;
      throw err;
    }

    if (existingRequest.status === 'APPROVED') {
      const err: any = new Error('Cannot reject an already approved payment request.');
      err.statusCode = 400;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Mark request as REJECTED
      await tx.paymentRequest.update({
        where: { id: paymentRequestId },
        data: { status: 'REJECTED' },
      });

      // 2. Mark submissions as REJECTED
      await tx.paymentSubmission.updateMany({
        where: { paymentRequestId },
        data: { status: 'REJECTED' },
      });

      // 3. Return workspace to PAYMENT_REQUIRED so customer can retry payment (Part 7)
      await tx.workspace.update({
        where: { id: existingRequest.workspaceId },
        data: { billingStatus: 'PAYMENT_REQUIRED' },
      });
    });

    // Write audit log
    await auditService.log({
      action: 'PAYMENT_REJECTED',
      entityType: 'PaymentRequest',
      entityId: paymentRequestId,
      workspaceId: existingRequest.workspaceId,
      details: {
        rejectionReason,
        remarks,
        rejectedBy,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    logger.info('Payment rejected successfully', {
      paymentRequestId,
      workspaceId: existingRequest.workspaceId,
      rejectionReason,
    });

    return {
      success: true,
      message: 'Payment request has been rejected.',
    };
  }
}
