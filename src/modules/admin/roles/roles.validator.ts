import { z } from 'zod';
import { RoleStatus } from '@prisma/client';

export const createRoleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long'),
  status: z.nativeEnum(RoleStatus).default(RoleStatus.ACTIVE),
  description: z.string().max(255, 'Description too long').optional(),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long').optional(),
  status: z.nativeEnum(RoleStatus).optional(),
  description: z.string().max(255, 'Description too long').optional(),
  permissions: z.array(z.string()).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const listRolesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10))) : 10)),
  search: z.string().optional().default(''),
  status: z.nativeEnum(RoleStatus).optional(),
});

export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
