import { z } from 'zod';
import { LOBReasonStatus } from '@prisma/client';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const lobReasonStatusSchema = z.preprocess(
  emptyStringToUndefined,
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.nativeEnum(LOBReasonStatus).optional(),
  ),
);

export const lobReasonIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(191, 'Invalid id'),
});

export const createLOBReasonSchema = z.object({
  name: z.string().trim().min(1, 'Reason name is required').max(255, 'Reason name must not exceed 255 characters'),
  status: lobReasonStatusSchema.default(LOBReasonStatus.ACTIVE),
});

export const updateLOBReasonSchema = z
  .object({
    name: z.string().trim().min(1, 'Reason name is required').max(255, 'Reason name must not exceed 255 characters').optional(),
    status: lobReasonStatusSchema,
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'At least one field is required for update.',
  });

export const toggleLOBReasonStatusSchema = z.object({
  status: lobReasonStatusSchema,
});

export const listLOBReasonsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(255).optional()),
  status: lobReasonStatusSchema,
});

export type CreateLOBReasonInput = z.infer<typeof createLOBReasonSchema>;
export type UpdateLOBReasonInput = z.infer<typeof updateLOBReasonSchema>;
export type ToggleLOBReasonStatusInput = z.infer<typeof toggleLOBReasonStatusSchema>;
export type ListLOBReasonsQueryInput = z.infer<typeof listLOBReasonsQuerySchema>;
export type LOBReasonIdParamInput = z.infer<typeof lobReasonIdParamSchema>;
