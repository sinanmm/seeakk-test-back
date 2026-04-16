import test from 'node:test';
import assert from 'node:assert/strict';
import { InviteError } from './invite.errors';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createInviteService } = require('./invite.service') as typeof import('./invite.service');

const baseRepository = {
  findWorkspaceById: async () => ({ id: 'ws_1', companyName: 'Acme' }),
  findUserByEmail: async () => null,
  findUserByUsername: async () => null,
  findRoleByIdOrName: async () => ({ id: 'role_1', name: 'manager' }),
  findDepartmentByIdOrName: async () => ({ id: 'dept_1', name: 'Sales' }),
  findOfficeById: async () => ({ id: 'office_1', name: 'HQ' }),
  findSupervisorById: async () => ({ id: 'sup_1', name: 'Lead', email: 'lead@example.com' }),
  createInvitedUserWithInvite: async ({ tokenHash }: any) => ({
    user: {
      id: 'user_1',
      name: 'Invited User',
      email: 'invitee@example.com',
      workspaceId: 'ws_1',
      role: { id: 'role_1', name: 'manager' },
    },
    invite: {
      id: 'invite_1',
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
      expiresAt: new Date('2026-04-16T10:00:00.000Z'),
      tokenHash,
    },
  }),
  findInviteByTokenHash: async () => ({
    id: 'invite_1',
    tokenHash: 'hashed-token',
    expiresAt: new Date('2026-04-16T10:00:00.000Z'),
    usedAt: null,
    createdAt: new Date('2026-04-15T10:00:00.000Z'),
    workspaceId: 'ws_1',
    user: {
      id: 'user_1',
      name: 'Invited User',
      email: 'invitee@example.com',
      workspaceId: 'ws_1',
      role: { id: 'role_1', name: 'manager' },
      workspace: { id: 'ws_1', companyName: 'Acme' },
    },
    creator: { id: 'admin_1', name: 'Admin', email: 'admin@example.com' },
  }),
  acceptInvite: async () => ({
    id: 'user_1',
    name: 'Invited User',
    email: 'invitee@example.com',
    workspaceId: 'ws_1',
    role: { id: 'role_1', name: 'manager' },
  }),
};

const buildService = (overrides: Partial<any> = {}) => {
  const sentEmails: any[] = [];
  const auditLogs: any[] = [];
  const passwordHashes: any[] = [];

  const repo = { ...baseRepository, ...(overrides.repository || {}) };

  const service = createInviteService({
    repository: repo as any,
    tokenFactory: overrides.tokenFactory || (() => ({ rawToken: 'raw-token', tokenHash: 'hashed-token' })),
    hashToken: overrides.hashToken || ((token: string) => `hashed:${token}`),
    sendInvitationEmail: overrides.sendInvitationEmail || (async (...args: any[]) => void sentEmails.push(args)),
    hashPassword:
      overrides.hashPassword ||
      (async (password: string, rounds: number) => {
        passwordHashes.push([password, rounds]);
        return `bcrypt:${password}`;
      }),
    audit: overrides.audit || {
      log: async (payload: any) => void auditLogs.push(payload),
    },
    now: overrides.now || (() => new Date('2026-04-15T10:00:00.000Z')),
  });

  return { service, sentEmails, auditLogs, passwordHashes };
};

test('createInvite creates an inactive invited user and sends the raw token by email while storing only the hash', async () => {
  let persistedTokenHash = '';
  const { service, sentEmails, auditLogs } = buildService({
    repository: {
      ...baseRepository,
      createInvitedUserWithInvite: async ({ tokenHash }: any) => {
        persistedTokenHash = tokenHash;
        return {
          user: {
            id: 'user_1',
            name: 'Invited User',
            email: 'invitee@example.com',
            workspaceId: 'ws_1',
            role: { id: 'role_1', name: 'manager' },
          },
          invite: {
            id: 'invite_1',
            createdAt: new Date('2026-04-15T10:00:00.000Z'),
            expiresAt: new Date('2026-04-16T10:00:00.000Z'),
          },
        };
      },
    },
    tokenFactory: () => ({ rawToken: 'raw-token-123', tokenHash: 'hash-token-123' }),
  });

  const result = await service.createInvite(
    {
      name: 'Invited User',
      email: 'invitee@example.com',
      roleId: 'role_1',
    },
    { id: 'admin_1', workspaceId: 'ws_1', name: 'Admin User' },
  );

  assert.equal(persistedTokenHash, 'hash-token-123');
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0][1].inviteToken, 'raw-token-123');
  assert.equal(result.user.email, 'invitee@example.com');
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'USER_INVITE_CREATED');
});

test('validateInvite rejects used tokens', async () => {
  const { service } = buildService({
    repository: {
      ...baseRepository,
      findInviteByTokenHash: async () => ({
        ...(await baseRepository.findInviteByTokenHash()),
        usedAt: new Date('2026-04-15T11:00:00.000Z'),
      }),
    },
    hashToken: () => 'hashed-token',
  });

  await assert.rejects(
    () => service.validateInvite({ token: 'raw-token' }),
    (error: any) => {
      assert.ok(error instanceof InviteError);
      assert.equal(error.code, 'INVITE_ALREADY_USED');
      return true;
    },
  );
});

test('acceptInvite hashes password, activates user, and marks invite as used', async () => {
  let acceptPayload: any = null;
  const { service, passwordHashes, auditLogs } = buildService({
    repository: {
      ...baseRepository,
      findInviteByTokenHash: async () => ({
        ...(await baseRepository.findInviteByTokenHash()),
      }),
      acceptInvite: async (payload: any) => {
        acceptPayload = payload;
        return {
          id: 'user_1',
          name: 'Invited User',
          email: 'invitee@example.com',
          workspaceId: 'ws_1',
          role: { id: 'role_1', name: 'manager' },
        };
      },
    },
    hashToken: () => 'hashed-token',
  });

  const result = await service.acceptInvite({
    token: 'raw-token',
    password: 'StrongPass123',
  });

  assert.equal(passwordHashes.length, 1);
  assert.equal(passwordHashes[0][0], 'StrongPass123');
  assert.equal(acceptPayload.inviteId, 'invite_1');
  assert.equal(acceptPayload.userId, 'user_1');
  assert.equal(acceptPayload.passwordHash, 'bcrypt:StrongPass123');
  assert.equal(result.user.workspaceId, 'ws_1');
  assert.equal(auditLogs[auditLogs.length - 1].action, 'USER_INVITE_ACCEPTED');
});
