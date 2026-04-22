import { z } from 'zod';

const targetCycleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const targetCycleRangeSchema = z
  .object({
    startDay: z.number().int().min(1, 'startDay must be between 1 and 31').max(31, 'startDay must be between 1 and 31'),
    endDay: z.number().int().min(1, 'endDay must be between 1 and 31').max(31, 'endDay must be between 1 and 31'),
  })
  .refine((value) => value.endDay >= value.startDay, {
    message: 'endDay must be greater than or equal to startDay',
    path: ['endDay'],
  });

export const createTargetCycleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  ranges: z.array(targetCycleRangeSchema).min(1, 'At least one range is required'),
  status: targetCycleStatusSchema.default('ACTIVE'),
});

export type CreateTargetCycleInput = z.infer<typeof createTargetCycleSchema>;

export const updateTargetCycleSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters').optional(),
    ranges: z.array(targetCycleRangeSchema).min(1, 'At least one range is required').optional(),
    status: targetCycleStatusSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.ranges !== undefined || value.status !== undefined, {
    message: 'At least one field is required for update.',
  });

export type UpdateTargetCycleInput = z.infer<typeof updateTargetCycleSchema>;

export const listTargetCyclesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  status: targetCycleStatusSchema.optional(),
});

export type ListTargetCyclesQuery = z.infer<typeof listTargetCyclesQuerySchema>;

