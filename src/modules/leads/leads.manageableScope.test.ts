import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../config/prisma';
import { resolveManageableFollowUpUserScope } from './leads.service';
import * as leadsRepository from './leads.repository';

const originalWorkspaceFindFirst = prisma.workspace.findFirst;
prisma.workspace.findFirst = async () => null;

const actor = {
  id: 'actor_1',
  roleId: 'role_1',
  role: { name: 'Supervisor' },
};

test('resolveManageableFollowUpUserScope returns ALL for bulk extend permission', async () => {
  const originalGetRolePermissionKeys = leadsRepository.getRolePermissionKeys;
  const originalGetRecursiveTeamUserIds = leadsRepository.getRecursiveTeamUserIds;
  const originalGetTeamUserIds = leadsRepository.getTeamUserIds;

  leadsRepository.getRolePermissionKeys = async () => ['bulk_extend_followups'];
  leadsRepository.getRecursiveTeamUserIds = async () => [];
  leadsRepository.getTeamUserIds = async () => [];

  try {
    const scope = await resolveManageableFollowUpUserScope('ws_1', actor);
    assert.equal(scope, 'ALL');
  } finally {
    leadsRepository.getRolePermissionKeys = originalGetRolePermissionKeys;
    leadsRepository.getRecursiveTeamUserIds = originalGetRecursiveTeamUserIds;
    leadsRepository.getTeamUserIds = originalGetTeamUserIds;
  }
});

test.after(() => {
  prisma.workspace.findFirst = originalWorkspaceFindFirst;
});

test('resolveManageableFollowUpUserScope returns recursive team for supervisor role', async () => {
  const originalGetRolePermissionKeys = leadsRepository.getRolePermissionKeys;
  const originalGetRecursiveTeamUserIds = leadsRepository.getRecursiveTeamUserIds;
  const originalGetTeamUserIds = leadsRepository.getTeamUserIds;

  leadsRepository.getRolePermissionKeys = async () => ['LEADS_VIEW_OWN'];
  leadsRepository.getRecursiveTeamUserIds = async () => ['user_a', 'user_b'];
  leadsRepository.getTeamUserIds = async () => [];

  try {
    const scope = await resolveManageableFollowUpUserScope('ws_1', actor);
    assert.deepEqual(scope, ['actor_1', 'user_a', 'user_b']);
  } finally {
    leadsRepository.getRolePermissionKeys = originalGetRolePermissionKeys;
    leadsRepository.getRecursiveTeamUserIds = originalGetRecursiveTeamUserIds;
    leadsRepository.getTeamUserIds = originalGetTeamUserIds;
  }
});
