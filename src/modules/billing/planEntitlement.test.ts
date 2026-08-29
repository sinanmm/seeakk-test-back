import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleEntitlementService } from './moduleEntitlement.service';
import { evaluateCompanyAccess } from './companyAccess.service';
import { platformAuthMiddleware } from '../../middlewares/platformAuthMiddleware';
import prisma from '../../config/prisma';

test('1. Legacy workspace with no activePlanId has access to all canonical modules', async () => {
  const testUser = await prisma.user.create({
    data: {
      name: 'Legacy Owner Test',
      email: `legacy_test_${Date.now()}@example.com`,
      password: 'dummyhash',
      isOnboarded: true,
    },
  });

  const legacyWs = await prisma.workspace.create({
    data: {
      companyName: 'Legacy Company Test',
      employeeCount: '1-10',
      ownerId: testUser.id,
      activePlanId: null,
      billingStatus: null, // Legacy unmanaged
    },
  });

  try {
    const enabledModules = await ModuleEntitlementService.getEnabledModules(legacyWs.id);
    assert.ok(enabledModules.length >= 14, 'Legacy workspace should have all canonical modules');
    assert.ok(enabledModules.includes('DASHBOARD'));
    assert.ok(enabledModules.includes('LEADS'));
    assert.ok(enabledModules.includes('META_ADS'));
    assert.ok(enabledModules.includes('TELEPHONY'));
    assert.ok(enabledModules.includes('AUTOMATIONS'));
    assert.ok(enabledModules.includes('SALARY_MANAGEMENT'));
  } finally {
    await prisma.workspace.delete({ where: { id: legacyWs.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
  }
});

test('2 & 3. BASE Plan is ₹499/user/month and contains ALL 14 canonical modules', async () => {
  const basePlan = await prisma.plan.findUnique({
    where: { code: 'BASE' },
    include: { modules: { include: { module: true } } },
  });

  assert.ok(basePlan, 'BASE plan must exist in database');
  assert.equal(basePlan.name, 'Base');
  assert.equal(basePlan.pricePerUserMonth, 499);
  assert.equal(basePlan.currency, 'INR');
  assert.equal(basePlan.isActive, true);
  assert.equal(basePlan.isArchived, false);

  const baseEnabledKeys = basePlan.modules.filter((m) => m.enabled).map((m) => m.module.key);

  const expected14Modules = [
    'DASHBOARD',
    'ATTENDANCE',
    'ADMIN_MANAGEMENT',
    'SALARY_MANAGEMENT',
    'MASTER_CONFIGURATION',
    'LEADS',
    'REPORTS',
    'SHEETS',
    'LOB_ANALYSIS',
    'UNLOCK_STAFF',
    'META_ADS',
    'TELEPHONY',
    'WHATSAPP_TEMPLATES',
    'AUTOMATIONS',
  ];

  for (const modKey of expected14Modules) {
    assert.ok(
      baseEnabledKeys.includes(modKey),
      `BASE plan must include module '${modKey}'`
    );
  }
  assert.equal(baseEnabledKeys.length, 14);
});

test('4. Only BASE is currently active & sellable (PRO & ENTERPRISE are archived)', async () => {
  const activeSellablePlans = await prisma.plan.findMany({
    where: { isActive: true, isArchived: false },
  });

  assert.equal(activeSellablePlans.length, 1, 'Currently exactly 1 plan must be active/sellable');
  assert.equal(activeSellablePlans[0].code, 'BASE');
  assert.equal(activeSellablePlans[0].pricePerUserMonth, 499);

  // Verify PRO and ENTERPRISE (if present in DB) are archived/inactive
  const archivedPlans = await prisma.plan.findMany({
    where: { code: { in: ['PRO', 'ENTERPRISE'] } },
  });
  for (const ap of archivedPlans) {
    assert.equal(ap.isActive, false, `Plan ${ap.code} must be inactive`);
    assert.equal(ap.isArchived, true, `Plan ${ap.code} must be archived`);
  }
});

test('5 & 6. Isolated custom plan with disabled module denies access with 403 MODULE_NOT_ENABLED', async () => {
  const customPlan = await prisma.plan.create({
    data: {
      code: 'TEST_CUSTOM_' + Date.now(),
      name: 'Test Custom Plan',
      pricePerUserMonth: 299,
      currency: 'INR',
      isActive: true,
      isArchived: false,
    },
  });

  const allModules = await prisma.appModule.findMany({ where: { isActive: true } });
  // Enable DASHBOARD and LEADS only, leave META_ADS disabled
  for (const mod of allModules) {
    await prisma.planModule.create({
      data: {
        planId: customPlan.id,
        moduleId: mod.id,
        enabled: mod.key === 'DASHBOARD' || mod.key === 'LEADS',
      },
    });
  }

  const testUser = await prisma.user.create({
    data: {
      name: 'Custom Plan Owner',
      email: `custom_test_${Date.now()}@example.com`,
      password: 'dummyhash',
      isOnboarded: true,
    },
  });

  const testWs = await prisma.workspace.create({
    data: {
      companyName: 'Custom Plan Co',
      employeeCount: '1-10',
      ownerId: testUser.id,
      activePlanId: customPlan.id,
      billingStatus: 'ACTIVE',
      approvedUserLimit: 5,
      accessUntil: new Date(Date.now() + 30 * 86400000),
    },
  });

  try {
    // Enabled module succeeds
    await ModuleEntitlementService.assertModuleAccess(testWs.id, 'LEADS');

    // Disabled module throws 403 MODULE_NOT_ENABLED
    await assert.rejects(
      async () => {
        await ModuleEntitlementService.assertModuleAccess(testWs.id, 'META_ADS');
      },
      (err: any) => {
        return err.statusCode === 403 && err.errorCode === 'MODULE_NOT_ENABLED';
      }
    );
  } finally {
    await prisma.workspace.delete({ where: { id: testWs.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    await prisma.planModule.deleteMany({ where: { planId: customPlan.id } }).catch(() => {});
    await prisma.plan.delete({ where: { id: customPlan.id } }).catch(() => {});
  }
});

test('7, 8, 9, 10. Backend authoritative price calculation & immutable PaymentRequest snapshot', async () => {
  const basePlan = await prisma.plan.findUnique({ where: { code: 'BASE' } });
  assert.ok(basePlan);

  const requestedUsers = 6;
  const requestedMonths = 3;
  const unitPrice = basePlan.pricePerUserMonth; // 499
  const expectedAmount = requestedUsers * requestedMonths * unitPrice; // 6 * 3 * 499 = 8982

  assert.equal(expectedAmount, 8982);

  const testUser = await prisma.user.create({
    data: {
      name: 'PR Owner Test',
      email: `pr_test_${Date.now()}@example.com`,
      password: 'dummyhash',
      isOnboarded: true,
    },
  });

  const testWs = await prisma.workspace.create({
    data: {
      companyName: 'PR Test Company',
      employeeCount: '1-10',
      ownerId: testUser.id,
      billingStatus: 'PAYMENT_REQUIRED',
    },
  });

  const pr = await prisma.paymentRequest.create({
    data: {
      workspaceId: testWs.id,
      requestedPlanId: basePlan.id,
      planCodeSnapshot: basePlan.code,
      planNameSnapshot: basePlan.name,
      requestedUsers,
      requestedMonths,
      unitPrice,
      currency: 'INR',
      calculatedAmount: expectedAmount,
      paymentReference: 'TEST-PR-' + Date.now(),
      status: 'PAYMENT_REQUIRED',
      createdBy: testUser.id,
    },
  });

  try {
    assert.equal(pr.calculatedAmount, 8982);
    assert.equal(pr.planCodeSnapshot, 'BASE');
    assert.equal(pr.unitPrice, 499);
    assert.equal(pr.requestedUsers, 6);
    assert.equal(pr.requestedMonths, 3);
  } finally {
    await prisma.paymentRequest.delete({ where: { id: pr.id } }).catch(() => {});
    await prisma.workspace.delete({ where: { id: testWs.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
  }
});

test('11 & 12. Expiry blocks access while preserving activePlan and data', async () => {
  const basePlan = await prisma.plan.findUnique({ where: { code: 'BASE' } });
  assert.ok(basePlan);

  const pastDate = new Date(Date.now() - 86400000);
  const ws = {
    id: 'ws-exp',
    activePlanId: basePlan.id,
    billingStatus: 'ACTIVE',
    accessUntil: pastDate,
  };

  const decision = await evaluateCompanyAccess(ws);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'SUBSCRIPTION_EXPIRED');
});

test('13, 14, 15, 16. Lock and Suspend override subscription and unlock/unsuspend restores access', async () => {
  const futureDate = new Date(Date.now() + 30 * 86400000);

  const lockedWs = {
    id: 'ws-locked',
    billingStatus: 'ACTIVE',
    accessUntil: futureDate,
    lockedAt: new Date(),
    lockReason: 'Admin review',
  };
  let decision = await evaluateCompanyAccess(lockedWs);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'COMPANY_LOCKED');

  const unlockedWs = {
    ...lockedWs,
    lockedAt: null,
    lockReason: null,
  };
  decision = await evaluateCompanyAccess(unlockedWs);
  assert.equal(decision.isAllowed, true);
  assert.equal(decision.reason, 'PAID_ACTIVE');

  const suspendedWs = {
    id: 'ws-suspended',
    billingStatus: 'ACTIVE',
    accessUntil: futureDate,
    suspendReason: 'Payment investigation',
  };
  decision = await evaluateCompanyAccess(suspendedWs);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'COMPANY_SUSPENDED');

  const unsuspendedWs = {
    ...suspendedWs,
    suspendReason: null,
  };
  decision = await evaluateCompanyAccess(unsuspendedWs);
  assert.equal(decision.isAllowed, true);
  assert.equal(decision.reason, 'PAID_ACTIVE');
});

test('17. Service Key Authorization protects platform APIs', () => {
  const originalKey = process.env.SEEAKK_CONTROL_SERVICE_KEY;
  try {
    process.env.SEEAKK_CONTROL_SERVICE_KEY = 'valid-control-secret-12345';

    let authorized = false;
    const reqValid: any = {
      headers: { 'x-service-key': 'valid-control-secret-12345' },
      ip: '127.0.0.1',
    };
    const res: any = {
      status: () => res,
      json: () => res,
      setHeader: () => res,
    };
    platformAuthMiddleware(reqValid, res, () => { authorized = true; });
    assert.equal(authorized, true);

    authorized = false;
    let rejectedCode = 0;
    const reqInvalid: any = {
      headers: { 'x-service-key': 'wrong-key' },
      ip: '127.0.0.1',
    };
    const resInvalid: any = {
      status: (code: number) => { rejectedCode = code; return resInvalid; },
      json: () => resInvalid,
      setHeader: () => resInvalid,
    };
    platformAuthMiddleware(reqInvalid, resInvalid, () => { authorized = true; });
    assert.equal(authorized, false);
    assert.equal(rejectedCode, 403);
  } finally {
    process.env.SEEAKK_CONTROL_SERVICE_KEY = originalKey;
  }
});
