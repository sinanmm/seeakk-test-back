import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import {
  createResilientStore,
  getVerifiedUserId,
  isExemptFromGlobalLimiter,
  getLeadAssignmentKey,
  leadAssignmentRateLimitHandler,
  getGlobalLimiterKey,
  globalRateLimitHandler,
} from './rateLimiter';

const TEST_SECRET = 'test_rate_limiter_jwt_secret_key_1234567890';
process.env.JWT_SECRET = TEST_SECRET;

test('Rate Limiter - ResilientRateLimitStore MemoryStore Fallback', async () => {
  const store = createResilientStore('test:rl:');
  store.init({ windowMs: 60000 });

  // Increment hit count
  const result1 = await store.increment('test_user_1');
  assert.equal(result1.totalHits, 1);

  const result2 = await store.increment('test_user_1');
  assert.equal(result2.totalHits, 2);

  // Decrement hit count
  await store.decrement('test_user_1');

  // Reset key
  await store.resetKey('test_user_1');
  const resultAfterReset = await store.increment('test_user_1');
  assert.equal(resultAfterReset.totalHits, 1);
});

test('Rate Limiter - getVerifiedUserId cryptographic verification', () => {
  // 1. Unauthenticated request returns null
  const reqNoAuth = {
    headers: {},
    header: () => undefined,
  } as unknown as Request;
  assert.equal(getVerifiedUserId(reqNoAuth), null);

  // 2. Already authenticated request by protect middleware returns user id directly
  const reqWithUser = {
    headers: {},
    header: () => undefined,
    user: { id: 'usr_already_auth_99' },
  } as unknown as Request;
  assert.equal(getVerifiedUserId(reqWithUser), 'usr_already_auth_99');

  // 3. Forged / invalid Bearer token returns null (cannot be spoofed)
  const reqForged = {
    headers: { authorization: 'Bearer forged.invalid.token.signature' },
    header: () => 'Bearer forged.invalid.token.signature',
  } as unknown as Request;
  assert.equal(getVerifiedUserId(reqForged), null);

  // 4. Valid signed Bearer JWT returns verified userId
  const validToken = jwt.sign({ userId: 'usr_verified_42' }, TEST_SECRET, { expiresIn: '1h' });
  const reqValid = {
    headers: { authorization: `Bearer ${validToken}` },
    header: () => `Bearer ${validToken}`,
  } as unknown as Request;
  assert.equal(getVerifiedUserId(reqValid), 'usr_verified_42');

  // 5. Expired token (outside 30s clock tolerance) returns null
  const expiredToken = jwt.sign({ userId: 'usr_expired_11' }, TEST_SECRET, { expiresIn: '-60s' });
  const reqExpired = {
    headers: { authorization: `Bearer ${expiredToken}` },
    header: () => `Bearer ${expiredToken}`,
  } as unknown as Request;
  assert.equal(getVerifiedUserId(reqExpired), null);
});

test('Rate Limiter - isExemptFromGlobalLimiter correctly identifies dedicated routes', () => {
  // Lead assignment routes should be exempt from generic globalLimiter
  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads/lead_123/assign',
      method: 'PATCH',
    } as Request),
    true,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads/bulk-assign',
      method: 'POST',
    } as Request),
    true,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads/bulk-assign/preview',
      method: 'POST',
    } as Request),
    true,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads/bulk',
      method: 'PATCH',
    } as Request),
    true,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads/lead_123',
      method: 'PUT',
      body: { assignedToId: 'usr_owner_1' },
    } as Request),
    true,
  );

  // Attendance approval routes should be exempt from generic globalLimiter
  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/attendance/approve/rec_1',
      method: 'POST',
    } as Request),
    true,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/attendance/review/rec_1',
      method: 'POST',
    } as Request),
    true,
  );

  // Generic routes should NOT be exempt
  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/leads',
      method: 'GET',
    } as Request),
    false,
  );

  assert.equal(
    isExemptFromGlobalLimiter({
      path: '/api/admin/users',
      method: 'GET',
    } as Request),
    false,
  );
});

test('Rate Limiter - Multiple users sharing the same public IP get isolated buckets', () => {
  const tokenUserA = jwt.sign({ userId: 'user_sales_agent_A' }, TEST_SECRET, { expiresIn: '1h' });
  const tokenUserB = jwt.sign({ userId: 'user_sales_agent_B' }, TEST_SECRET, { expiresIn: '1h' });

  const sharedOfficeIp = '203.0.113.195';

  const reqA = {
    ip: sharedOfficeIp,
    headers: { authorization: `Bearer ${tokenUserA}` },
    header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${tokenUserA}` : undefined),
    user: { id: 'user_sales_agent_A', workspaceId: 'ws_corporate_1' },
  } as unknown as Request;

  const reqB = {
    ip: sharedOfficeIp,
    headers: { authorization: `Bearer ${tokenUserB}` },
    header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${tokenUserB}` : undefined),
    user: { id: 'user_sales_agent_B', workspaceId: 'ws_corporate_1' },
  } as unknown as Request;

  const keyA = getLeadAssignmentKey(reqA);
  const keyB = getLeadAssignmentKey(reqB);

  // Ensure keys are distinct despite sharing the exact same IP address
  assert.notEqual(keyA, keyB);
  assert.equal(keyA, 'usr:user_sales_agent_A:ws:ws_corporate_1:lead_assign');
  assert.equal(keyB, 'usr:user_sales_agent_B:ws:ws_corporate_1:lead_assign');

  // Also test global limiter key separation
  const globalKeyA = getGlobalLimiterKey(reqA);
  const globalKeyB = getGlobalLimiterKey(reqB);
  assert.notEqual(globalKeyA, globalKeyB);
  assert.equal(globalKeyA, 'usr:user_sales_agent_A');
  assert.equal(globalKeyB, 'usr:user_sales_agent_B');
});

test('Rate Limiter - leadAssignmentLimiter handler emits custom 429 response', () => {
  let responseStatus = 0;
  let responseJson: any = null;
  const responseHeaders: Record<string, string> = {};

  const mockRes = {
    status: (code: number) => {
      responseStatus = code;
      return mockRes;
    },
    json: (body: any) => {
      responseJson = body;
      return mockRes;
    },
    setHeader: (k: string, v: string) => {
      responseHeaders[k] = v;
    },
    getHeader: (k: string) => responseHeaders[k],
  } as unknown as Response;

  const token = jwt.sign({ userId: 'user_flood_test' }, TEST_SECRET, { expiresIn: '1h' });
  const mockReq = {
    ip: '198.51.100.5',
    method: 'PATCH',
    path: '/api/leads/lead_99/assign',
    originalUrl: '/api/leads/lead_99/assign',
    headers: { authorization: `Bearer ${token}` },
    header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
    user: { id: 'user_flood_test', workspaceId: 'ws_flood_1' },
  } as unknown as Request;

  leadAssignmentRateLimitHandler(mockReq, mockRes, () => {}, {
    statusCode: 429,
    windowMs: 15 * 60 * 1000,
    max: 5000,
  });

  assert.equal(responseStatus, 429);
  assert.equal(responseJson.success, false);
  assert.equal(responseJson.code, 'LEAD_ASSIGNMENT_RATE_LIMITED');
  assert.equal(
    responseJson.message,
    'Lead assignment requests are temporarily limited. Please retry shortly.',
  );
  assert.equal(responseJson.retryAfterSeconds, 900);
});

test('Rate Limiter - globalRateLimitHandler emits standard 429 response', () => {
  let responseStatus = 0;
  let responseJson: any = null;

  const mockRes = {
    status: (code: number) => {
      responseStatus = code;
      return mockRes;
    },
    json: (body: any) => {
      responseJson = body;
      return mockRes;
    },
    setHeader: () => {},
    getHeader: () => undefined,
  } as unknown as Response;

  const mockReq = {
    ip: '198.51.100.5',
    method: 'GET',
    path: '/api/leads',
    originalUrl: '/api/leads',
    headers: {},
    header: () => undefined,
  } as unknown as Request;

  globalRateLimitHandler(mockReq, mockRes, () => {}, {
    statusCode: 429,
    windowMs: 15 * 60 * 1000,
    max: 3000,
  });

  assert.equal(responseStatus, 429);
  assert.equal(responseJson.success, false);
  assert.equal(responseJson.code, 'GLOBAL_RATE_LIMITED');
  assert.equal(responseJson.message, 'Too many requests, please try again later.');
  assert.equal(responseJson.retryAfterSeconds, 900);
});
