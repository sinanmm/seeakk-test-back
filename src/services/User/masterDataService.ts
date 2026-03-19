import prisma from '../../config/prisma';

export const getRoles = async () => {
  return prisma.role.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' }
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
