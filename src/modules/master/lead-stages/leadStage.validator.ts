import { z } from 'zod';

const leadStageNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must not exceed 100 characters');

const stageColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9A-Fa-f]{6})$/, 'Color must be a valid hex value');

export const stageStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createLeadStageSchema = z.object({
  name: leadStageNameSchema,
  color: stageColorSchema.default('#10b981'),
  isApprovalRequired: z.boolean().default(false),
  isClosed: z.boolean().default(false),
  isLOB: z.boolean().default(false),
  order: z.number().int().min(1, 'Order must be greater than 0'),
  status: stageStatusSchema.default('ACTIVE'),
});

export type CreateLeadStageInput = z.infer<typeof createLeadStageSchema>;

export const updateLeadStageSchema = z
  .object({
    name: leadStageNameSchema.optional(),
    color: stageColorSchema.optional(),
    isApprovalRequired: z.boolean().optional(),
    isClosed: z.boolean().optional(),
    isLOB: z.boolean().optional(),
    order: z.number().int().min(1, 'Order must be greater than 0').optional(),
    status: stageStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.color !== undefined ||
      value.isApprovalRequired !== undefined ||
      value.isClosed !== undefined ||
      value.isLOB !== undefined ||
      value.order !== undefined ||
      value.status !== undefined,
    { message: 'At least one field is required for update.' },
  );

export type UpdateLeadStageInput = z.infer<typeof updateLeadStageSchema>;

export const reorderLeadStagesSchema = z
  .array(
    z.object({
      id: z.string().trim().min(1, 'Stage id is required'),
      order: z.number().int().min(1, 'Order must be greater than 0'),
    }),
  )
  .min(1, 'At least one stage is required for reorder')
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: 'Duplicate stage ids are not allowed in reorder payload.',
  })
  .refine((items) => new Set(items.map((item) => item.order)).size === items.length, {
    message: 'Duplicate order values are not allowed in reorder payload.',
  });

export type ReorderLeadStagesInput = z.infer<typeof reorderLeadStagesSchema>;

export const listLeadStagesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  status: stageStatusSchema.optional(),
});

export type ListLeadStagesQuery = z.infer<typeof listLeadStagesQuerySchema>;
