import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(191, `Invalid ${label}`);

const numericIntField = (label: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return value;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    },
    z.number().int(`${label} must be a whole number`),
  );

const transitionSchema = z.object({
  fromStageId: requiredId('fromStageId'),
  toStageId: requiredId('toStageId'),
  numberOfDays: numericIntField('numberOfDays').refine((value) => value > 0, {
    message: 'numberOfDays must be greater than 0',
  }),
  sortOrder: numericIntField('sortOrder').refine((value) => value > 0, {
    message: 'sortOrder must be greater than 0',
  }).optional(),
});

export const createLeadLifeCycleSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  isDefault: z.boolean().optional().default(false),
  transitions: z.array(transitionSchema).min(1, 'At least one transition is required'),
});

export type CreateLeadLifeCycleInput = z.infer<typeof createLeadLifeCycleSchema>;

export const updateLeadLifeCycleSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  isDefault: z.boolean().optional(),
  transitions: z.array(transitionSchema).min(1, 'At least one transition is required'),
});

export type UpdateLeadLifeCycleInput = z.infer<typeof updateLeadLifeCycleSchema>;

export const listLeadLifeCyclesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).default(''),
});

export type ListLeadLifeCyclesQuery = z.infer<typeof listLeadLifeCyclesQuerySchema>;

export const leadLifeCycleIdParamSchema = z.object({
  id: requiredId('id'),
});

export type LeadLifeCycleIdParamInput = z.infer<typeof leadLifeCycleIdParamSchema>;
