import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalId = (label: string) =>
  z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .min(1, `Invalid ${label} ID`)
      .max(191, `Invalid ${label} ID`)
      .optional(),
  );

const emptyStringOrNullToNull = (value: unknown) => {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const nullableOptionalId = (label: string) =>
  z.preprocess(
    emptyStringOrNullToNull,
    z.union([
      z
        .string()
        .trim()
        .min(1, `Invalid ${label} ID`)
        .max(191, `Invalid ${label} ID`),
      z.null(),
    ]).optional(),
  );

import { validatePhoneStr } from '../utils/phoneUtils';

const optionalText = (schema: z.ZodString) =>
  z.preprocess(emptyStringToUndefined, schema.optional());

const phoneValidationSchema = z.preprocess(
  emptyStringToUndefined,
  z.string()
    .trim()
    .superRefine((val, ctx) => {
      if (!val) return;
      const res = validatePhoneStr(val);
      if (!res.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message || 'Invalid phone number.',
        });
      }
    })
    .optional()
);

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  username: optionalText(z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long')),
  email: z.email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .optional(),
  phone: phoneValidationSchema,
  roleId: optionalId('role'),
  departmentId: optionalId('department'),
  supervisorId: optionalId('supervisor'),
  officeId: optionalId('office'),
  countryId: optionalId('country'),
  stateId: optionalId('state'),
  districtId: optionalId('district'),
  assignedLocationIds: z.array(z.string().trim().min(1, 'Invalid location ID')).optional(),
  assignedTargetCycleId: nullableOptionalId('target cycle'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: optionalText(z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long')),
  username: optionalText(z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long')),
  phone: phoneValidationSchema,
  roleId: optionalId('role'),
  departmentId: optionalId('department'),
  supervisorId: nullableOptionalId('supervisor'),
  officeId: optionalId('office'),
  countryId: optionalId('country'),
  stateId: optionalId('state'),
  districtId: optionalId('district'),
  assignedLocationIds: z.array(z.string().trim().min(1, 'Invalid location ID')).optional(),
  isEmailVerified: z.boolean().optional(),
  assignedTargetCycleId: nullableOptionalId('target cycle'),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateStatusSchema = z.object({
  isActive: z.boolean({ message: 'isActive (boolean) is required' }),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .optional(),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
  roleId: z.string().trim().min(1, 'Invalid role ID filter').optional(),
  isActive: z
    .string()
    .optional()
    .transform((v): boolean | undefined => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }),
  email: z.string().optional(),
  officeId: z.string().trim().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
