import { resolveWorkspaceIdForUser } from './workspaceContext';

export const SUPERADMIN_ROLE_NAME = 'superadmin';

export const normalizeRoleKey = (role: string): string =>
  role
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

export const serializeAuthenticatedUser = (user: any, resolvedWorkspaceId?: string | null) => {
  const rawPermissionKeys = Array.isArray(user.role?.permissions)
    ? user.role.permissions
        .map((rolePermission: any) => rolePermission?.permission?.key)
        .filter((key: unknown): key is string => typeof key === 'string' && key.length > 0)
    : [];
  
  const permissionKeys = normalizeRoleKey(user.role?.name || '') === SUPERADMIN_ROLE_NAME
    ? Array.from(new Set([...rawPermissionKeys, 'SUPERADMIN']))
    : rawPermissionKeys;

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
