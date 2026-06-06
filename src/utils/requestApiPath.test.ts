import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { normalizeRequestApiPath } from './requestApiPath';

const mockReq = (parts: Partial<Request>): Request => parts as Request;

test('normalizeRequestApiPath uses originalUrl when present', () => {
  const req = mockReq({ originalUrl: '/api/leads/meta/assignees?page=1' });
  assert.equal(normalizeRequestApiPath(req), '/api/leads/meta/assignees');
});

test('normalizeRequestApiPath combines baseUrl and path for mounted routers', () => {
  const req = mockReq({
    baseUrl: '/api/leads',
    path: '/meta/assignees',
    url: '/meta/assignees',
  });
  assert.equal(normalizeRequestApiPath(req), '/api/leads/meta/assignees');
});

test('normalizeRequestApiPath strips trailing slash from originalUrl', () => {
  const req = mockReq({ originalUrl: '/api/followups/bulk-extend/' });
  assert.equal(normalizeRequestApiPath(req), '/api/followups/bulk-extend');
});

test('normalizeRequestApiPath resolves mounted followup routes without full originalUrl', () => {
  const req = mockReq({
    baseUrl: '/api/followups',
    path: '/overdue-mandatory',
    url: '/overdue-mandatory',
  });
  assert.equal(normalizeRequestApiPath(req), '/api/followups/overdue-mandatory');
});
