import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { getPaymentConfig } from '../../config/paymentConfig';

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

    const dbSettings = await prisma.platformBillingSetting.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const paymentConfig = getPaymentConfig();

    const billingSettings = {
      pricePerUserPerMonth: dbSettings?.pricePerUserPerMonth || paymentConfig.pricePerUserPerMonth,
      currency: dbSettings?.currency || paymentConfig.currency,
      paymentReferencePrefix: dbSettings?.paymentReferencePrefix || paymentConfig.paymentReferencePrefix,
      upiId: paymentConfig.upiId, // Derived strictly from backend ENV (null if not configured)
      upiPayeeName: paymentConfig.upiPayeeName, // Derived strictly from backend ENV
      isConfigured: paymentConfig.isConfigured,
    };

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

    const paymentConfig = getPaymentConfig();
    if (!paymentConfig.isConfigured) {
      res.status(400).json({
        success: false,
        message: 'Payment receiving account is not configured. Submissions are temporarily unavailable.',
      });
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
    const numUsers = parseInt(requestedUsers);
    const numMonths = parseInt(requestedMonths);

    if (!numUsers || numUsers <= 0 || !numMonths || numMonths <= 0) {
      res.status(400).json({ success: false, message: 'Number of users and months must be positive integers.' });
      return;
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        _count: {
          select: { users: { where: { isActive: true, deletedAt: null } } },
        },
      },
    });

    if (!workspace) {
      res.status(404).json({ success: false, message: 'Workspace not found.' });
      return;
    }

    // Enforce requested user count cannot be lower than current active users (Part 29)
    const activeCount = workspace._count.users;
    if (numUsers < activeCount) {
      res.status(400).json({
        success: false,
        message: `Renewal user count (${numUsers}) cannot be lower than your current ${activeCount} active users.`,
      });
      return;
    }

    const paymentConfig = getPaymentConfig();
    const billingSettings = await prisma.platformBillingSetting.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const unitPrice = billingSettings?.pricePerUserPerMonth || paymentConfig.pricePerUserPerMonth;
    const currency = billingSettings?.currency || paymentConfig.currency;
    const prefix = billingSettings?.paymentReferencePrefix || paymentConfig.paymentReferencePrefix;
    const calculatedAmount = numUsers * numMonths * unitPrice;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const paymentReference = `${prefix}-${dateStr}-${randomSuffix}`;

    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        workspaceId,
        requestedUsers: numUsers,
        requestedMonths: numMonths,
        unitPrice,
        currency,
        calculatedAmount,
        paymentReference,
        status: 'PAYMENT_REQUIRED',
        createdBy: userId,
      },
    });

    // If company was expired or payment required, set status to PAYMENT_REQUIRED for the new request.
    // If company is currently ACTIVE (early renewal), do NOT disrupt active status! (Part 30)
    if (workspace.billingStatus !== 'ACTIVE' && workspace.billingStatus !== 'GRACE') {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { billingStatus: 'PAYMENT_REQUIRED' },
      });
    }

    res.status(201).json({ success: true, paymentRequest });
  } catch (error: any) {
    logger.error('Error creating renewal request:', { error: error.message });
    next(error);
  }
};
