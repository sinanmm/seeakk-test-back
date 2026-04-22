import { z } from 'zod';

// Manual enum definition to bypass Prisma Client generation issues
export enum DepartmentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export const createDepartmentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim(),
  description: z.string().optional(),
  status: z.nativeEnum(DepartmentStatus).default(DepartmentStatus.ACTIVE),
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(DepartmentStatus).optional(),
});

export const listDepartmentsQuerySchema = z.object({
  page: z.preprocess((val) => Number(val) || 1, z.number().min(1).default(1)),
  limit: z.preprocess((val) => Number(val) || 10, z.number().min(1).max(100).default(10)),
  search: z.string().optional(),
  status: z.nativeEnum(DepartmentStatus).optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;
