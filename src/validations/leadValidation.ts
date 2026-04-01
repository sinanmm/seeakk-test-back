import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`);

const optionalId = (label: string) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`).optional());

const parseOptionalFloat = (label: string) =>
  z.preprocess((value: unknown) => {
    const normalized = emptyStringToUndefined(value);
    if (normalized === undefined || normalized === null) return undefined;
    if (typeof normalized === 'number') return normalized;
    if (typeof normalized === 'string') {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : normalized;
    }
    return normalized;
  }, z.number({ message: `${label} must be a valid number` }).nonnegative(`${label} must be non-negative`).optional());

const parseOptionalDateField = (label: string) =>
  z.preprocess((value: unknown) => {
    const normalized = emptyStringToUndefined(value);
    if (normalized === undefined || normalized === null) return undefined;
    if (normalized instanceof Date) return normalized;
    if (typeof normalized === 'string') {
      const parsed = new Date(normalized);
      return Number.isNaN(parsed.getTime()) ? normalized : parsed;
    }
    return normalized;
  }, z.date({ message: `${label} must be a valid date` }).optional());

const pageSchema = z
  .string()
  .optional()
  .transform((value) => {
    const parsed = value ? parseInt(value, 10) : 1;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  });

const limitSchema = z
  .string()
  .optional()
  .transform((value) => {
    const parsed = value ? parseInt(value, 10) : 20;
    if (!Number.isFinite(parsed) || parsed < 1) return 20;
    return Math.min(parsed, 100);
  });

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(160, 'name is too long'),
  email: z.preprocess(emptyStringToUndefined, z.string().trim().email('email must be valid').max(191, 'email is too long').optional()),
  phone: z.preprocess(emptyStringToUndefined, z.string().trim().max(40, 'phone is too long').optional()),
  expectedRevenue: parseOptionalFloat('expectedRevenue'),
  assignedToId: optionalId('assignedToId'),
  stageId: optionalId('stageId'),
  lifecycleId: optionalId('lifecycleId'),
  sourceId: optionalId('sourceId'),
  nextFollowUpAt: parseOptionalDateField('nextFollowUpAt'),
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
  reasonId: optionalId('reasonId'),
  remarks: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'remarks is too long').optional()),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(160, 'name is too long').optional(),
  email: z.preprocess(emptyStringToUndefined, z.string().trim().email('email must be valid').max(191, 'email is too long').nullable().optional()),
  phone: z.preprocess(emptyStringToUndefined, z.string().trim().max(40, 'phone is too long').nullable().optional()),
  expectedRevenue: z.union([parseOptionalFloat('expectedRevenue'), z.null()]).optional(),
  assignedToId: z.union([optionalId('assignedToId'), z.null()]).optional(),
  stageId: z.union([optionalId('stageId'), z.null()]).optional(),
  lifecycleId: z.union([optionalId('lifecycleId'), z.null()]).optional(),
  sourceId: z.union([optionalId('sourceId'), z.null()]).optional(),
  nextFollowUpAt: z.union([parseOptionalDateField('nextFollowUpAt'), z.null()]).optional(),
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
  isClosed: z.boolean().optional(),
  reasonId: z.union([optionalId('reasonId'), z.null()]).optional(),
  remarks: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'remarks is too long').nullable().optional()),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const changeStageSchema = z.object({
  stageId: requiredId('stageId'),
  reasonId: optionalId('reasonId'),
  remarks: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'remarks is too long').optional()),
  nextFollowUpAt: parseOptionalDateField('nextFollowUpAt'),
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
});

export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const assignLeadSchema = z.object({
  assignedToId: z.union([requiredId('assignedToId'), z.null()]),
});

export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

export const leadIdParamSchema = z.object({
  id: requiredId('id'),
});

export type LeadIdParamInput = z.infer<typeof leadIdParamSchema>;

export const listLeadsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(160).optional()).default(''),
  assignedTo: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  stage: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  source: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  status: z.preprocess(emptyStringToUndefined, z.enum(['OPEN', 'CLOSED', 'LOB', 'ACTIVE']).optional()).optional(),
});

export type ListLeadsQueryInput = z.infer<typeof listLeadsQuerySchema>;

export const exportLeadsQuerySchema = listLeadsQuerySchema.extend({
  format: z.preprocess(emptyStringToUndefined, z.enum(['csv']).optional()).default('csv'),
});

export type ExportLeadsQueryInput = z.infer<typeof exportLeadsQuerySchema>;
