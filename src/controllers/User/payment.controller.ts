import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import { emitWorkspaceEvent } from '../../realtime/socket';

const leadIdParamSchema = z.object({
  id: z.string().min(1, 'Lead ID is required'),
});

const updateTotalAmountSchema = z.object({
  totalAmount: z.number().positive('Total amount must be a positive number'),
  reason: z.string().min(1, 'Reason for change is required'),
});

const requestAdvanceSchema = z.object({
  amount: z.number().positive('Advance amount must be a positive number'),
  paymentDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid payment date',
  }),
  remarks: z.string().optional(),
  proofUrl: z.string().optional(),
});

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }
  return workspaceId;
};

function validate<T>(
  schema: z.Schema<T>,
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }
  return result.data;
}

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }
  logger.error(`Payment controller error during ${action}`, { error: error?.message });
  next(error);
};

const validateProof = (proofUrl?: string): string | null => {
  if (!proofUrl) return null;
  const match = proofUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) {
    return 'Invalid file format. Only JPG, JPEG, PNG, and WEBP are allowed.';
  }
  const base64Data = match[2];
  const approxBytes = (base64Data.length * 3) / 4;
  if (approxBytes > 1024 * 1024) {
    return 'Image size must be 1 MB or less.';
  }
  return null;
};

// Helper: Calculate balance = totalAmount - Sum(Approved Advance Payments)
const getLeadPaymentStats = async (leadId: string, totalAmount: number) => {
  const approvedAdvances = await (prisma as any).advancePayment.aggregate({
    where: { leadId, status: 'APPROVED' },
    _sum: { amount: true },
  });
  const approvedSum = approvedAdvances._sum.amount || 0;
  return {
    approvedSum,
    balance: Math.max(0, totalAmount - approvedSum),
  };
};

export const listLeadPayments = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const lead = await (prisma as any).lead.findFirst({
      where: { id: params.id, workspaceId, deletedAt: null },
      select: { id: true, name: true, totalAmount: true },
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    const { approvedSum, balance } = await getLeadPaymentStats(lead.id, (lead as any).totalAmount || 0);

    const [amountHistory, advancePayments] = await Promise.all([
      (prisma as any).leadTotalAmountHistory.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'desc' },
        include: { changedBy: { select: { id: true, name: true } } },
      }),
      (prisma as any).advancePayment.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          rejectedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalAmount: (lead as any).totalAmount || 0,
        approvedSum,
        balance,
        amountHistory,
        advancePayments,
      },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadPayments');
  }
};

export const updateTotalAmount = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate(leadIdParamSchema, req.params, res);
  if (!params) return;

  const body = validate(updateTotalAmountSchema, req.body, res);
  if (!body) return;

  try {
    const lead = await (prisma as any).lead.findFirst({
      where: { id: params.id, workspaceId, deletedAt: null },
      select: { id: true, totalAmount: true },
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    const oldAmount = (lead as any).totalAmount || 0;
    const newAmount = body.totalAmount;

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: { totalAmount: newAmount },
      });

      await tx.leadTotalAmountHistory.create({
        data: {
          leadId: lead.id,
          oldAmount,
          newAmount,
          changedById: req.user!.id,
          reason: body.reason,
        },
      });

      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          performedById: req.user!.id,
          workspaceId,
          action: 'LEAD_TOTAL_AMOUNT_EDITED',
          metadata: {
            oldAmount,
            newAmount,
            reason: body.reason,
          },
        },
      });

      await auditService.log({
        userId: req.user?.id,
        workspaceId,
        action: 'LEAD_TOTAL_AMOUNT_EDITED',
        entityType: 'Lead',
        entityId: lead.id,
        details: {
          oldAmount,
          newAmount,
          reason: body.reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });

    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'payment_updated' });

    return res.status(200).json({
      success: true,
      message: 'Total amount updated successfully.',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateTotalAmount');
  }
};

export const requestAdvancePayment = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate(leadIdParamSchema, req.params, res);
  if (!params) return;

  const body = validate(requestAdvanceSchema, req.body, res);
  if (!body) return;

  const proofError = validateProof(body.proofUrl);
  if (proofError) {
    return res.status(422).json({ success: false, message: proofError });
  }

  try {
    const lead = await (prisma as any).lead.findFirst({
      where: { id: params.id, workspaceId, deletedAt: null },
      select: { id: true, name: true, stageId: true },
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    const requestingUser = await prisma.user.findFirst({
      where: { id: req.user!.id, workspaceId, deletedAt: null, isActive: true },
      select: { id: true, name: true, supervisorId: true },
    });

    if (!requestingUser?.supervisorId) {
      return res.status(409).json({
        success: false,
        message: 'You must have a supervisor assigned to your account before you can request an advance payment.',
      });
    }

    const advance = await (prisma as any).$transaction(async (tx: any) => {
      const adv = await tx.advancePayment.create({
        data: {
          leadId: lead.id,
          workspaceId,
          amount: body.amount,
          paymentDate: new Date(body.paymentDate),
          proofUrl: body.proofUrl || null,
          remarks: body.remarks || null,
          requestedById: req.user!.id,
          status: 'PENDING',
        },
      });

      const approval = await tx.leadStageApproval.create({
        data: {
          workspaceId,
          leadId: lead.id,
          type: 'ADVANCE_PAYMENT',
          requestedById: req.user!.id,
          assignedToId: requestingUser.supervisorId,
          status: 'PENDING',
          requestData: {
            advancePaymentId: adv.id,
            amount: body.amount,
            paymentDate: body.paymentDate,
            remarks: body.remarks || '',
            proofUrl: body.proofUrl || null,
          },
        },
      });

      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          performedById: req.user!.id,
          workspaceId,
          action: 'ADVANCE_PAYMENT_REQUESTED',
          metadata: {
            advancePaymentId: adv.id,
            amount: body.amount,
            approvalId: approval.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.user?.id,
          workspaceId,
          action: 'ADVANCE_PAYMENT_REQUESTED',
          entityType: 'Lead',
          entityId: lead.id,
          details: {
            advancePaymentId: adv.id,
            amount: body.amount,
            approvalId: approval.id,
          } as any,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      return adv;
    });

    emitWorkspaceEvent(workspaceId, 'approval_updated', {
      leadId: lead.id,
      status: 'PENDING',
      action: 'REQUESTED',
    });

    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'payment_requested' });

    return res.status(201).json({
      success: true,
      message: 'Advance payment approval requested successfully.',
      data: advance,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'requestAdvancePayment');
  }
};
