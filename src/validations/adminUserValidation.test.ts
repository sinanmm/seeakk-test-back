import test from 'node:test';
import assert from 'node:assert/strict';
import { updateUserSchema } from './adminUserValidation';

test('updateUserSchema accepts an explicit null supervisorId when clearing supervisor selection', () => {
  const result = updateUserSchema.safeParse({
    name: 'Staff Member',
    supervisorId: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.supervisorId, null);
});
