import { z } from 'zod';

const stageRuleNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must not exceed 100 characters');

export const inputTypeSchema = z.enum(['TEXT', 'TEXTAREA', 'RADIO', 'SELECT']);
export const ruleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createStageRuleSchema = z.object({
  name: stageRuleNameSchema,
  inputType: inputTypeSchema,
  sortOrder: z.number().int().min(1, 'Sort order must be greater than or equal to 1'),
  required: z.boolean().default(false),
  status: ruleStatusSchema.default('ACTIVE'),
  stageId: z.string().trim().min(1, 'Stage id must be valid').optional(),
});

export type CreateStageRuleInput = z.infer<typeof createStageRuleSchema>;

export const updateStageRuleSchema = z
  .object({
    name: stageRuleNameSchema.optional(),
    inputType: inputTypeSchema.optional(),
    sortOrder: z.number().int().min(1, 'Sort order must be greater than or equal to 1').optional(),
    required: z.boolean().optional(),
    status: ruleStatusSchema.optional(),
    stageId: z.string().trim().min(1, 'Stage id must be valid').nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.inputType !== undefined ||
      value.sortOrder !== undefined ||
      value.required !== undefined ||
      value.status !== undefined ||
      value.stageId !== undefined,
    { message: 'At least one field is required for update.' },
  );

export type UpdateStageRuleInput = z.infer<typeof updateStageRuleSchema>;

export const listStageRulesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  status: ruleStatusSchema.optional(),
  stageId: z.string().trim().min(1).optional(),
});

export type ListStageRulesQuery = z.infer<typeof listStageRulesQuerySchema>;
