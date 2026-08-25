import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const getPendingPaymentRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(400).json({ success: false, message: 'Workspace ID missing' });
      return;
    }

    const paymentRequest = await prisma.paymentRequest.findFirst({
      where: { workspaceId, status: 'PAYMENT_REQUIRED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!paymentRequest) {
      res.status(404).json({ success: false, message: 'No pending payment request found' });
      return;
    }

    const billingSettings = await prisma.platformBillingSetting.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      paymentRequest,
      billingSettings,
    });
  } catch (error: any) {
    logger.error('Error fetching pending payment request:', { error: error.message });
    next(error);
  }
};

export const submitPaymentProof = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;

    if (!workspaceId || !userId) {
      res.status(400).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { paymentRequestId, paymentMethod, utrNumber, paymentDate, proofStorageKey, remarks } = req.body;

    if (!paymentRequestId || !paymentMethod || !utrNumber || !paymentDate || !proofStorageKey) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    // Verify the payment request exists and is unpaid
    const paymentRequest = await prisma.paymentRequest.findFirst({
      where: { id: paymentRequestId, workspaceId, status: 'PAYMENT_REQUIRED' },
    });

    if (!paymentRequest) {
      res.status(404).json({ success: false, message: 'Payment request not found or already paid' });
      return;
    }

    // Wrap in a transaction to safely create the submission and update the workspace
    await prisma.$transaction(async (tx) => {
      // 1. Create the submission
      await tx.paymentSubmission.create({
        data: {
          paymentRequestId,
          workspaceId,
          paymentMethod,
          utrNumber,
          paymentDate: new Date(paymentDate),
          proofStorageKey,
          remarks,
          submittedBy: userId,
          status: 'PENDING_VERIFICATION',
        },
      });

      // 2. Update PaymentRequest status
      await tx.paymentRequest.update({
        where: { id: paymentRequestId },
        data: { status: 'PAYMENT_PENDING' },
      });

      // 3. Update Workspace billingStatus
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { billingStatus: 'PAYMENT_PENDING' },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully',
    });
  } catch (error: any) {
    logger.error('Error submitting payment proof:', { error: error.message });
    next(error);
  }
};

export const createRenewalRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;

    if (!workspaceId || !userId) {
      res.status(400).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { requestedUsers, requestedMonths } = req.body;
    if (!requestedUsers || !requestedMonths) {
      res.status(400).json({ success: false, message: 'Missing fields' });
      return;
    }

    const billingSettings = await prisma.platformBillingSetting.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    
    if (!billingSettings) {
      res.status(500).json({ success: false, message: 'Platform billing not configured' });
      return;
    }

    const unitPrice = billingSettings.pricePerUserPerMonth;
    const calculatedAmount = requestedUsers * requestedMonths * unitPrice;
    const paymentReference = `${billingSettings.paymentReferencePrefix}-${Date.now()}`;

    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        workspaceId,
        requestedUsers,
        requestedMonths,
        unitPrice,
        currency: billingSettings.currency,
        calculatedAmount,
        paymentReference,
        status: 'PAYMENT_REQUIRED',
        createdBy: userId,
      }
    });

    res.status(201).json({ success: true, paymentRequest });
  } catch(error: any) {
    logger.error('Error creating renewal request:', { error: error.message });
    next(error);
  }
};
