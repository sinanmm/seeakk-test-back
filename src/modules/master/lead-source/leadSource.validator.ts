import { z } from 'zod';

const leadSourceNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must not exceed 100 characters');

export const leadSourceStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createLeadSourceSchema = z.object({
  name: leadSourceNameSchema,
  status: leadSourceStatusSchema.default('ACTIVE'),
});

export type CreateLeadSourceInput = z.infer<typeof createLeadSourceSchema>;

export const updateLeadSourceSchema = z
  .object({
    name: leadSourceNameSchema.optional(),
    status: leadSourceStatusSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'At least one field is required for update.',
  });

export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;

export const listLeadSourcesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  status: leadSourceStatusSchema.optional(),
});

export type ListLeadSourcesQuery = z.infer<typeof listLeadSourcesQuerySchema>;

