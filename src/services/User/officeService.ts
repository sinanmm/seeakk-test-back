import prisma from '../../config/prisma';

export const listOffices = async (workspaceId: string) => {
  return (prisma as any).office.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' }
  });
};

export const createOffice = async (data: { name: string; address?: string; workspaceId: string }) => {
  return (prisma as any).office.create({
    data
  });
};

export const deleteOffice = async (id: string, workspaceId: string) => {
  return (prisma as any).office.deleteMany({
    where: { id, workspaceId }
  });
};
