import { z } from 'zod';

// ─── Create User ──────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long').optional(),
  email: z.email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .optional(),
  phone: z.string().max(20, 'Phone number too long').optional(),
  roleId: z.string().cuid('Invalid role ID').optional(),
  departmentId: z.string().cuid('Invalid department ID').optional(),
  supervisorId: z.string().cuid('Invalid supervisor ID').optional(),
  officeId: z.string().cuid('Invalid office ID').optional(),
  countryId: z.string().cuid('Invalid country ID').optional(),
  stateId: z.string().cuid('Invalid state ID').optional(),
  districtId: z.string().cuid('Invalid district ID').optional(),
  assignedLocationIds: z.array(z.string().cuid('Invalid location ID')).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// ─── Update User ──────────────────────────────────────────────────────────────
export const updateUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long').optional(),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long').optional(),
  phone: z.string().max(20, 'Phone number too long').optional(),
  roleId: z.string().cuid('Invalid role ID').optional(),
  departmentId: z.string().cuid('Invalid department ID').optional(),
  supervisorId: z.string().cuid('Invalid supervisor ID').optional(),
  officeId: z.string().cuid('Invalid office ID').optional(),
  countryId: z.string().cuid('Invalid country ID').optional(),
  stateId: z.string().cuid('Invalid state ID').optional(),
  districtId: z.string().cuid('Invalid district ID').optional(),
  assignedLocationIds: z.array(z.string().cuid('Invalid location ID')).optional(),
  isEmailVerified: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ─── Status Toggle ────────────────────────────────────────────────────────────
// Zod v4: use `message` instead of `required_error`
export const updateStatusSchema = z.object({
  isActive: z.boolean({ message: 'isActive (boolean) is required' }),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

// ─── Reset Password ───────────────────────────────────────────────────────────
export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .optional(), // If omitted, the service will auto-generate a secure random password
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── List Query ───────────────────────────────────────────────────────────────
export const listUsersQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10))) : 20)),
  search: z.string().optional().default(''),
  roleId: z.string().cuid('Invalid role ID filter').optional(),
  isActive: z
    .string()
    .optional()
    .transform((v): boolean | undefined => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }),
  email: z.string().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
