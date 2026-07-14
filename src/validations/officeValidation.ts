import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(191, `Invalid ${label}`);

const optionalId = (label: string) =>
  z.preprocess(emptyStringToUndefined, requiredId(label).optional());

const officeStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createOfficeSchema = z.object({
  name: z.string().trim().min(2, 'Office name is required').max(100, 'Office name too long'),
  address: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().max(500, 'Address too long').optional(),
  ),
  country: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  state: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  district: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  city: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
});

export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;

export const updateOfficeSchema = z
  .object({
    name: z.string().trim().min(2, 'Office name is required').max(100, 'Office name too long').optional(),
    address: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().max(500, 'Address too long').optional(),
    ),
    country: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
    state: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
    district: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
    city: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.address !== undefined ||
      value.country !== undefined ||
      value.state !== undefined ||
      value.district !== undefined ||
      value.city !== undefined ||
      value.isActive !== undefined,
    { message: 'At least one field is required for update.' },
  );

export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;

export const listOfficesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  status: officeStatusSchema.optional(),
  country: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  state: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  district: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  city: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
});

export type ListOfficesQuery = z.infer<typeof listOfficesQuerySchema>;

export const officeIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Office id is required'),
});

export type OfficeIdParamInput = z.infer<typeof officeIdParamSchema>;

export const toggleOfficeStatusSchema = z.object({
  isActive: z.boolean(),
});

export type ToggleOfficeStatusInput = z.infer<typeof toggleOfficeStatusSchema>;
