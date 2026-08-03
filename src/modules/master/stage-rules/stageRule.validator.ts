import { z } from 'zod';

const stageRuleNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must not exceed 100 characters');

export const inputTypeSchema = z.enum(['TEXT', 'TEXTAREA', 'RADIO', 'SELECT']);
export const ruleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const optionsSchema = z
  .array(z.string().trim().min(1, 'Option cannot be empty'))
  .max(50, 'Too many options')
  .optional()
  .default([]);

const minCharactersSchema = z
  .number()
  .int('Minimum Characters must be a whole number')
  .min(1, 'Minimum Characters must be at least 1')
  .max(10000, 'Minimum Characters cannot exceed 10000')
  .optional()
  .nullable();

export const createStageRuleSchema = z
  .object({
    name: stageRuleNameSchema,
    inputType: inputTypeSchema,
    sortOrder: z.number().int().min(1, 'Sort order must be greater than or equal to 1'),
    required: z.boolean().default(false),
    minCharacters: minCharactersSchema,
    status: ruleStatusSchema.default('ACTIVE'),
    stageId: z.string().trim().min(1, 'Stage id must be valid').optional(),
    options: optionsSchema,
  })
  .superRefine((data, ctx) => {
    if (data.inputType === 'RADIO' || data.inputType === 'SELECT') {
      if (!data.options || data.options.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one option is required for radio or select fields.',
          path: ['options'],
        });
      }
    }
    if (data.inputType !== 'TEXTAREA' && data.minCharacters && data.minCharacters > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum Characters can only be configured for Text Area fields.',
        path: ['minCharacters'],
      });
    }
  });

export type CreateStageRuleInput = z.infer<typeof createStageRuleSchema>;

export const updateStageRuleSchema = z
  .object({
    name: stageRuleNameSchema.optional(),
    inputType: inputTypeSchema.optional(),
    sortOrder: z.number().int().min(1, 'Sort order must be greater than or equal to 1').optional(),
    required: z.boolean().optional(),
    minCharacters: minCharactersSchema,
    status: ruleStatusSchema.optional(),
    stageId: z.string().trim().min(1, 'Stage id must be valid').nullable().optional(),
    options: z.array(z.string().trim().min(1, 'Option cannot be empty')).max(50, 'Too many options').optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.inputType !== undefined ||
      value.sortOrder !== undefined ||
      value.required !== undefined ||
      value.minCharacters !== undefined ||
      value.status !== undefined ||
      value.stageId !== undefined ||
      value.options !== undefined,
    { message: 'At least one field is required for update.' },
  )
  .superRefine((data, ctx) => {
    const type = data.inputType;
    if (type === 'RADIO' || type === 'SELECT') {
      if (data.options !== undefined && data.options.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one option is required for radio or select fields.',
          path: ['options'],
        });
      }
    }
    if (type !== undefined && type !== 'TEXTAREA' && data.minCharacters && data.minCharacters > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum Characters can only be configured for Text Area fields.',
        path: ['minCharacters'],
      });
    }
  });

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
