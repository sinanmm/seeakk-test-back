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

const normalizeStageShortFormInput = (value?: string | null): string | null => {
  const normalized = (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return null;
  return normalized.slice(0, 10);
};

const stageShortFormFieldSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return String(value);
  },
  z
    .union([z.string().max(10, 'Stage short form must not exceed 10 characters'), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : normalizeStageShortFormInput(value))),
);

const showInCalendarFieldSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
}, z.boolean());

export const stageStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const stageRuleAssignmentSchema = z.object({
  ruleId: z.string().trim().min(1, 'Rule id is required'),
  required: z.boolean().default(false),
});

const normalizeRuleAssignments = (
  ruleIds: string[] | undefined,
  ruleAssignments: Array<{ ruleId: string; required: boolean }> | undefined,
) => {
  if (ruleAssignments && ruleAssignments.length > 0) {
    return ruleAssignments;
  }

  return (ruleIds || []).map((ruleId) => ({
    ruleId,
    required: false,
  }));
};

export const createLeadStageSchema = z.object({
  name: leadStageNameSchema,
  stageShortForm: stageShortFormFieldSchema,
  showInCalendar: showInCalendarFieldSchema.default(true),
  color: stageColorSchema.default('#10b981'),
  isApprovalRequired: z.boolean().default(false),
  isClosed: z.boolean().default(false),
  isLOB: z.boolean().default(false),
  order: z.number().int().min(1, 'Order must be greater than 0'),
  status: stageStatusSchema.default('ACTIVE'),
  ruleIds: z.array(z.string().trim().min(1, 'Rule id is required')).optional().default([]),
  ruleAssignments: z.array(stageRuleAssignmentSchema).optional().default([]),
})
.transform((value) => ({
  ...value,
  stageShortForm: normalizeStageShortFormInput(value.stageShortForm),
  ruleAssignments: normalizeRuleAssignments(value.ruleIds, value.ruleAssignments),
}))
.refine((value) => new Set(value.ruleAssignments.map((rule) => rule.ruleId)).size === value.ruleAssignments.length, {
  message: 'Duplicate stage rules are not allowed.',
  path: ['ruleAssignments'],
})
.refine((value) => !value.showInCalendar || Boolean(value.stageShortForm), {
  message: 'Stage short form is required when Show In Calendar is enabled.',
  path: ['stageShortForm'],
});

export type CreateLeadStageInput = z.infer<typeof createLeadStageSchema>;

export const updateLeadStageSchema = z
  .object({
    name: leadStageNameSchema.optional(),
    stageShortForm: stageShortFormFieldSchema,
    showInCalendar: showInCalendarFieldSchema.optional(),
    color: stageColorSchema.optional(),
    isApprovalRequired: z.boolean().optional(),
    isClosed: z.boolean().optional(),
    isLOB: z.boolean().optional(),
    order: z.number().int().min(1, 'Order must be greater than 0').optional(),
    status: stageStatusSchema.optional(),
    ruleIds: z.array(z.string().trim().min(1, 'Rule id is required')).optional(),
    ruleAssignments: z.array(stageRuleAssignmentSchema).optional(),
  })
  .transform((value) => ({
    ...value,
    ...(value.stageShortForm !== undefined
      ? { stageShortForm: normalizeStageShortFormInput(value.stageShortForm) }
      : {}),
    ruleAssignments:
      value.ruleAssignments !== undefined || value.ruleIds !== undefined
        ? normalizeRuleAssignments(value.ruleIds, value.ruleAssignments)
        : undefined,
  }))
  .refine(
    (value) =>
      value.name !== undefined ||
      value.stageShortForm !== undefined ||
      value.showInCalendar !== undefined ||
      value.color !== undefined ||
      value.isApprovalRequired !== undefined ||
      value.isClosed !== undefined ||
      value.isLOB !== undefined ||
      value.order !== undefined ||
      value.status !== undefined ||
      value.ruleAssignments !== undefined ||
      value.ruleIds !== undefined,
    { message: 'At least one field is required for update.' },
  )
  .refine(
    (value) =>
      value.ruleAssignments === undefined ||
      new Set(value.ruleAssignments.map((rule) => rule.ruleId)).size === value.ruleAssignments.length,
    {
      message: 'Duplicate stage rules are not allowed.',
      path: ['ruleAssignments'],
    },
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
