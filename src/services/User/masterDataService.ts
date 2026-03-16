import prisma from '../../config/prisma';

export const getRoles = async () => {
  return prisma.role.findMany({
    orderBy: { name: 'asc' }
  });
};

export const getDepartments = async (workspaceId: string) => {
  return (prisma as any).department.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' }
  });
};

export const getSupervisors = async (workspaceId: string) => {
  return (prisma as any).user.findMany({
    where: { 
        workspaceId, 
        deletedAt: null,
        role: {
            name: { in: ['admin', 'manager', 'super-admin'] }
        }
    },
    select: {
      id: true,
      name: true,
      email: true
    },
    orderBy: { name: 'asc' }
  });
};
