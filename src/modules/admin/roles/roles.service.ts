import prisma from '../../../config/prisma';
import { CreateRoleInput, UpdateRoleInput, ListRolesQuery, RoleStatus } from './roles.validator';
import { RoleResponse, ListRolesResponse } from './roles.types';
import logger from '../../../utils/logger';
import { redisClient } from '../../../config/redis';

const SUPERADMIN_ROLE_NAME = 'superadmin';

const normalizeRoleKey = (value?: string | null): string =>
  (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const getWorkspaceRoleWhere = async (workspaceId: string) => {
  const workspaceUsers = await prisma.user.findMany({
    where: { workspaceId },
    select: { id: true },
  });

  const creatorIds = workspaceUsers.map((user) => user.id);

  if (creatorIds.length === 0) {
    return {
      name: SUPERADMIN_ROLE_NAME,
    };
  }

  return {
    OR: [
      { name: SUPERADMIN_ROLE_NAME },
      { createdBy: { in: creatorIds } },
    ],
  };
};

/**
 * Fetch all permissions by their keys.
 */
const getPermissionsByKeys = async (keys: string[]) => {
  return await (prisma.permission as any).findMany({
    where: { key: { in: keys } },
    select: { id: true, key: true },
  });
};

/**
 * POST /api/admin/roles
 */
export const createRole = async (input: CreateRoleInput, userId: string): Promise<RoleResponse> => {
  const { name, status, description, permissions: permissionKeys } = input;

  // 1. Check if role name exists
  const existingRole = await (prisma.role as any).findUnique({ where: { name } });
  if (existingRole) {
    const err: any = new Error('A role with this name already exists.');
    err.statusCode = 409;
    throw err;
  }

  // 2. Fetch permissions
  const permissions = await getPermissionsByKeys(permissionKeys);
  if (permissions.length !== permissionKeys.length) {
    const foundKeys = permissions.map((p: any) => p.key);
    const missingKeys = permissionKeys.filter((k) => !foundKeys.includes(k));
    const err: any = new Error(`The following permissions were not found: ${missingKeys.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // 3. Create role and role_permissions in a transaction
  const role = await (prisma.$transaction as any)(async (tx: any) => {
    const newRole = await tx.role.create({
      data: {
        name,
        status,
        description,
        createdBy: userId,
      },
    });

    await tx.rolePermission.createMany({
      data: permissions.map((p: any) => ({
        roleId: newRole.id,
        permissionId: p.id,
      })),
    });

    return newRole;
  });

  if (redisClient.isOpen) {
    await redisClient.del(`role_permissions:${role.id}`);
  }

  return {
    ...role,
    permissions: permissionKeys,
  };
};

/**
 * GET /api/admin/roles
 */
export const listRoles = async (query: ListRolesQuery, workspaceId: string): Promise<ListRolesResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;
  const workspaceRoleWhere = await getWorkspaceRoleWhere(workspaceId);

  const where: any = {
    ...workspaceRoleWhere,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, roles] = await (prisma.$transaction as any)([
    (prisma.role as any).count({ where }),
    (prisma.role as any).findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { permissions: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data: roles.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      description: r.description,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      permissionsCount: r._count.permissions,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

/**
 * GET /api/admin/roles/:id
 */
export const getRoleById = async (id: string, workspaceId: string): Promise<RoleResponse> => {
  const workspaceRoleWhere = await getWorkspaceRoleWhere(workspaceId);
  const role = await (prisma.role as any).findUnique({
    where: { id },
    include: {
      permissions: {
        include: {
          permission: { select: { key: true } },
        },
      },
    },
  });

  if (!role) {
    const err: any = new Error('Role not found.');
    err.statusCode = 404;
    throw err;
  }

  const isVisibleInWorkspace =
    normalizeRoleKey(role.name) === SUPERADMIN_ROLE_NAME ||
    ((workspaceRoleWhere as any).OR || []).some((condition: any) => {
      if (condition?.createdBy?.in) {
        return condition.createdBy.in.includes(role.createdBy);
      }
      return false;
    });

  if (!isVisibleInWorkspace) {
    const err: any = new Error('Role not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  return {
    id: role.id,
    name: role.name,
    status: role.status,
    description: role.description,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissions: role.permissions.map((rp: any) => rp.permission.key),
  };
};

/**
 * PUT /api/admin/roles/:id
 */
export const updateRole = async (id: string, input: UpdateRoleInput, workspaceId: string): Promise<RoleResponse> => {
  const { name, status, description, permissions: permissionKeys } = input;
  const workspaceRoleWhere = await getWorkspaceRoleWhere(workspaceId);

  // 1. Check if role exists
  const existingRole = await (prisma.role as any).findUnique({ where: { id } });
  if (!existingRole) {
    const err: any = new Error('Role not found.');
    err.statusCode = 404;
    throw err;
  }

  const allowedCreatorIds =
    ((workspaceRoleWhere as any).OR || [])
      .flatMap((condition: any) => (condition?.createdBy?.in ? condition.createdBy.in : [])) || [];
  const isWorkspaceVisibleRole =
    normalizeRoleKey(existingRole.name) === SUPERADMIN_ROLE_NAME ||
    allowedCreatorIds.includes(existingRole.createdBy);

  if (!isWorkspaceVisibleRole) {
    const err: any = new Error('Role not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  // 2. Check name uniqueness if changed
  if (name && name !== existingRole.name) {
    const nameTaken = await (prisma.role as any).findUnique({ where: { name } });
    if (nameTaken) {
      const err: any = new Error('A role with this name already exists.');
      err.statusCode = 409;
      throw err;
    }
  }

  // 3. Update in transaction
  const updatedRole = await (prisma.$transaction as any)(async (tx: any) => {
    // Update role fields
    const role = await tx.role.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });

    // Update permissions if provided
    if (permissionKeys !== undefined) {
      // Fetch new permissions
      const permissions = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
        select: { id: true, key: true },
      });

      if (permissions.length !== permissionKeys.length) {
        const foundKeys = permissions.map((p: any) => p.key);
        const missingKeys = permissionKeys.filter((k) => !foundKeys.includes(k));
        const err: any = new Error(`The following permissions were not found: ${missingKeys.join(', ')}`);
        err.statusCode = 400;
        throw err;
      }

      // Delete old relations
      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      // Insert new relations
      await tx.rolePermission.createMany({
        data: permissions.map((p: any) => ({
          roleId: id,
          permissionId: p.id,
        })),
      });
    }

    return role;
  });

  if (redisClient.isOpen) {
    await redisClient.del(`role_permissions:${id}`);
  }

  // Get current permissions
  const roleWithPerms = await getRoleById(id, workspaceId);

  return roleWithPerms;
};

/**
 * GET /api/admin/roles/meta/permissions
 */
export const listPermissions = async () => {
  const permissions = await (prisma.permission as any).findMany({
    orderBy: [
      { group: 'asc' },
      { key: 'asc' },
    ],
  });

  return permissions;
};

/**
 * DELETE /api/admin/roles/:id
 */
export const deleteRole = async (id: string, workspaceId: string): Promise<void> => {
  const workspaceRoleWhere = await getWorkspaceRoleWhere(workspaceId);
  // 1. Check if role exists
  const role = await (prisma.role as any).findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });

  if (!role) {
    const err: any = new Error('Role not found.');
    err.statusCode = 404;
    throw err;
  }

  const allowedCreatorIds =
    ((workspaceRoleWhere as any).OR || [])
      .flatMap((condition: any) => (condition?.createdBy?.in ? condition.createdBy.in : [])) || [];
  const isWorkspaceVisibleRole =
    normalizeRoleKey(role.name) === SUPERADMIN_ROLE_NAME ||
    allowedCreatorIds.includes(role.createdBy);

  if (!isWorkspaceVisibleRole) {
    const err: any = new Error('Role not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  // 2. Prevent deleting system roles
  if (['admin', 'superadmin'].includes(normalizeRoleKey(role.name))) {
    const err: any = new Error('System protected roles cannot be deleted.');
    err.statusCode = 403;
    throw err;
  }

  // 3. Check if users are assigned
  if (role._count.users > 0) {
    const err: any = new Error(`Cannot delete role: ${role._count.users} users are currently assigned to this role.`);
    err.statusCode = 400;
    throw err;
  }

  // 4. Delete relations and role in transaction
  await (prisma.$transaction as any)(async (tx: any) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
  });

  if (redisClient.isOpen) {
    await redisClient.del(`role_permissions:${id}`);
  }
};
