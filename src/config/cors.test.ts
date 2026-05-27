import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { isAllowedOrigin, handlePreflightRequest } from './cors';

test('isAllowedOrigin permits production Vercel frontend', () => {
  assert.equal(isAllowedOrigin('https://lms-frontend-amber-beta.vercel.app'), true);
});

test('isAllowedOrigin permits Vercel preview hosts', () => {
  assert.equal(isAllowedOrigin('https://lms-frontend-git-main-seeakk.vercel.app'), true);
});

test('handlePreflightRequest responds with CORS headers for allowed origin', () => {
  const headers: Record<string, string | number> = {};
  const req = {
    method: 'OPTIONS',
    headers: {
      origin: 'https://lms-frontend-amber-beta.vercel.app',
      'access-control-request-headers': 'authorization,x-device-id',
    },
  } as Request;

  let ended = false;
  const res = {
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      headers[':status'] = code;
      return res;
    },
    end() {
      ended = true;
    },
  } as unknown as Response;

  let nextCalled = false;
  handlePreflightRequest(req, res, () => {
    nextCalled = true;
  });

  assert.equal(ended, true);
  assert.equal(nextCalled, false);
  assert.equal(headers['access-control-allow-origin'], 'https://lms-frontend-amber-beta.vercel.app');
  assert.equal(headers[':status'], 204);
});
