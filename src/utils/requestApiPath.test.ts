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

test('normalizeRequestApiPath resolves admin user list root', () => {
  const req = mockReq({
    baseUrl: '/api/admin/users',
    path: '/',
    url: '/?page=1&limit=200',
  });
  assert.equal(normalizeRequestApiPath(req), '/api/admin/users');
});
