import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const totalCompanies = await prisma.workspace.count();
    const activeCompanies = await prisma.workspace.count({ where: { billingStatus: 'ACTIVE' } });
    const expiredCompanies = await prisma.workspace.count({ where: { billingStatus: 'EXPIRED' } });
    const paymentPendingCompanies = await prisma.workspace.count({ where: { billingStatus: 'PAYMENT_PENDING' } });
    
    // Valid Grace
    const graceCompanies = await prisma.graceRecord.count({
      where: { status: 'ACTIVE', graceUntil: { gt: new Date() } }
    });

    const lockedCompanies = await prisma.workspace.count({ where: { lockedAt: { not: null } } });
    const suspendedCompanies = await prisma.workspace.count({ where: { suspendReason: { not: null } } });

    // Revenue
    const verifiedPayments = await prisma.verifiedPayment.aggregate({
      _sum: { amount: true, requestedUsers: true, requestedMonths: true }
    });

    res.json({
      totalCompanies,
      activeCompanies,
      expiredCompanies,
      paymentPendingCompanies,
      graceCompanies,
      lockedCompanies,
      suspendedCompanies,
      revenueTotal: verifiedPayments._sum.amount || 0,
      userMonthsSold: (verifiedPayments._sum.requestedUsers || 0) * (verifiedPayments._sum.requestedMonths || 0),
    });
  } catch (error: any) {
    logger.error('Error fetching dashboard', { error: error.message });
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const approvePayment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { approvedUserLimit, accessFrom, accessUntil, remarks } = req.body;

    if (!approvedUserLimit || !accessFrom || !accessUntil) {
      return res.status(400).json({ message: 'Missing required approval fields.' });
    }

    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { workspace: true, paymentSubmissions: { where: { status: 'PENDING_VERIFICATION' } } }
    });

    if (!paymentRequest) return res.status(404).json({ message: 'Payment Request not found' });
    if (paymentRequest.status === 'APPROVED') return res.status(409).json({ message: 'Already approved' });
    
    const submission = (paymentRequest as any).paymentSubmissions[0];
    if (!submission) return res.status(400).json({ message: 'No pending submission found.' });

    // Transaction
    await prisma.$transaction(async (tx) => {
      // 1. Update Workspace
      await tx.workspace.update({
        where: { id: paymentRequest.workspaceId },
        data: {
          billingStatus: 'ACTIVE',
          approvedUserLimit: parseInt(approvedUserLimit),
          accessFrom: new Date(accessFrom),
          accessUntil: new Date(accessUntil),
        }
      });

      // 2. Mark Request and Submission
      await tx.paymentRequest.update({
        where: { id },
        data: { status: 'APPROVED' }
      });
      await (tx as any).paymentSubmission.update({
        where: { id: submission.id },
        data: { status: 'VERIFIED' }
      });

      // 3. Create VerifiedPayment
      await (tx as any).verifiedPayment.create({
        data: {
          workspaceId: paymentRequest.workspaceId,
          paymentRequestId: id,
          paymentSubmissionId: submission.id,
          amount: paymentRequest.calculatedAmount,
          currency: paymentRequest.currency,
          unitPriceSnapshot: paymentRequest.unitPrice,
          requestedUsers: paymentRequest.requestedUsers,
          requestedMonths: paymentRequest.requestedMonths,
          approvedUserLimit: parseInt(approvedUserLimit),
          paymentMethod: submission.paymentMethod,
          utrNumber: submission.utrNumber,
          paymentDate: submission.paymentDate,
          accessFrom: new Date(accessFrom),
          accessUntil: new Date(accessUntil),
          status: 'VERIFIED',
          remarks: remarks || '',
          approvedBy: 'PLATFORM_OWNER'
        }
      });
    });

    res.json({ message: 'Payment approved successfully.' });
  } catch (error: any) {
    logger.error('Approval error', { error: error.message });
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const rejectPayment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;
    
    if (!reason) return res.status(400).json({ message: 'Reason required' });

    await prisma.$transaction(async (tx) => {
      await tx.paymentRequest.update({
        where: { id },
        data: { status: 'REJECTED' }
      });
      await (tx as any).paymentSubmission.updateMany({
        where: { paymentRequestId: id },
        data: { status: 'REJECTED' }
      });
    });

    res.json({ message: 'Payment rejected.' });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal error' });
  }
};

export const grantGrace = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string; // workspace id
    const { allowedUserLimit, graceUntil, reason } = req.body;
    
    if (!allowedUserLimit || !graceUntil || !reason) return res.status(400).json({ message: 'Missing fields' });

    await (prisma as any).graceRecord.create({
      data: {
        workspaceId: id,
        graceUntil: new Date(graceUntil),
        allowedUserLimit: parseInt(allowedUserLimit),
        reason,
        grantedBy: 'PLATFORM_OWNER'
      }
    });

    res.json({ message: 'Grace granted.' });
  } catch(error) {
    res.status(500).json({ message: 'Internal error' });
  }
};

export const getPaymentRequests = async (req: Request, res: Response) => {
  const requests = await prisma.paymentRequest.findMany({
    include: { workspace: { select: { companyName: true } }, paymentSubmissions: true } as any
  });
  res.json(requests);
};

export const getCompanies = async (req: Request, res: Response) => {
  const companies = await prisma.workspace.findMany({
    select: {
      id: true,
      companyName: true,
      billingStatus: true,
      approvedUserLimit: true,
      accessFrom: true,
      accessUntil: true,
      createdAt: true
    }
  });
  res.json(companies);
};
