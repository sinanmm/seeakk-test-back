import test from 'node:test';
import assert from 'node:assert/strict';
import { protect, checkAnyPermission } from '../../middlewares/authMiddleware';

test('Location tracking protect middleware exists and is a function', () => {
  assert.equal(typeof protect, 'function');
});

test('Location tracking checkAnyPermission middleware returns express middleware', () => {
  const middleware = checkAnyPermission(['LOCATION_TRACKING_SHARE', 'mark_attendance']);
  assert.equal(typeof middleware, 'function');
});

test('Protect middleware rejects missing token with 401 status and diagnostic reason', async () => {
  let statusCode = 0;
  let jsonResult: any = null;

  const req: any = {
    headers: {},
    header: () => undefined,
    ip: '127.0.0.1',
    originalUrl: '/api/location-tracking/points',
    method: 'GET',
  };

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      jsonResult = data;
      return this;
    },
    setHeader() {},
  };

  const next = () => {};

  await protect(req, res, next);

  assert.equal(statusCode, 401);
  assert.equal(jsonResult?.reason, 'Token missing');
});
