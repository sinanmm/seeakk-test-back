import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { PaymentApprovalService } from '../../modules/billing/paymentApproval.service';
import { CompanyControlService } from '../../modules/billing/companyControl.service';
import { evaluateCompanyAccess } from '../../modules/billing/companyAccess.service';
import { getSeatUsage } from '../../modules/billing/seatUsage.service';
import auditService from '../../services/Audit/auditService';
import path from 'path';
import fs from 'fs';

/**
 * Platform Overview Dashboard Metrics (Part 48)
 */
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [
      totalCompanies,
      activeCompanies,
      expiredCompanies,
      paymentPendingCompanies,
      paymentRequiredCompanies,
      graceCompanies,
      lockedCompanies,
      suspendedCompanies,
      totalRevenueAgg,
      todayRevenueAgg,
      monthRevenueAgg,
      yearRevenueAgg,
      pendingVerificationAgg,
    ] = await Promise.all([
      prisma.workspace.count(),
      prisma.workspace.count({ where: { billingStatus: 'ACTIVE' } }),
      prisma.workspace.count({ where: { billingStatus: 'EXPIRED' } }),
      prisma.workspace.count({ where: { billingStatus: 'PAYMENT_PENDING' } }),
      prisma.workspace.count({ where: { billingStatus: 'PAYMENT_REQUIRED' } }),
      prisma.graceRecord.count({ where: { status: 'ACTIVE', graceUntil: { gt: now } } }),
      prisma.workspace.count({ where: { lockedAt: { not: null } } }),
      prisma.workspace.count({ where: { suspendReason: { not: null } } }),
      // Verified revenue aggregations (Part 60)
      prisma.verifiedPayment.aggregate({
        _sum: { amount: true, requestedUsers: true, requestedMonths: true },
        _count: { id: true },
        where: { status: 'VERIFIED' },
      }),
      prisma.verifiedPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'VERIFIED', approvedAt: { gte: startOfToday } },
      }),
      prisma.verifiedPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'VERIFIED', approvedAt: { gte: startOfMonth } },
      }),
      prisma.verifiedPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'VERIFIED', approvedAt: { gte: startOfYear } },
      }),
      // Pending verification amount
      prisma.paymentRequest.aggregate({
        _sum: { calculatedAmount: true },
        where: { status: 'PAYMENT_PENDING' },
      }),
    ]);

    // Calculate user-months sold strictly from verified payments (Part 61)
    const verifiedPayments = await prisma.verifiedPayment.findMany({
      where: { status: 'VERIFIED' },
      select: { requestedUsers: true, requestedMonths: true },
    });
    const userMonthsSold = verifiedPayments.reduce(
      (sum, p) => sum + (p.requestedUsers || 0) * (p.requestedMonths || 0),
      0,
    );

    return res.status(200).json({
      success: true,
      companies: {
        total: totalCompanies,
        active: activeCompanies,
        expired: expiredCompanies,
        paymentPending: paymentPendingCompanies,
        paymentRequired: paymentRequiredCompanies,
        grace: graceCompanies,
        locked: lockedCompanies,
        suspended: suspendedCompanies,
      },
      revenue: {
        totalVerified: totalRevenueAgg._sum.amount || 0,
        todayVerified: todayRevenueAgg._sum.amount || 0,
        thisMonthVerified: monthRevenueAgg._sum.amount || 0,
        thisYearVerified: yearRevenueAgg._sum.amount || 0,
        verifiedPaymentCount: totalRevenueAgg._count.id || 0,
        userMonthsSold,
        pendingVerificationAmount: pendingVerificationAgg._sum.calculatedAmount || 0,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching platform dashboard:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * List Companies with search, filter, pagination, and seat usage (Part 49)
 */
export const getCompanies = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();

    const where: any = {};
    if (search) {
      where.companyName = { contains: search, mode: 'insensitive' };
    }
    if (status) {
      if (status === 'LOCKED') {
        where.lockedAt = { not: null };
      } else if (status === 'SUSPENDED') {
        where.suspendReason = { not: null };
      } else {
        where.billingStatus = status;
      }
    }

    const [workspaces, total] = await Promise.all([
      prisma.workspace.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          companyName: true,
          billingStatus: true,
          approvedUserLimit: true,
          accessFrom: true,
          accessUntil: true,
          lockedAt: true,
          lockReason: true,
          suspendReason: true,
          createdAt: true,
          paymentRequests: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              calculatedAmount: true,
              status: true,
              paymentReference: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              users: { where: { isActive: true, deletedAt: null } },
            },
          },
        },
      }),
      prisma.workspace.count({ where }),
    ]);

    const items = workspaces.map((ws) => {
      const activeUserCount = ws._count.users;
      const approvedLimit = ws.approvedUserLimit || 0;
      const availableSeats = ws.approvedUserLimit !== null ? Math.max(0, approvedLimit - activeUserCount) : null;
      return {
        id: ws.id,
        companyName: ws.companyName,
        billingStatus: ws.billingStatus || 'LEGACY',
        approvedUserLimit: ws.approvedUserLimit,
        activeUserCount,
        availableSeats,
        accessFrom: ws.accessFrom,
        accessUntil: ws.accessUntil,
        isLocked: Boolean(ws.lockedAt),
        lockReason: ws.lockReason,
        isSuspended: Boolean(ws.suspendReason),
        suspendReason: ws.suspendReason,
        latestPaymentRequest: ws.paymentRequests[0] || null,
        createdAt: ws.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching platform companies:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Company Details Internal API (Part 50)
 */
export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');

    const workspace = await (prisma as any).workspace.findUnique({
      where: { id },
      include: {
        paymentRequests: {
          orderBy: { createdAt: 'desc' },
          include: { paymentSubmissions: true, verifiedPayments: true },
        },
        graceRecords: { orderBy: { grantedAt: 'desc' } },
      },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const [seatUsage, accessDecision] = await Promise.all([
      getSeatUsage(workspace.id),
      evaluateCompanyAccess(workspace),
    ]);

    return res.status(200).json({
      success: true,
      company: {
        id: workspace.id,
        companyName: workspace.companyName,
        billingStatus: workspace.billingStatus || 'LEGACY',
        approvedUserLimit: workspace.approvedUserLimit,
        accessFrom: workspace.accessFrom,
        accessUntil: workspace.accessUntil,
        lockedAt: workspace.lockedAt,
        lockReason: workspace.lockReason,
        suspendReason: workspace.suspendReason,
        createdAt: workspace.createdAt,
      },
      seatUsage,
      effectiveAccessDecision: accessDecision,
      paymentRequests: workspace.paymentRequests || [],
      graceRecords: workspace.graceRecords || [],
    });
  } catch (error: any) {
    logger.error('Error fetching company details:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Company Users Internal API (Part 51)
 */
export const getCompanyUsers = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');

    const users = await (prisma as any).user.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    const items = users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      isDeleted: Boolean(u.deletedAt),
      seatConsuming: u.isActive && !u.deletedAt,
      role: u.role?.name || 'user',
      createdAt: u.createdAt,
    }));

    return res.status(200).json({ success: true, items });
  } catch (error: any) {
    logger.error('Error fetching company users:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Payment Request List Internal API (Part 52)
 */
export const getPaymentRequests = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const status = String(req.query.status || '').trim();
    const workspaceId = String(req.query.workspaceId || '').trim();

    const where: any = {};
    if (status) where.status = status;
    if (workspaceId) where.workspaceId = workspaceId;

    const [requests, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          workspace: { select: { id: true, companyName: true, billingStatus: true } },
          paymentSubmissions: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.paymentRequest.count({ where }),
    ]);

    const items = requests.map((r: any) => {
      const sub = r.paymentSubmissions?.[0];
      return {
        id: r.id,
        paymentReference: r.paymentReference,
        workspaceId: r.workspaceId,
        companyName: r.workspace?.companyName,
        requestedUsers: r.requestedUsers,
        requestedMonths: r.requestedMonths,
        unitPrice: r.unitPrice,
        currency: r.currency,
        calculatedAmount: r.calculatedAmount,
        status: r.status,
        createdAt: r.createdAt,
        submission: sub
          ? {
              id: sub.id,
              utrNumber: sub.utrNumber,
              paymentDate: sub.paymentDate,
              paymentMethod: sub.paymentMethod,
              submittedAt: sub.submittedAt,
              hasProof: Boolean(sub.proofStorageKey),
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching payment requests:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Payment Request Details Internal API (Part 53)
 */
export const getPaymentRequestDetails = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');

    const paymentRequest = await (prisma as any).paymentRequest.findUnique({
      where: { id },
      include: {
        workspace: {
          select: {
            id: true,
            companyName: true,
            billingStatus: true,
            approvedUserLimit: true,
            accessFrom: true,
            accessUntil: true,
          },
        },
        paymentSubmissions: {
          orderBy: { submittedAt: 'desc' },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        verifiedPayments: true,
      },
    });

    if (!paymentRequest) {
      return res.status(404).json({ success: false, message: 'Payment request not found' });
    }

    const seatUsage = await getSeatUsage(paymentRequest.workspaceId);

    return res.status(200).json({
      success: true,
      paymentRequest,
      seatUsage,
    });
  } catch (error: any) {
    logger.error('Error fetching payment request details:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Secure Payment Proof View / Download (Part 54)
 */
export const getPaymentProof = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');

    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { paymentSubmissions: { orderBy: { submittedAt: 'desc' }, take: 1 } },
    });

    if (!paymentRequest || !paymentRequest.paymentSubmissions[0]?.proofStorageKey) {
      return res.status(404).json({ success: false, message: 'Payment proof screenshot not found' });
    }

    const storageKey = paymentRequest.paymentSubmissions[0].proofStorageKey;

    // Support local upload storage resolution
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, path.basename(storageKey));

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    return res.status(200).json({
      success: true,
      proofStorageKey: storageKey,
    });
  } catch (error: any) {
    logger.error('Error serving payment proof:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Approve Payment API (Part 55)
 */
export const approvePayment = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { approvedUserLimit, accessFrom, accessUntil, remarks, approvedBy } = req.body;

    const result = await PaymentApprovalService.approvePayment({
      paymentRequestId: id,
      approvedUserLimit,
      accessFrom,
      accessUntil,
      remarks,
      approvedBy,
      auditContext: { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in approvePayment API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Reject Payment API (Part 56)
 */
export const rejectPayment = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { reason, remarks, rejectedBy } = req.body;

    const result = await PaymentApprovalService.rejectPayment({
      paymentRequestId: id,
      rejectionReason: reason,
      remarks,
      rejectedBy,
      auditContext: { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in rejectPayment API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Grant Grace API (Part 57)
 */
export const grantGrace = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { allowedUserLimit, graceFrom, graceUntil, reason, grantedBy } = req.body;

    const record = await CompanyControlService.grantGrace({
      workspaceId: id,
      allowedUserLimit,
      graceFrom,
      graceUntil,
      reason,
      grantedBy,
      auditContext: { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });

    return res.status(201).json({ success: true, message: 'Grace period granted.', graceRecord: record });
  } catch (error: any) {
    logger.error('Error in grantGrace API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Revoke Grace API
 */
export const revokeGrace = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { reason, revokedBy } = req.body;

    const result = await CompanyControlService.revokeGrace(id, revokedBy, reason, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in revokeGrace API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Lock Company API (Part 58)
 */
export const lockCompany = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { reason, lockedBy } = req.body;

    const result = await CompanyControlService.lockCompany(id, reason, lockedBy, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in lockCompany API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Unlock Company API (Part 58)
 */
export const unlockCompany = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { unlockedBy } = req.body;

    const result = await CompanyControlService.unlockCompany(id, unlockedBy, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in unlockCompany API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Suspend Company API (Part 59)
 */
export const suspendCompany = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { reason, suspendedBy } = req.body;

    const result = await CompanyControlService.suspendCompany(id, reason, suspendedBy, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in suspendCompany API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Unsuspend Company API (Part 59)
 */
export const unsuspendCompany = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const { unsuspendedBy } = req.body;

    const result = await CompanyControlService.unsuspendCompany(id, unsuspendedBy, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in unsuspendCompany API:', { error: error.message });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
};

/**
 * Revenue API (Part 60 & 61)
 */
export const getRevenue = async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;

    const where: any = { status: 'VERIFIED' };
    if (startDate || endDate) {
      where.approvedAt = {};
      if (startDate) where.approvedAt.gte = startDate;
      if (endDate) where.approvedAt.lte = endDate;
    }

    const [agg, verifiedPayments] = await Promise.all([
      prisma.verifiedPayment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where,
      }),
      prisma.verifiedPayment.findMany({
        where,
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          requestedUsers: true,
          requestedMonths: true,
          approvedAt: true,
          workspace: { select: { id: true, companyName: true } },
        },
      }),
    ]);

    const userMonthsSold = verifiedPayments.reduce(
      (sum, p) => sum + (p.requestedUsers || 0) * (p.requestedMonths || 0),
      0,
    );

    return res.status(200).json({
      success: true,
      revenueTotal: agg._sum.amount || 0,
      verifiedPaymentCount: agg._count.id || 0,
      userMonthsSold,
      payments: verifiedPayments,
    });
  } catch (error: any) {
    logger.error('Error in getRevenue API:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Audit Logs API (Part 63)
 */
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;
    const workspaceId = String(req.query.workspaceId || '').trim() || undefined;
    const action = String(req.query.action || '').trim() || undefined;

    const result = await auditService.getLogs({
      workspaceId,
      action,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      items: result.logs,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error: any) {
    logger.error('Error fetching audit logs:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
