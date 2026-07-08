import prisma from '../../../config/prisma';
import { 
  CreateDepartmentInput, 
  UpdateDepartmentInput, 
  ListDepartmentsQuery 
} from './departments.validator';
import { ListDepartmentsResponse, DepartmentResponse } from './departments.types';

/**
 * Service to handle department database operations
 */

export const createDepartment = async (
  workspaceId: string, 
  data: CreateDepartmentInput
): Promise<DepartmentResponse> => {
  const { name, description, status } = data;

  // 1. Check if department exists in workspace (including soft-deleted)
  const existing = await (prisma.department as any).findFirst({
    where: {
      name,
      workspaceId,
    },
  });

  if (existing) {
    if ((existing as any).deletedAt) {
      // Reactivate soft-deleted department
      return await (prisma.department as any).update({
        where: { id: existing.id },
        data: {
          description,
          status,
          deletedAt: null,
        },
      });
    }
    const err: any = new Error(`Department "${name}" already exists.`);
    err.statusCode = 409;
    throw err;
  }

  // 2. Create department
  return await (prisma.department as any).create({
    data: {
      name,
      description,
      status,
      workspaceId,
    },
  });
};

export const listDepartments = async (
  workspaceId: string, 
  query: ListDepartmentsQuery
): Promise<ListDepartmentsResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    workspaceId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive'},
        }
      : {}),
  };

  const [total, departments] = await prisma.$transaction([
    (prisma.department as any).count({ where }),
    (prisma.department as any).findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true } },
      },
    }),
  ]);

  return {
    data: departments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getActiveDepartments = async (workspaceId: string): Promise<DepartmentResponse[]> => {
  return await (prisma.department as any).findMany({
    where: {
      workspaceId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    orderBy: { name: 'asc' },
  });
};

export const updateDepartment = async (
  id: string, 
  workspaceId: string, 
  data: UpdateDepartmentInput
): Promise<DepartmentResponse> => {
  // 1. Check if department exists and belongs to workspace
  const department = await (prisma.department as any).findFirst({
    where: { id, workspaceId, deletedAt: null },
  });

  if (!department) {
    const err: any = new Error('Department not found.');
    err.statusCode = 404;
    throw err;
  }

  // 2. Check name uniqueness if changed
  if (data.name && data.name !== (department as any).name) {
    const existing = await (prisma.department as any).findFirst({
      where: {
        name: data.name,
        workspaceId,
        NOT: { id },
      },
    });

    if (existing && !(existing as any).deletedAt) {
      const err: any = new Error(`Department named "${data.name}" already exists.`);
      err.statusCode = 409;
      throw err;
    }
  }

  // 3. Update
  return await (prisma.department as any).update({
    where: { id },
    data,
  });
};

export const deleteDepartment = async (id: string, workspaceId: string): Promise<void> => {
  // 1. Check if department has users
  const usersCount = await prisma.user.count({
    where: { departmentId: id, workspaceId },
  } as any);

  if (usersCount > 0) {
    const err: any = new Error('Cannot delete department assigned to users.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Soft delete
  const department = await (prisma.department as any).findFirst({
    where: { id, workspaceId, deletedAt: null },
  });

  if (!department) {
    const err: any = new Error('Department not found.');
    err.statusCode = 404;
    throw err;
  }

  await (prisma.department as any).update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};
