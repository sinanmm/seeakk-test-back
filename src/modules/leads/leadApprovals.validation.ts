import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`);

const optionalId = (label: string) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`).optional());

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

export const createLeadApprovalSchema = z.object({
  leadId: requiredId('leadId'),
  fromStageId: requiredId('fromStageId'),
  toStageId: requiredId('toStageId'),
  assignedToId: optionalId('assignedToId'),
  requestData: z.record(z.string(), z.any()).optional(),
});

export const listLeadApprovalsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  status: z.preprocess(emptyStringToUndefined, z.enum(['PENDING', 'APPROVED', 'DENIED']).optional()).optional(),
  assignedTo: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  requestedBy: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  dateFrom: parseOptionalDateField('dateFrom'),
  dateTo: parseOptionalDateField('dateTo'),
});

export const leadApprovalIdParamSchema = z.object({
  id: requiredId('id'),
});

export const handleLeadApprovalSchema = z.object({
  action: z.enum(['APPROVE', 'DENY']),
  comment: z.string().trim().min(1, 'comment is required').max(2000, 'comment is too long'),
});

export type CreateLeadApprovalInput = z.infer<typeof createLeadApprovalSchema>;
export type ListLeadApprovalsQueryInput = z.infer<typeof listLeadApprovalsQuerySchema>;
export type LeadApprovalIdParamInput = z.infer<typeof leadApprovalIdParamSchema>;
export type HandleLeadApprovalInput = z.infer<typeof handleLeadApprovalSchema>;
