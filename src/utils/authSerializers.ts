import { resolveWorkspaceIdForUser } from './workspaceContext';
import { userHasActiveTemporaryBulkExtensionAccess } from '../modules/followup-settings/temporaryBulkAccess.util';

export const SUPERADMIN_ROLE_NAME = 'superadmin';
export const BULK_EXTEND_FOLLOWUPS_PERMISSION = 'bulk_extend_followups';

export const normalizeRoleKey = (role: string): string =>
  role
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

export const extractRolePermissionKeys = (user: any): string[] => {
  const rawPermissionKeys = Array.isArray(user.role?.permissions)
    ? user.role.permissions
        .map((rolePermission: any) => rolePermission?.permission?.key)
        .filter((key: unknown): key is string => typeof key === 'string' && key.length > 0)
    : [];

  if (normalizeRoleKey(user.role?.name || '') === SUPERADMIN_ROLE_NAME) {
    return Array.from(new Set([...rawPermissionKeys, 'SUPERADMIN']));
  }

  return rawPermissionKeys;
};

export const resolveEffectivePermissionKeys = async (
  user: any,
  resolvedWorkspaceId?: string | null,
): Promise<string[]> => {
  const permissionKeys = extractRolePermissionKeys(user);

  if (permissionKeys.includes(BULK_EXTEND_FOLLOWUPS_PERMISSION)) {
    return permissionKeys;
  }

  const workspaceId =
    (typeof resolvedWorkspaceId === 'string' && resolvedWorkspaceId.trim()) ||
    (typeof user.workspaceId === 'string' && user.workspaceId.trim()) ||
    (typeof user.workspace?.id === 'string' && user.workspace.id.trim()) ||
    null;

  if (!user?.id || !workspaceId) {
    return permissionKeys;
  }

  const hasTemporaryBulkAccess = await userHasActiveTemporaryBulkExtensionAccess(user.id, workspaceId);
  if (!hasTemporaryBulkAccess) {
    return permissionKeys;
  }

  return [...permissionKeys, BULK_EXTEND_FOLLOWUPS_PERMISSION];
};

export const serializeAuthenticatedUser = (
  user: any,
  resolvedWorkspaceId?: string | null,
  permissionKeysOverride?: string[],
) => {
  const permissionKeys = permissionKeysOverride ?? extractRolePermissionKeys(user);

  const workspaceId =
    (typeof resolvedWorkspaceId === 'string' && resolvedWorkspaceId.trim()) ||
    (typeof user.workspaceId === 'string' && user.workspaceId.trim()) ||
    (typeof user.workspace?.id === 'string' && user.workspace.id.trim()) ||
    null;
    
  const isOnboarded = Boolean(user.isOnboarded || workspaceId);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username || null,
    phone: user.phone || null,
    profileImageUrl: user.profileImageUrl || null,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          status: user.role.status,
          isSystemRole: user.role.isSystemRole,
        }
      : null,
    permissions: permissionKeys,
    isOnboarded,
    devices: user.devices || [],
    workspaceId,
    workspace: user.workspace,
  };
};
