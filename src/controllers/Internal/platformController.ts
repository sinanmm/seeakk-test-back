import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { PaymentApprovalService } from '../../modules/billing/paymentApproval.service';
import { CompanyControlService } from '../../modules/billing/companyControl.service';
import { evaluateCompanyAccess } from '../../modules/billing/companyAccess.service';
import { getSeatUsage } from '../../modules/billing/seatUsage.service';
import { ModuleEntitlementService } from '../../modules/billing/moduleEntitlement.service';
import auditService from '../../services/Audit/auditService';
import path from 'path';
import fs from 'fs';

/**
 * Platform Overview Dashboard Metrics (Part 48 & Control Metrics)
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
      plansWithWorkspaces,
      verifiedPaymentsWithPlan,
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
      // Plan distribution
      prisma.plan.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          _count: {
            select: {
              workspaces: true,
            },
          },
        },
      }),
      prisma.verifiedPayment.findMany({
        where: { status: 'VERIFIED' },
        select: {
          amount: true,
          planCodeSnapshot: true,
          requestedUsers: true,
          requestedMonths: true,
        },
      }),
    ]);

    const userMonthsSold = verifiedPaymentsWithPlan.reduce(
      (sum, p) => sum + (p.requestedUsers || 0) * (p.requestedMonths || 0),
      0,
    );

    // Aggregate verified revenue by plan code
    const revenueByPlanMap: Record<string, number> = {};
    for (const vp of verifiedPaymentsWithPlan) {
      const code = vp.planCodeSnapshot || 'LEGACY';
      revenueByPlanMap[code] = (revenueByPlanMap[code] || 0) + (vp.amount || 0);
    }

    const companiesByPlan = plansWithWorkspaces.map((p) => ({
      planId: p.id,
      code: p.code,
      name: p.name,
      totalCompanies: p._count.workspaces,
    }));

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
        byPlan: companiesByPlan,
      },
      revenue: {
        totalVerified: totalRevenueAgg._sum.amount || 0,
        todayVerified: todayRevenueAgg._sum.amount || 0,
        thisMonthVerified: monthRevenueAgg._sum.amount || 0,
        thisYearVerified: yearRevenueAgg._sum.amount || 0,
        verifiedPaymentCount: totalRevenueAgg._count.id || 0,
        userMonthsSold,
        pendingVerificationAmount: pendingVerificationAgg._sum.calculatedAmount || 0,
        byPlan: revenueByPlanMap,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching platform dashboard:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * List Canonical Modules Catalog
 */
export const getModules = async (req: Request, res: Response) => {
  try {
    const modules = await prisma.appModule.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return res.status(200).json({ success: true, items: modules });
  } catch (error: any) {
    logger.error('Error fetching modules catalog:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * List Plans (with module counts and active company counts)
 */
export const getPlans = async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const where: any = {};
    if (!includeArchived) {
      where.isArchived = false;
    }

    const plans = await prisma.plan.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      include: {
        modules: {
          where: { enabled: true, module: { isActive: true } },
          include: { module: { select: { id: true, key: true, name: true } } },
        },
        _count: {
          select: {
            workspaces: true,
            paymentRequests: true,
            verifiedPayments: true,
          },
        },
      },
    });

    const items = plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      pricePerUserMonth: p.pricePerUserMonth,
      currency: p.currency,
      isActive: p.isActive,
      isArchived: p.isArchived,
      sortOrder: p.sortOrder,
      enabledModules: p.modules.map((m) => ({
        id: m.module.id,
        key: m.module.key,
        name: m.module.name,
      })),
      companyCount: p._count.workspaces,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return res.status(200).json({ success: true, items });
  } catch (error: any) {
    logger.error('Error fetching plans:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get Single Plan Details
 */
export const getPlanDetails = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    const [plan, allModules] = await Promise.all([
      prisma.plan.findUnique({
        where: { id },
        include: {
          modules: {
            include: { module: true },
          },
          _count: {
            select: { workspaces: true },
          },
        },
      }),
      prisma.appModule.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const enabledModuleIds = new Set(
      plan.modules.filter((pm) => pm.enabled).map((pm) => pm.moduleId)
    );

    const modules = allModules.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      description: m.description,
      enabled: enabledModuleIds.has(m.id),
    }));

    return res.status(200).json({
      success: true,
      plan: {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        pricePerUserMonth: plan.pricePerUserMonth,
        currency: plan.currency,
        isActive: plan.isActive,
        isArchived: plan.isArchived,
        sortOrder: plan.sortOrder,
        companyCount: plan._count.workspaces,
        modules,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching plan details:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Create New Plan
 */
export const createPlan = async (req: Request, res: Response) => {
  try {
    const { code, name, description, pricePerUserMonth, currency = 'INR', sortOrder = 0, modules = [] } = req.body;

    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim();
    const numPrice = parseInt(String(pricePerUserMonth), 10);

    if (!normalizedCode || !normalizedName) {
      return res.status(400).json({ success: false, message: 'Plan code and name are required.' });
    }

    if (isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Price per user per month must be a positive integer.' });
    }

    const existing = await prisma.plan.findUnique({ where: { code: normalizedCode } });
    if (existing) {
      return res.status(400).json({ success: false, message: `Plan with code '${normalizedCode}' already exists.` });
    }

    const canonicalModules = await prisma.appModule.findMany({ where: { isActive: true } });
    const moduleByKey = new Map(canonicalModules.map((m) => [m.key, m.id]));
    const moduleById = new Map(canonicalModules.map((m) => [m.id, m.id]));

    const result = await prisma.$transaction(async (tx) => {
      const newPlan = await tx.plan.create({
        data: {
          code: normalizedCode,
          name: normalizedName,
          description: description ? String(description).trim() : null,
          pricePerUserMonth: numPrice,
          currency: String(currency).trim().toUpperCase() || 'INR',
          sortOrder: Number(sortOrder) || 0,
          isActive: true,
          isArchived: false,
        },
      });

      // Assign modules
      const planModuleCreates: { planId: string; moduleId: string; enabled: boolean }[] = [];

      for (const cm of canonicalModules) {
        let isEnabled = false;
        if (Array.isArray(modules)) {
          // Check if module is specified in array (either as string key/id or object { key/id, enabled })
          for (const item of modules) {
            if (typeof item === 'string') {
              if (item === cm.key || item === cm.id) isEnabled = true;
            } else if (typeof item === 'object' && item !== null) {
              if ((item.key === cm.key || item.id === cm.id || item.moduleId === cm.id) && item.enabled !== false) {
                isEnabled = true;
              }
            }
          }
        }

        planModuleCreates.push({
          planId: newPlan.id,
          moduleId: cm.id,
          enabled: isEnabled,
        });
      }

      await tx.planModule.createMany({ data: planModuleCreates });
      return newPlan;
    });

    await auditService.log({
      action: 'PLAN_CREATED',
      entityType: 'Plan',
      entityId: result.id,
      details: {
        code: result.code,
        name: result.name,
        pricePerUserMonth: result.pricePerUserMonth,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Plan created successfully', { planId: result.id, code: result.code });

    return res.status(201).json({ success: true, plan: result });
  } catch (error: any) {
    logger.error('Error creating plan:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update Plan
 */
export const updatePlan = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    const { name, description, pricePerUserMonth, currency, sortOrder, isActive, modules } = req.body;

    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (pricePerUserMonth !== undefined) {
      const numPrice = parseInt(String(pricePerUserMonth), 10);
      if (isNaN(numPrice) || numPrice <= 0) {
        return res.status(400).json({ success: false, message: 'Price per user per month must be a positive integer.' });
      }
      data.pricePerUserMonth = numPrice;
    }
    if (currency !== undefined) data.currency = String(currency).trim().toUpperCase();
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const result = await prisma.$transaction(async (tx) => {
      const updatedPlan = await tx.plan.update({
        where: { id },
        data,
      });

      if (Array.isArray(modules)) {
        const canonicalModules = await tx.appModule.findMany({ where: { isActive: true } });

        for (const cm of canonicalModules) {
          let isEnabled = false;
          for (const item of modules) {
            if (typeof item === 'string') {
              if (item === cm.key || item === cm.id) isEnabled = true;
            } else if (typeof item === 'object' && item !== null) {
              if ((item.key === cm.key || item.id === cm.id || item.moduleId === cm.id) && item.enabled !== false) {
                isEnabled = true;
              }
            }
          }

          await tx.planModule.upsert({
            where: { planId_moduleId: { planId: id, moduleId: cm.id } },
            create: { planId: id, moduleId: cm.id, enabled: isEnabled },
            update: { enabled: isEnabled },
          });
        }
      }

      return updatedPlan;
    });

    await auditService.log({
      action: 'PLAN_UPDATED',
      entityType: 'Plan',
      entityId: result.id,
      details: {
        code: result.code,
        changes: data,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Plan updated successfully', { planId: result.id, code: result.code });
    return res.status(200).json({ success: true, plan: result });
  } catch (error: any) {
    logger.error('Error updating plan:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Archive Plan
 */
export const archivePlan = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const updated = await prisma.plan.update({
      where: { id },
      data: { isArchived: true, isActive: false },
    });

    await auditService.log({
      action: 'PLAN_ARCHIVED',
      entityType: 'Plan',
      entityId: id,
      details: { code: existing.code },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('Plan archived successfully', { planId: id, code: existing.code });
    return res.status(200).json({ success: true, message: 'Plan archived successfully.', plan: updated });
  } catch (error: any) {
    logger.error('Error archiving plan:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * List Companies with search, filter, pagination, plan info, and seat usage (Part 49 & Control)
 */
export const getCompanies = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const planCode = String(req.query.plan || '').trim().toUpperCase();

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
    if (planCode) {
      where.activePlan = { code: planCode };
    }

    const [workspaces, total] = await Promise.all([
      prisma.workspace.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          activePlan: {
            select: { id: true, code: true, name: true, pricePerUserMonth: true, currency: true },
          },
          paymentRequests: {
            take: 2,
            orderBy: { createdAt: 'desc' },
            include: { requestedPlan: { select: { id: true, code: true, name: true } } },
          },
          graceRecords: {
            where: { status: 'ACTIVE', graceUntil: { gt: new Date() } },
            take: 1,
            orderBy: { graceUntil: 'desc' },
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

    const items = workspaces.map((ws: any) => {
      const activeUserCount = ws._count.users;
      const approvedLimit = ws.approvedUserLimit || 0;
      const availableSeats = ws.approvedUserLimit !== null ? Math.max(0, approvedLimit - activeUserCount) : null;
      const isOverLimit = ws.approvedUserLimit !== null && activeUserCount > ws.approvedUserLimit;

      const latestReq = ws.paymentRequests[0] || null;
      const pendingReq = ws.paymentRequests.find((r: any) => r.status === 'PAYMENT_PENDING') || null;

      return {
        id: ws.id,
        companyName: ws.companyName,
        currentPlan: ws.activePlan
          ? {
              id: ws.activePlan.id,
              code: ws.activePlan.code,
              name: ws.activePlan.name,
            }
          : null,
        billing: {
          billingStatus: ws.billingStatus || 'LEGACY',
          accessFrom: ws.accessFrom,
          accessUntil: ws.accessUntil,
        },
        seats: {
          approvedUserLimit: ws.approvedUserLimit,
          activeUserCount,
          availableSeats,
          isOverLimit,
        },
        controls: {
          isLocked: Boolean(ws.lockedAt),
          lockReason: ws.lockReason,
          isSuspended: Boolean(ws.suspendReason),
          suspendReason: ws.suspendReason,
          graceActive: ws.graceRecords.length > 0,
        },
        latestPaymentRequest: latestReq
          ? {
              id: latestReq.id,
              calculatedAmount: latestReq.calculatedAmount,
              status: latestReq.status,
              paymentReference: latestReq.paymentReference,
              planCode: latestReq.planCodeSnapshot || latestReq.requestedPlan?.code || null,
              createdAt: latestReq.createdAt,
            }
          : null,
        pendingChange: pendingReq
          ? {
              paymentRequestId: pendingReq.id,
              requestedPlan: pendingReq.requestedPlan
                ? { id: pendingReq.requestedPlan.id, code: pendingReq.requestedPlan.code, name: pendingReq.requestedPlan.name }
                : null,
              requestedUsers: pendingReq.requestedUsers,
              requestedMonths: pendingReq.requestedMonths,
              amount: pendingReq.calculatedAmount,
              status: pendingReq.status,
            }
          : null,
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
 * Company Details Internal API (Part 50 & Complete Control Contract)
 */
export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        activePlan: true,
        paymentRequests: {
          orderBy: { createdAt: 'desc' },
          include: {
            requestedPlan: true,
            paymentSubmissions: { orderBy: { submittedAt: 'desc' } },
            verifiedPayments: { include: { plan: true }, orderBy: { approvedAt: 'desc' } },
          },
        },
        graceRecords: { orderBy: { grantedAt: 'desc' } },
      },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const [seatUsage, accessDecision, enabledModules, allCanonicalModules] = await Promise.all([
      getSeatUsage(workspace.id),
      evaluateCompanyAccess(workspace),
      ModuleEntitlementService.getEnabledModules(workspace.id),
      prisma.appModule.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

    const enabledSet = new Set(enabledModules);
    const modules = allCanonicalModules.map((m) => ({
      key: m.key,
      name: m.name,
      enabled: enabledSet.has(m.key),
    }));

    const activeGrace = workspace.graceRecords.find((g) => g.status === 'ACTIVE' && new Date(g.graceUntil) > new Date());

    // Find latest verified payment
    let latestVerified: any = null;
    for (const pr of workspace.paymentRequests) {
      if (pr.verifiedPayments && pr.verifiedPayments.length > 0) {
        latestVerified = pr.verifiedPayments[0];
        break;
      }
    }

    // Find pending change
    const pendingReq = workspace.paymentRequests.find((pr) => pr.status === 'PAYMENT_PENDING');

    const isOverLimit = workspace.approvedUserLimit !== null && seatUsage.activeUserCount > workspace.approvedUserLimit;

    return res.status(200).json({
      success: true,
      company: {
        id: workspace.id,
        companyName: workspace.companyName,
        createdAt: workspace.createdAt,
      },
      plan: workspace.activePlan
        ? {
            id: workspace.activePlan.id,
            code: workspace.activePlan.code,
            name: workspace.activePlan.name,
            pricePerUserMonth: workspace.activePlan.pricePerUserMonth,
            currency: workspace.activePlan.currency,
          }
        : null,
      entitlement: {
        billingStatus: workspace.billingStatus || 'LEGACY',
        approvedUserLimit: workspace.approvedUserLimit,
        activeUserCount: seatUsage.activeUserCount,
        availableSeats: seatUsage.availableUserCount,
        isOverLimit,
        accessFrom: workspace.accessFrom,
        accessUntil: workspace.accessUntil,
        effectiveStatus: accessDecision.reason,
        entitlementSource: accessDecision.entitlementSource,
      },
      modules,
      controls: {
        locked: Boolean(workspace.lockedAt),
        lockedAt: workspace.lockedAt,
        lockReason: workspace.lockReason,
        suspended: Boolean(workspace.suspendReason),
        suspendReason: workspace.suspendReason,
        graceActive: Boolean(activeGrace),
        graceUntil: activeGrace ? activeGrace.graceUntil : null,
      },
      currentPayment: latestVerified
        ? {
            verifiedPaymentId: latestVerified.id,
            plan: latestVerified.plan
              ? { id: latestVerified.plan.id, code: latestVerified.plan.code, name: latestVerified.plan.name }
              : null,
            planCodeSnapshot: latestVerified.planCodeSnapshot,
            planNameSnapshot: latestVerified.planNameSnapshot,
            requestedUsers: latestVerified.requestedUsers,
            requestedMonths: latestVerified.requestedMonths,
            unitPriceSnapshot: latestVerified.unitPriceSnapshot,
            amount: latestVerified.amount,
            currency: latestVerified.currency,
            approvedAt: latestVerified.approvedAt,
          }
        : null,
      pendingChange: pendingReq
        ? {
            paymentRequestId: pendingReq.id,
            requestedPlan: pendingReq.requestedPlan
              ? { id: pendingReq.requestedPlan.id, code: pendingReq.requestedPlan.code, name: pendingReq.requestedPlan.name }
              : null,
            requestedUsers: pendingReq.requestedUsers,
            requestedMonths: pendingReq.requestedMonths,
            amount: pendingReq.calculatedAmount,
            status: pendingReq.status,
          }
        : null,
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
    const id = String(req.params.id || '').trim();

    const [workspace, users, seatUsage] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id },
        select: { id: true, approvedUserLimit: true },
      }),
      prisma.user.findMany({
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
      }),
      getSeatUsage(id),
    ]);

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

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

    return res.status(200).json({
      success: true,
      companyId: workspace.id,
      approvedUserLimit: workspace.approvedUserLimit,
      activeUserCount: seatUsage.activeUserCount,
      availableSeats: seatUsage.availableUserCount,
      isOverLimit: workspace.approvedUserLimit !== null && seatUsage.activeUserCount > workspace.approvedUserLimit,
      items,
    });
  } catch (error: any) {
    logger.error('Error fetching company users:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Company Effective Entitlement API (Normalized for Control)
 */
export const getCompanyEntitlement = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        activePlan: true,
        graceRecords: {
          where: { status: 'ACTIVE', graceUntil: { gt: new Date() } },
          take: 1,
          orderBy: { graceUntil: 'desc' },
        },
      },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const [seatUsage, accessDecision, enabledModules] = await Promise.all([
      getSeatUsage(workspace.id),
      evaluateCompanyAccess(workspace),
      ModuleEntitlementService.getEnabledModules(workspace.id),
    ]);

    const isOverLimit = workspace.approvedUserLimit !== null && seatUsage.activeUserCount > workspace.approvedUserLimit;
    const activeGrace = workspace.graceRecords[0] || null;

    return res.status(200).json({
      success: true,
      effectiveStatus: accessDecision.reason,
      entitlementSource: accessDecision.entitlementSource,
      plan: workspace.activePlan
        ? {
            id: workspace.activePlan.id,
            code: workspace.activePlan.code,
            name: workspace.activePlan.name,
            pricePerUserMonth: workspace.activePlan.pricePerUserMonth,
            currency: workspace.activePlan.currency,
          }
        : null,
      approvedUserLimit: workspace.approvedUserLimit,
      activeUserCount: seatUsage.activeUserCount,
      availableSeats: seatUsage.availableUserCount,
      isOverLimit,
      accessFrom: workspace.accessFrom,
      accessUntil: workspace.accessUntil,
      enabledModules,
      graceState: {
        isActive: Boolean(activeGrace),
        graceUntil: activeGrace ? activeGrace.graceUntil : null,
      },
      lockState: {
        isLocked: Boolean(workspace.lockedAt),
        lockedAt: workspace.lockedAt,
        lockReason: workspace.lockReason,
      },
      suspendState: {
        isSuspended: Boolean(workspace.suspendReason),
        suspendReason: workspace.suspendReason,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching company entitlement:', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Payment Request List Internal API (Part 52 & Control)
 */
export const getPaymentRequests = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const status = String(req.query.status || '').trim();
    const workspaceId = String(req.query.workspaceId || '').trim();
    const planCode = String(req.query.plan || '').trim().toUpperCase();

    const where: any = {};
    if (status) where.status = status;
    if (workspaceId) where.workspaceId = workspaceId;
    if (planCode) {
      where.OR = [
        { planCodeSnapshot: planCode },
        { requestedPlan: { code: planCode } },
      ];
    }

    const [requests, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          workspace: { select: { id: true, companyName: true, billingStatus: true } },
          requestedPlan: { select: { id: true, code: true, name: true } },
          paymentSubmissions: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
          verifiedPayments: {
            take: 1,
            select: { approvedAt: true, approvedBy: true },
          },
        },
      }),
      prisma.paymentRequest.count({ where }),
    ]);

    const items = requests.map((r: any) => {
      const sub = r.paymentSubmissions?.[0];
      const verified = r.verifiedPayments?.[0];
      return {
        paymentRequestId: r.id,
        workspaceId: r.workspaceId,
        companyName: r.workspace?.companyName,
        requestedPlan: r.requestedPlan
          ? { id: r.requestedPlan.id, code: r.requestedPlan.code, name: r.requestedPlan.name }
          : null,
        planCodeSnapshot: r.planCodeSnapshot || r.requestedPlan?.code || null,
        planNameSnapshot: r.planNameSnapshot || r.requestedPlan?.name || null,
        requestedUsers: r.requestedUsers,
        requestedMonths: r.requestedMonths,
        unitPrice: r.unitPrice,
        calculatedAmount: r.calculatedAmount,
        currency: r.currency,
        paymentReference: r.paymentReference,
        status: r.status,
        submission: sub
          ? {
              id: sub.id,
              utrNumber: sub.utrNumber,
              paymentDate: sub.paymentDate,
              paymentMethod: sub.paymentMethod,
              remarks: sub.remarks,
              submittedAt: sub.submittedAt,
              proofAvailable: Boolean(sub.proofStorageKey),
            }
          : null,
        createdAt: r.createdAt,
        submittedAt: sub?.submittedAt || null,
        approvedAt: verified?.approvedAt || null,
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
 * Payment Request Details Internal API (Part 53 & Control)
 */
export const getPaymentRequestDetails = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            activePlan: { select: { id: true, code: true, name: true, pricePerUserMonth: true, currency: true } },
          },
        },
        requestedPlan: { select: { id: true, code: true, name: true, pricePerUserMonth: true, currency: true } },
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

    const [seatUsage, accessDecision] = await Promise.all([
      getSeatUsage(paymentRequest.workspaceId),
      evaluateCompanyAccess(paymentRequest.workspace),
    ]);

    const latestSubmission = paymentRequest.paymentSubmissions[0] || null;

    return res.status(200).json({
      success: true,
      paymentRequestId: paymentRequest.id,
      paymentReference: paymentRequest.paymentReference,
      status: paymentRequest.status,
      company: {
        id: paymentRequest.workspace.id,
        companyName: paymentRequest.workspace.companyName,
      },
      currentPlan: paymentRequest.workspace.activePlan
        ? {
            id: paymentRequest.workspace.activePlan.id,
            code: paymentRequest.workspace.activePlan.code,
            name: paymentRequest.workspace.activePlan.name,
          }
        : null,
      requestedPlan: paymentRequest.requestedPlan
        ? {
            id: paymentRequest.requestedPlan.id,
            code: paymentRequest.requestedPlan.code,
            name: paymentRequest.requestedPlan.name,
            pricePerUserMonth: paymentRequest.requestedPlan.pricePerUserMonth,
            currency: paymentRequest.requestedPlan.currency,
          }
        : null,
      planCodeSnapshot: paymentRequest.planCodeSnapshot,
      planNameSnapshot: paymentRequest.planNameSnapshot,
      requestedUsers: paymentRequest.requestedUsers,
      requestedMonths: paymentRequest.requestedMonths,
      unitPrice: paymentRequest.unitPrice,
      amount: paymentRequest.calculatedAmount,
      currency: paymentRequest.currency,
      submission: latestSubmission
        ? {
            id: latestSubmission.id,
            utrNumber: latestSubmission.utrNumber,
            paymentDate: latestSubmission.paymentDate,
            paymentMethod: latestSubmission.paymentMethod,
            remarks: latestSubmission.remarks,
            proofAvailable: Boolean(latestSubmission.proofStorageKey),
            submittedBy: latestSubmission.user,
            submittedAt: latestSubmission.submittedAt,
          }
        : null,
      currentEntitlement: {
        activePlan: paymentRequest.workspace.activePlan?.code || 'LEGACY',
        approvedUserLimit: paymentRequest.workspace.approvedUserLimit,
        activeUserCount: seatUsage.activeUserCount,
        availableSeats: seatUsage.availableUserCount,
        accessFrom: paymentRequest.workspace.accessFrom,
        accessUntil: paymentRequest.workspace.accessUntil,
        effectiveStatus: accessDecision.reason,
      },
      createdAt: paymentRequest.createdAt,
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
    const id = String(req.params.id || '').trim();

    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { paymentSubmissions: { orderBy: { submittedAt: 'desc' }, take: 1 } },
    });

    if (!paymentRequest || !paymentRequest.paymentSubmissions[0]?.proofStorageKey) {
      return res.status(404).json({ success: false, message: 'Payment proof screenshot not found' });
    }

    const storageKey = paymentRequest.paymentSubmissions[0].proofStorageKey;
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
    const id = String(req.params.id || '').trim();
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
          planCodeSnapshot: true,
          planNameSnapshot: true,
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
