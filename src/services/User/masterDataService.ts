import prisma from '../../config/prisma';

const SUPERADMIN_ROLE_NAME = 'superadmin';

export const getRoles = async (workspaceId: string) => {
  const workspaceUsers = await prisma.user.findMany({
    where: { workspaceId },
    select: { id: true },
  });

  const creatorIds = workspaceUsers.map((user) => user.id);

  return prisma.role.findMany({
    where: {
      status: 'ACTIVE',
      OR: creatorIds.length
        ? [
            { name: SUPERADMIN_ROLE_NAME },
            { createdBy: { in: creatorIds } },
          ]
        : [{ name: SUPERADMIN_ROLE_NAME }],
    },
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
