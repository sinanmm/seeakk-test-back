import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompanyAccess } from './companyAccess.service';

test('evaluateCompanyAccess blocks SUSPENDED workspace regardless of paid access', async () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const workspace = {
    id: 'ws-1',
    billingStatus: 'ACTIVE',
    accessUntil: futureDate,
    suspendReason: 'Policy violation',
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'COMPANY_SUSPENDED');
  assert.equal(decision.entitlementSource, 'NONE');
});

test('evaluateCompanyAccess blocks LOCKED workspace regardless of paid access', async () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const workspace = {
    id: 'ws-2',
    billingStatus: 'ACTIVE',
    accessUntil: futureDate,
    lockedAt: new Date(),
    lockReason: 'Audit review in progress',
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'COMPANY_LOCKED');
});

test('evaluateCompanyAccess allows valid PAID active workspace', async () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const workspace = {
    id: 'ws-3',
    billingStatus: 'ACTIVE',
    approvedUserLimit: 5,
    accessUntil: futureDate,
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, true);
  assert.equal(decision.reason, 'PAID_ACTIVE');
  assert.equal(decision.entitlementSource, 'PAID');
  assert.equal(decision.seatLimit, 5);
});

test('evaluateCompanyAccess allows early renewal without disrupting active paid access', async () => {
  const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const workspace = {
    id: 'ws-4',
    billingStatus: 'PAYMENT_PENDING', // Early renewal submitted
    approvedUserLimit: 2,
    accessUntil: futureDate, // Current paid access still valid!
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, true);
  assert.equal(decision.reason, 'PAID_ACTIVE');
  assert.equal(decision.entitlementSource, 'PAID');
});

test('evaluateCompanyAccess blocks new company with PAYMENT_PENDING and no paid access', async () => {
  const workspace = {
    id: 'ws-5',
    billingStatus: 'PAYMENT_PENDING',
    accessUntil: null,
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'PAYMENT_PENDING');
});

test('evaluateCompanyAccess blocks company with PAYMENT_REQUIRED', async () => {
  const workspace = {
    id: 'ws-6',
    billingStatus: 'PAYMENT_REQUIRED',
    accessUntil: null,
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'PAYMENT_REQUIRED');
});

test('evaluateCompanyAccess blocks EXPIRED workspace at request time', async () => {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const workspace = {
    id: 'ws-7',
    billingStatus: 'ACTIVE', // Status in DB was ACTIVE, but date passed
    accessUntil: pastDate,
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'SUBSCRIPTION_EXPIRED');
});

test('evaluateCompanyAccess allows LEGACY unmanaged workspace', async () => {
  const workspace = {
    id: 'ws-legacy',
    billingStatus: null,
    accessUntil: null,
  };

  const decision = await evaluateCompanyAccess(workspace);
  assert.equal(decision.isAllowed, true);
  assert.equal(decision.reason, 'LEGACY_UNMANAGED');
  assert.equal(decision.entitlementSource, 'LEGACY');
});

test('platformAuthMiddleware validates service key correctly', () => {
  const originalKey = process.env.SEEAKK_CONTROL_SERVICE_KEY;
  try {
    process.env.SEEAKK_CONTROL_SERVICE_KEY = 'test-secret-service-key-12345';
    const { platformAuthMiddleware } = require('../../middlewares/platformAuthMiddleware');

    // Test 1: Valid Bearer
    let nextCalled = false;
    let statusCode = 200;
    const req1: any = {
      headers: { authorization: 'Bearer test-secret-service-key-12345' },
      ip: '127.0.0.1',
    };
    const res1: any = {
      status: (code: number) => { statusCode = code; return res1; },
      json: () => res1,
      setHeader: () => res1,
    };
    platformAuthMiddleware(req1, res1, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // Test 2: Valid x-service-key header
    nextCalled = false;
    const req2: any = {
      headers: { 'x-service-key': 'test-secret-service-key-12345' },
      ip: '127.0.0.1',
    };
    platformAuthMiddleware(req2, res1, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // Test 3: Invalid key
    nextCalled = false;
    statusCode = 200;
    const req3: any = {
      headers: { authorization: 'Bearer wrong-key' },
      ip: '127.0.0.1',
    };
    platformAuthMiddleware(req3, res1, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);

    // Test 4: Missing header
    nextCalled = false;
    statusCode = 200;
    const req4: any = {
      headers: {},
      ip: '127.0.0.1',
    };
    platformAuthMiddleware(req4, res1, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
  } finally {
    process.env.SEEAKK_CONTROL_SERVICE_KEY = originalKey;
  }
});

test('PaymentApprovalService.approvePayment rejects invalid inputs', async () => {
  const { PaymentApprovalService } = require('./paymentApproval.service');

  // Test missing paymentRequestId
  await assert.rejects(
    async () => {
      await PaymentApprovalService.approvePayment({
        paymentRequestId: '',
        approvedUserLimit: 2,
        accessFrom: new Date(),
        accessUntil: new Date(Date.now() + 86400000),
      });
    },
    { message: 'Payment Request ID is required.' }
  );

  // Test invalid user limit
  await assert.rejects(
    async () => {
      await PaymentApprovalService.approvePayment({
        paymentRequestId: 'req-1',
        approvedUserLimit: 0,
        accessFrom: new Date(),
        accessUntil: new Date(Date.now() + 86400000),
      });
    },
    { message: 'Approved user limit must be a positive integer.' }
  );

  // Test invalid date range
  await assert.rejects(
    async () => {
      await PaymentApprovalService.approvePayment({
        paymentRequestId: 'req-1',
        approvedUserLimit: 5,
        accessFrom: new Date(Date.now() + 86400000),
        accessUntil: new Date(),
      });
    },
    { message: 'Access Until date must be strictly after Access From date.' }
  );
});

