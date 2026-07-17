import prisma from '../config/prisma';

export const authenticatedUserBaseSelect = {
  id: true,
  name: true,
  email: true,
  password: true,
  roleId: true,
  workspaceId: true,
  isOnboarded: true,
  isActive: true,
  isEmailVerified: true,
  profileImageUrl: true,
} as const;

export const hydrateAuthenticatedUser = async (user: any): Promise<any> => {
  if (!user?.id) return user;

  const hydrated = { ...user } as any;

  if (hydrated.roleId) {
    try {
      const role = await prisma.role.findUnique({
        where: { id: hydrated.roleId },
        select: {
          id: true,
          name: true,
          status: true,
          isSystemRole: true,
          workspaceId: true,
        },
      });
      hydrated.role = role || null;
    } catch {
      hydrated.role = null;
    }
  } else {
    hydrated.role = null;
  }

  if (hydrated.role?.id) {
    try {
      const rolePermissions = await prisma.rolePermission.findMany({
        where: { roleId: hydrated.role.id },
        include: {
          permission: { select: { key: true } },
        },
      });
      hydrated.role.permissions = rolePermissions;
    } catch {
      hydrated.role.permissions = [];
    }
  }

  try {
    hydrated.devices = await prisma.device.findMany({
      where: { userId: hydrated.id },
      orderBy: { lastActive: 'desc' },
    });
  } catch {
    hydrated.devices = [];
  }

  if (hydrated.workspaceId) {
    try {
      hydrated.workspace = await prisma.workspace.findUnique({
        where: { id: hydrated.workspaceId },
        select: { id: true, companyName: true, logoUrl: true },
      });
    } catch {
      hydrated.workspace = null;
    }
  } else {
    hydrated.workspace = null;
  }

  return hydrated;
};
