import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const extensionReasonIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(191, 'Invalid id'),
});

export const createExtensionReasonSchema = z.object({
  reasonName: z.string().trim().min(1, 'Reason Name is required').max(255, 'Reason Name must not exceed 255 characters'),
  description: z.string().trim().max(1000, 'Description must not exceed 1000 characters').optional().nullable(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0, 'Sort Order must be at least 0').default(0),
});

export const updateExtensionReasonSchema = z
  .object({
    reasonName: z.string().trim().min(1, 'Reason Name is required').max(255, 'Reason Name must not exceed 255 characters').optional(),
    description: z.string().trim().max(1000, 'Description must not exceed 1000 characters').optional().nullable(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0, 'Sort Order must be at least 0').optional(),
  })
  .refine((value) => value.reasonName !== undefined || value.description !== undefined || value.isActive !== undefined || value.sortOrder !== undefined, {
    message: 'At least one field is required for update.',
  });

export const toggleExtensionReasonStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listExtensionReasonsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(255).optional()),
  isActive: z.preprocess(
    (val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    },
    z.boolean().optional()
  ),
});

export type CreateExtensionReasonInput = z.infer<typeof createExtensionReasonSchema>;
export type UpdateExtensionReasonInput = z.infer<typeof updateExtensionReasonSchema>;
export type ToggleExtensionReasonStatusInput = z.infer<typeof toggleExtensionReasonStatusSchema>;
export type ListExtensionReasonsQueryInput = z.infer<typeof listExtensionReasonsQuerySchema>;
export type ExtensionReasonIdParamInput = z.infer<typeof extensionReasonIdParamSchema>;
