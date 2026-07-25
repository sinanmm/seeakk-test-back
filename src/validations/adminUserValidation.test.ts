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

test('updateUserSchema accepts relative upload profileImageUrl and supervisorId', () => {
  const result = updateUserSchema.safeParse({
    name: 'Staff Member',
    supervisorId: 'sup_12345',
    profileImageUrl: '/uploads/profile-pictures/1721894712.jpg',
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.supervisorId, 'sup_12345');
  assert.equal(result.data?.profileImageUrl, '/uploads/profile-pictures/1721894712.jpg');
});
