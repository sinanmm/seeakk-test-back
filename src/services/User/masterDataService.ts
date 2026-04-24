import prisma from '../../config/prisma';

export const getRoles = async (workspaceId: string, options?: { includeInactive?: boolean }) => {
  const includeInactive = options?.includeInactive === true;
  return prisma.role.findMany({
    where: {
      workspaceId,
      ...(includeInactive ? {} : { status: 'ACTIVE' }),
    },
    orderBy: [
      { status: 'asc' },
      { isSystemRole: 'desc' },
      { name: 'asc' },
    ],
  });
};

export const getDepartments = async (workspaceId: string) => {
  return (prisma as any).department.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: { name: 'asc' }
  });
};

export const getSupervisors = async (workspaceId: string) => {
  return (prisma as any).user.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      isActive: true,
      roleId: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: {
        select: {
          name: true,
          status: true,
        },
      },
    },
    orderBy: [{ name: 'asc' }],
  });
};
