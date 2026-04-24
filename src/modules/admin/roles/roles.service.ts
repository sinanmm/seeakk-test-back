import prisma from '../../../config/prisma';
import { CreateRoleInput, UpdateRoleInput, ListRolesQuery } from './roles.validator';
import { RoleResponse, ListRolesResponse } from './roles.types';
import { redisClient } from '../../../config/redis';

const normalizeRoleKey = (value?: string | null): string =>
  (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const SUPERADMIN_ROLE_NAME = 'superadmin';

const roleSelect = {
  id: true,
  workspaceId: true,
  name: true,
  status: true,
  description: true,
  isSystemRole: true,
  createdAt: true,
  updatedAt: true,
} as const;

const buildRoleNotFoundError = () => {
  const err: any = new Error('Role not found in this workspace.');
  err.statusCode = 404;
  return err;
};

const assertRoleWorkspace = async (roleId: string, workspaceId: string) => {
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId },
    select: {
      ...roleSelect,
      _count: { select: { users: true } },
    },
  });

  if (!role) {
    throw buildRoleNotFoundError();
  }

  return role;
};

const getPermissionsByKeys = async (keys: string[]) =>
  prisma.permission.findMany({
    where: { key: { in: keys } },
    select: { id: true, key: true },
  });

export const createRole = async (
  input: CreateRoleInput,
  userId: string,
  workspaceId: string,
): Promise<RoleResponse> => {
  const { name, status, description, permissions: permissionKeys } = input;

  const existingRole = await prisma.role.findFirst({
    where: {
      workspaceId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (existingRole) {
    const err: any = new Error('A role with this name already exists in this workspace.');
    err.statusCode = 409;
    throw err;
  }

  const permissions = await getPermissionsByKeys(permissionKeys);
  if (permissions.length !== permissionKeys.length) {
    const foundKeys = permissions.map((permission) => permission.key);
    const missingKeys = permissionKeys.filter((key) => !foundKeys.includes(key));
    const err: any = new Error(`The following permissions were not found: ${missingKeys.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const role = await prisma.$transaction(async (tx) => {
    const newRole = await tx.role.create({
      data: {
        workspaceId,
        name,
        status,
        description,
        createdBy: userId,
        isSystemRole: false,
      },
      select: roleSelect,
    });

    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: newRole.id,
        permissionId: permission.id,
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

export const listRoles = async (query: ListRolesQuery, workspaceId: string): Promise<ListRolesResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, roles] = await prisma.$transaction([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ isSystemRole: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { permissions: true, users: true } },
      },
    }),
  ]);

  return {
    data: roles.map((role) => ({
      id: role.id,
      workspaceId: role.workspaceId,
      name: role.name,
      status: role.status,
      description: role.description,
      isSystemRole: role.isSystemRole,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissionsCount: role._count.permissions,
      usersCount: role._count.users,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getRoleById = async (id: string, workspaceId: string): Promise<RoleResponse> => {
  const role = await prisma.role.findFirst({
    where: { id, workspaceId },
    include: {
      permissions: {
        include: {
          permission: { select: { key: true } },
        },
      },
    },
  });

  if (!role) {
    throw buildRoleNotFoundError();
  }

  return {
    id: role.id,
    workspaceId: role.workspaceId,
    name: role.name,
    status: role.status,
    description: role.description,
    isSystemRole: role.isSystemRole,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissions: role.permissions.map((rolePermission) => rolePermission.permission.key),
  };
};

export const updateRole = async (id: string, input: UpdateRoleInput, workspaceId: string): Promise<RoleResponse> => {
  const { name, status, description, permissions: permissionKeys } = input;

  const existingRole = await assertRoleWorkspace(id, workspaceId);

  if (existingRole.isSystemRole) {
    const err: any = new Error('System roles cannot be edited from workspace role management.');
    err.statusCode = 403;
    throw err;
  }

  if (name && normalizeRoleKey(name) !== normalizeRoleKey(existingRole.name)) {
    const nameTaken = await prisma.role.findFirst({
      where: {
        workspaceId,
        id: { not: id },
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (nameTaken) {
      const err: any = new Error('A role with this name already exists in this workspace.');
      err.statusCode = 409;
      throw err;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });

    if (permissionKeys !== undefined) {
      const permissions = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
        select: { id: true, key: true },
      });

      if (permissions.length !== permissionKeys.length) {
        const foundKeys = permissions.map((permission) => permission.key);
        const missingKeys = permissionKeys.filter((key) => !foundKeys.includes(key));
        const err: any = new Error(`The following permissions were not found: ${missingKeys.join(', ')}`);
        err.statusCode = 400;
        throw err;
      }

      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: id,
          permissionId: permission.id,
        })),
      });
    }
  });

  if (redisClient.isOpen) {
    await redisClient.del(`role_permissions:${id}`);
  }

  return getRoleById(id, workspaceId);
};

export const listPermissions = async () =>
  prisma.permission.findMany({
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
  });

export const deleteRole = async (id: string, workspaceId: string): Promise<void> => {
  const role = await assertRoleWorkspace(id, workspaceId);

  if (role.isSystemRole || normalizeRoleKey(role.name) === SUPERADMIN_ROLE_NAME) {
    const err: any = new Error('System protected roles cannot be deleted.');
    err.statusCode = 403;
    err.code = 'ROLE_SYSTEM_PROTECTED';
    throw err;
  }

  if (role._count.users > 0) {
    const err: any = new Error(`Cannot delete role: ${role._count.users} users are currently assigned to this role.`);
    err.statusCode = 400;
    err.code = 'ROLE_HAS_USERS';
    err.details = {
      assignedUsersCount: role._count.users,
      roleId: role.id,
      roleName: role.name,
    };
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
  });

  if (redisClient.isOpen) {
    await redisClient.del(`role_permissions:${id}`);
  }
};
