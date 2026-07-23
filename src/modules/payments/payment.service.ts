import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import { LeadApprovalStatus } from '@prisma/client';


export type Actor = {
  id: string;
  roleId?: string | null;
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const createAdvance = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
  input: { amount: number; paymentDate: Date; proofUrl: string; remarks?: string }
) => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId }
  });

  if (!lead) {
    throw createServiceError('Lead not found', 404);
  }

  const advance = await prisma.advancePayment.create({
    data: {
      leadId,
      workspaceId,
      amount: input.amount,
      paymentDate: input.paymentDate,
      proofUrl: input.proofUrl,
      remarks: input.remarks,
      requestedById: actor.id,
      status: LeadApprovalStatus.PENDING
    }
  });

  await auditService.log({
    workspaceId,
    userId: actor.id,
    action: 'CREATE_ADVANCE',
    entityType: 'LeadAdvancePayment',
    entityId: advance.id,
    details: { amount: input.amount, leadId }
  });

  return advance;
};

export const approveAdvance = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
  advanceId: string,
  checkNumber: string
) => {
  const advance = await prisma.advancePayment.findFirst({
    where: { id: advanceId, leadId, workspaceId }
  });

  if (!advance) {
    throw createServiceError('Advance payment not found', 404);
  }

  if (advance.status !== LeadApprovalStatus.PENDING) {
    throw createServiceError('Advance payment is not pending', 400);
  }

  const updated = await prisma.advancePayment.update({
    where: { id: advanceId },
    data: {
      status: LeadApprovalStatus.APPROVED,
      checkNumber,
      approvedById: actor.id,
    }
  });

  await auditService.log({
    workspaceId,
    userId: actor.id,
    action: 'APPROVE_ADVANCE',
    entityType: 'LeadAdvancePayment',
    entityId: advanceId,
    details: { checkNumber }
  });

  return updated;
};

export const rejectAdvance = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
  advanceId: string,
  reason: string
) => {
  const advance = await prisma.advancePayment.findFirst({
    where: { id: advanceId, leadId, workspaceId }
  });

  if (!advance) {
    throw createServiceError('Advance payment not found', 404);
  }

  if (advance.status !== LeadApprovalStatus.PENDING) {
    throw createServiceError('Advance payment is not pending', 400);
  }

  const updated = await prisma.advancePayment.update({
    where: { id: advanceId },
    data: {
      status: LeadApprovalStatus.DENIED,
      rejectionReason: reason,
      rejectedById: actor.id,
    }
  });

  await auditService.log({
    workspaceId,
    userId: actor.id,
    action: 'REJECT_ADVANCE',
    entityType: 'LeadAdvancePayment',
    entityId: advanceId,
    details: { reason }
  });

  return updated;
};

export const getAdvancesByLeadId = async (
  workspaceId: string,
  actor: Actor,
  leadId: string
) => {
  return await prisma.advancePayment.findMany({
    where: { leadId, workspaceId },
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } }
    }
  });
};

export const getPaymentHistory = async (
  workspaceId: string,
  actor: Actor,
  leadId: string
) => {
  const [advances, totalHistories] = await Promise.all([
    prisma.advancePayment.findMany({
      where: { leadId, workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } }
      }
    }),
    prisma.leadTotalAmountHistory.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        changedBy: { select: { id: true, name: true } }
      }
    })
  ]);

  return { advances, totalHistories };
};

export const getAllPendingAdvances = async (
  workspaceId: string,
  actor: Actor
) => {
  // Return all pending advances for leads assigned to this actor
  return await prisma.advancePayment.findMany({
    where: { 
       workspaceId, 
       status: 'PENDING',
       lead: { assignedToId: actor.id }
    },
    orderBy: { createdAt: 'desc' },
    include: {
      lead: { select: { id: true, name: true, companyName: true, email: true, phone: true } },
      requestedBy: { select: { id: true, name: true } },
    }
  });
};
