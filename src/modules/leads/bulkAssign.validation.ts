import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalId = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).max(191).optional(),
);

const optionalDate = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }
  return value;
}, z.date().optional());

const optionalStringArray = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  return value;
}, z.array(z.string().trim().min(1).max(191)).optional());

const assignmentTypeSchema = z.enum(['SINGLE', 'ROUND_ROBIN']);

const bulkAssignFiltersRawSchema = z.object({
  stage_id: optionalId,
  assigned_to: optionalId,
  lifecycle_id: optionalId,
  source_id: optionalId,
  followup_date_from: optionalDate,
  followup_date_to: optionalDate,
  created_date_from: optionalDate,
  created_date_to: optionalDate,
  stageId: optionalId,
  assignedTo: optionalId,
  lifecycleId: optionalId,
  sourceId: optionalId,
  followupDateFrom: optionalDate,
  followupDateTo: optionalDate,
  createdDateFrom: optionalDate,
  createdDateTo: optionalDate,
});

const bulkAssignFiltersBaseSchema = bulkAssignFiltersRawSchema
  .transform((value) => ({
    stageId: value.stageId ?? value.stage_id,
    assignedTo: value.assignedTo ?? value.assigned_to,
    lifecycleId: value.lifecycleId ?? value.lifecycle_id,
    sourceId: value.sourceId ?? value.source_id,
    followupDateFrom: value.followupDateFrom ?? value.followup_date_from,
    followupDateTo: value.followupDateTo ?? value.followup_date_to,
    createdDateFrom: value.createdDateFrom ?? value.created_date_from,
    createdDateTo: value.createdDateTo ?? value.created_date_to,
  }))
  .superRefine((value, ctx) => {
    if (value.followupDateFrom && value.followupDateTo && value.followupDateFrom > value.followupDateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'followup_date_from must be before followup_date_to',
        path: ['followup_date_from'],
      });
    }

    if (value.createdDateFrom && value.createdDateTo && value.createdDateFrom > value.createdDateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'created_date_from must be before created_date_to',
        path: ['created_date_from'],
      });
    }
  });

export const bulkAssignPreviewSchema = bulkAssignFiltersRawSchema.extend({
  sample_limit: z.coerce.number().int().min(1).max(5000).optional(),
  sampleLimit: z.coerce.number().int().min(1).max(5000).optional(),
}).transform((value) => ({
  stageId: value.stageId ?? value.stage_id,
  assignedTo: value.assignedTo ?? value.assigned_to,
  lifecycleId: value.lifecycleId ?? value.lifecycle_id,
  sourceId: value.sourceId ?? value.source_id,
  followupDateFrom: value.followupDateFrom ?? value.followup_date_from,
  followupDateTo: value.followupDateTo ?? value.followup_date_to,
  createdDateFrom: value.createdDateFrom ?? value.created_date_from,
  createdDateTo: value.createdDateTo ?? value.created_date_to,
  sampleLimit: value.sampleLimit ?? value.sample_limit ?? 5000,
})).superRefine((value, ctx) => {
  if (value.followupDateFrom && value.followupDateTo && value.followupDateFrom > value.followupDateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'followup_date_from must be before followup_date_to',
      path: ['followup_date_from'],
    });
  }

  if (value.createdDateFrom && value.createdDateTo && value.createdDateFrom > value.createdDateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'created_date_from must be before created_date_to',
      path: ['created_date_from'],
    });
  }
});

export const bulkAssignSchema = z.object({
  filters: bulkAssignFiltersBaseSchema,
  assignment_type: assignmentTypeSchema.optional(),
  assignmentType: assignmentTypeSchema.optional(),
  assign_to: optionalId,
  assignTo: optionalId,
  assign_to_ids: optionalStringArray,
  assignToIds: optionalStringArray,
  lead_ids: optionalStringArray,
  leadIds: optionalStringArray,
}).transform((value) => ({
  filters: value.filters,
  assignmentType: value.assignmentType ?? value.assignment_type ?? 'SINGLE',
  assignTo: value.assignTo ?? value.assign_to,
  assignToIds: Array.from(new Set([...(value.assignToIds ?? []), ...(value.assign_to_ids ?? [])])),
  leadIds: Array.from(new Set([...(value.leadIds ?? []), ...(value.lead_ids ?? [])])),
})).superRefine((value, ctx) => {
  if (value.assignmentType === 'SINGLE' && !value.assignTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select an assignee before bulk assigning leads.',
      path: ['assign_to'],
    });
  }

  if (value.assignmentType === 'ROUND_ROBIN' && value.assignToIds.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select at least two assignees for round robin distribution.',
      path: ['assign_to_ids'],
    });
  }
});

export type BulkAssignFiltersInput = z.infer<typeof bulkAssignFiltersBaseSchema>;
export type BulkAssignPreviewInput = z.infer<typeof bulkAssignPreviewSchema>;
export type BulkAssignInput = z.infer<typeof bulkAssignSchema>;
