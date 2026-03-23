import { z } from 'zod';
import { LEAD_DYNAMIC_INPUT_TYPES } from './leadDynamics.types';

const optionInputTypes = new Set(['SELECT', 'RADIO', 'CHECKBOX']);

export const leadDynamicInputTypeSchema = z.enum(LEAD_DYNAMIC_INPUT_TYPES);

export const leadDynamicOptionSchema = z.object({
  value: z.string().trim().min(1, 'Option value is required').max(100, 'Option value must not exceed 100 characters'),
  sortOrder: z.number().int().min(1, 'Option sortOrder must be at least 1'),
});

export const createLeadDynamicFieldSchema = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(100, 'Name must not exceed 100 characters'),
    inputType: leadDynamicInputTypeSchema,
    sortOrder: z.number().int().min(1, 'sortOrder must be at least 1'),
    isRequired: z.boolean().default(false),
    isActive: z.boolean().default(true),
    options: z.array(leadDynamicOptionSchema).optional().default([]),
  })
  .superRefine((value, ctx) => {
    const needsOptions = optionInputTypes.has(value.inputType);
    if (needsOptions && value.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Options are required for ${value.inputType}.`,
      });
    }
    if (!needsOptions && value.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Options are not allowed for ${value.inputType}.`,
      });
    }
  });

export type CreateLeadDynamicFieldInput = z.infer<typeof createLeadDynamicFieldSchema>;

export const updateLeadDynamicFieldSchema = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(100, 'Name must not exceed 100 characters').optional(),
    inputType: leadDynamicInputTypeSchema.optional(),
    sortOrder: z.number().int().min(1, 'sortOrder must be at least 1').optional(),
    isRequired: z.boolean().optional(),
    isActive: z.boolean().optional(),
    options: z.array(leadDynamicOptionSchema).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.inputType !== undefined ||
      value.sortOrder !== undefined ||
      value.isRequired !== undefined ||
      value.isActive !== undefined ||
      value.options !== undefined,
    { message: 'At least one field is required for update.' },
  );

export type UpdateLeadDynamicFieldInput = z.infer<typeof updateLeadDynamicFieldSchema>;

export const listLeadDynamicFieldsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  inputType: leadDynamicInputTypeSchema.optional(),
});

export type ListLeadDynamicFieldsQuery = z.infer<typeof listLeadDynamicFieldsQuerySchema>;

export const saveLeadDynamicValuesSchema = z.object({
  values: z
    .array(
      z.object({
        fieldId: z.string().trim().min(1, 'fieldId is required'),
        value: z.string().trim().min(1, 'value is required').max(1000, 'value must not exceed 1000 characters'),
      }),
    )
    .min(1, 'At least one field value is required'),
});

export type SaveLeadDynamicValuesInput = z.infer<typeof saveLeadDynamicValuesSchema>;
