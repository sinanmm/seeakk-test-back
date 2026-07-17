import { z } from 'zod';
import { validatePhoneStr } from '../utils/phoneUtils';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const phoneValidationSchema = z.preprocess(
  emptyStringToUndefined,
  z.string()
    .trim()
    .superRefine((val, ctx) => {
      if (!val) return;
      const res = validatePhoneStr(val);
      if (!res.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message || 'Invalid phone number.',
        });
      }
    })
    .nullable()
    .optional()
);

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

const followUpTypeField = z.enum(['CALL', 'VISIT', 'MEETING']).optional();

const rejectHtmlOrScript = (value: string) =>
  !/<[^>]*>/u.test(value) && !/javascript\s*:/iu.test(value);

const leadRemarksField = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .max(1000, 'remarks must be 1000 characters or fewer')
    .refine(rejectHtmlOrScript, 'remarks cannot contain HTML or script content')
    .optional(),
);

const nullableLeadRemarksField = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .max(1000, 'remarks must be 1000 characters or fewer')
    .refine(rejectHtmlOrScript, 'remarks cannot contain HTML or script content')
    .nullable()
    .optional(),
);

const lobRemarksField = z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'lobRemarks is too long').optional());

const nullableLobRemarksField = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().max(2000, 'lobRemarks is too long').nullable().optional(),
);

const leadDynamicValueEntrySchema = z.object({
  fieldId: z.string().trim().min(1, 'fieldId is required').max(191, 'Invalid fieldId'),
  value: z.string().max(1000, 'dynamic field value must not exceed 1000 characters').optional().default(''),
});

const leadProductEntrySchema = z.object({
  productId: z.string().trim().min(1, 'productId is required').max(191, 'Invalid productId'),
  quantity: z.coerce.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1'),
});

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(160, 'name is too long'),
  email: z.preprocess(emptyStringToUndefined, z.string().trim().email('email must be valid').max(191, 'email is too long').optional()),
  phone: phoneValidationSchema,
  companyName: z.preprocess(emptyStringToUndefined, z.string().trim().max(200, 'companyName is too long').optional()),
  address: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'address is too long').optional()),
  expectedRevenue: parseOptionalFloat('expectedRevenue'),
  assignedToId: optionalId('assignedToId'),
  stageId: optionalId('stageId'),
  lifecycleId: optionalId('lifecycleId'),
  sourceId: optionalId('sourceId'),
  nextFollowUpAt: parseOptionalDateField('nextFollowUpAt'),
  nextFollowUpType: followUpTypeField,
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
  reasonId: optionalId('reasonId'),
  remarks: leadRemarksField,
  lobRemarks: lobRemarksField,
  dynamicValues: z.array(leadDynamicValueEntrySchema).optional(),
  products: z.array(leadProductEntrySchema).optional(),
  skipAutoStageAssignment: z.coerce.boolean().optional().default(false),
  totalAmount: z.coerce.number().nonnegative('Total amount must be a positive number').optional(),
  advancePayments: z.array(
    z.object({
      amount: z.number().positive('Advance amount must be a positive number'),
      paymentDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid payment date',
      }),
      remarks: z.string().optional(),
      proofUrl: z.string().optional(),
    })
  ).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(160, 'name is too long').optional(),
  email: z.preprocess(emptyStringToUndefined, z.string().trim().email('email must be valid').max(191, 'email is too long').nullable().optional()),
  phone: phoneValidationSchema,
  companyName: z.preprocess(emptyStringToUndefined, z.string().trim().max(200, 'companyName is too long').nullable().optional()),
  address: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'address is too long').nullable().optional()),
  expectedRevenue: z.union([parseOptionalFloat('expectedRevenue'), z.null()]).optional(),
  assignedToId: z.union([optionalId('assignedToId'), z.null()]).optional(),
  stageId: z.union([optionalId('stageId'), z.null()]).optional(),
  lifecycleId: z.union([optionalId('lifecycleId'), z.null()]).optional(),
  sourceId: z.union([optionalId('sourceId'), z.null()]).optional(),
  nextFollowUpAt: z.union([parseOptionalDateField('nextFollowUpAt'), z.null()]).optional(),
  nextFollowUpType: followUpTypeField,
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
  isClosed: z.boolean().optional(),
  reasonId: z.union([optionalId('reasonId'), z.null()]).optional(),
  remarks: nullableLeadRemarksField,
  lobRemarks: nullableLobRemarksField,
  dynamicValues: z.array(leadDynamicValueEntrySchema).optional(),
  products: z.array(leadProductEntrySchema).optional(),
  totalAmount: z.coerce.number().nonnegative('Total amount must be a positive number').optional(),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

const stageRuleValueEntrySchema = z.object({
  ruleId: requiredId('ruleId'),
  value: z.string(),
});

export const changeStageSchema = z.object({
  stageId: requiredId('stageId'),
  reasonId: optionalId('reasonId'),
  remarks: z.preprocess(emptyStringToUndefined, z.string().trim().max(2000, 'remarks is too long').optional()),
  nextFollowUpAt: parseOptionalDateField('nextFollowUpAt'),
  nextFollowUpType: followUpTypeField,
  followUpDescription: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000, 'followUpDescription is too long').optional()),
  stageRuleValues: z.array(stageRuleValueEntrySchema).optional().default([]),
});

export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const assignLeadSchema = z.object({
  assignedToId: z.union([requiredId('assignedToId'), z.null()]),
});

export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

export const extendLeadSlaSchema = z.object({
  extraDays: z.preprocess((value: unknown) => {
    const normalized = emptyStringToUndefined(value);
    if (typeof normalized === 'number') return normalized;
    if (typeof normalized === 'string') {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : normalized;
    }
    return normalized;
  }, z.number().int('extraDays must be a whole number').positive('extraDays must be greater than 0')),
});

export type ExtendLeadSlaInput = z.infer<typeof extendLeadSlaSchema>;

export const leadIdParamSchema = z.object({
  id: requiredId('id'),
});

export type LeadIdParamInput = z.infer<typeof leadIdParamSchema>;

export const leadStageRulesQuerySchema = z.object({
  stageId: requiredId('stageId'),
});

export type LeadStageRulesQueryInput = z.infer<typeof leadStageRulesQuerySchema>;

export const listLeadsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(160).optional()).default(''),
  assignedTo: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  stage: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  source: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  status: z.preprocess(emptyStringToUndefined, z.enum(['OPEN', 'CLOSED', 'LOB', 'ACTIVE', 'ARCHIVED']).optional()).optional(),
  starred: z.preprocess(emptyStringToUndefined, z.enum(['ALL', 'STARRED']).optional()).optional(),
  officeId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
});

export type ListLeadsQueryInput = z.infer<typeof listLeadsQuerySchema>;

export const toggleLeadStarSchema = z.object({
  starred: z.boolean(),
});

export type ToggleLeadStarInput = z.infer<typeof toggleLeadStarSchema>;

export const exportLeadsQuerySchema = listLeadsQuerySchema.extend({
  format: z.preprocess(emptyStringToUndefined, z.enum(['csv']).optional()).default('csv'),
  /** When true, export includes soft-deleted (archived) leads as well as active rows. */
  includeArchived: z.coerce.boolean().optional().default(false),
  fields: z.union([z.string(), z.array(z.string())]).optional(),
});

export type ExportLeadsQueryInput = z.infer<typeof exportLeadsQuerySchema>;
