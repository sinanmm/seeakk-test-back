import { z } from 'zod';

export const filterConditionSchema = z.object({
  field: z.string().min(1, 'Field is required'),
  operator: z.string().min(1, 'Operator is required'),
  value: z.any().optional(),
});

export const createSectionSchema = z.object({
  name: z.string().trim().min(1, 'Section name is required').max(150),
  description: z.string().trim().max(1000).optional(),
  layoutType: z.enum(['FULL', 'TWO_COL', 'THREE_COL', 'FOUR_COL', 'AUTO']).default('AUTO'),
  visibilityType: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).default('PRIVATE'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  shares: z
    .array(
      z.object({
        shareType: z.enum(['USER', 'ROLE', 'OFFICE', 'DEPARTMENT']),
        targetId: z.string().min(1),
      }),
    )
    .optional(),
});

export const updateSectionSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  layoutType: z.enum(['FULL', 'TWO_COL', 'THREE_COL', 'FOUR_COL', 'AUTO']).optional(),
  visibilityType: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  shares: z
    .array(
      z.object({
        shareType: z.enum(['USER', 'ROLE', 'OFFICE', 'DEPARTMENT']),
        targetId: z.string().min(1),
      }),
    )
    .optional(),
});

export const reorderSectionsSchema = z.object({
  sections: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int().min(0),
    }),
  ),
});

export const pipelineSegmentSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, 'Segment label is required'),
  metricType: z.string().optional(),
  filtersJson: z.array(filterConditionSchema).default([]),
  filterLogic: z.enum(['AND', 'OR']).default('AND'),
  color: z.string().optional(),
});

export const createPipelineSchema = z.object({
  sectionId: z.string().min(1, 'Section ID is required'),
  name: z.string().trim().min(1, 'Pipeline name is required').max(150),
  description: z.string().trim().max(1000).optional(),
  metricType: z
    .enum([
      'LEAD_COUNT',
      'TOTAL_EXPECTED_REVENUE',
      'TOTAL_CLOSED_REVENUE',
      'AVERAGE_REVENUE',
      'CONVERSION_RATE',
      'LOB_COUNT',
      'FOLLOWUP_COUNT',
      'OVERDUE_FOLLOWUP_COUNT',
      'STAGE_DISTRIBUTION',
    ])
    .default('LEAD_COUNT'),
  displayType: z
    .enum([
      'COMPACT_CARD',
      'HORIZONTAL_BAR',
      'PROGRESS_BAR',
      'STATUS_CARD',
      'MINI_TABLE',
      'STAGE_BAR',
      'PERCENTAGE_CARD',
      'REVENUE_CARD',
      'PIE_CHART',
    ])
    .default('COMPACT_CARD'),
  filtersJson: z.array(filterConditionSchema).default([]),
  segmentsJson: z.array(pipelineSegmentSchema).optional(),
  filterLogic: z.enum(['AND', 'OR']).default('AND'),
  visibilityType: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).default('PRIVATE'),
  clickAction: z.enum(['OPEN_LEADS', 'OPEN_DRAWER']).default('OPEN_LEADS'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  shares: z
    .array(
      z.object({
        shareType: z.enum(['USER', 'ROLE', 'OFFICE', 'DEPARTMENT']),
        targetId: z.string().min(1),
      }),
    )
    .optional(),
});

export const updatePipelineSchema = z.object({
  sectionId: z.string().optional(),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  metricType: z.string().optional(),
  displayType: z.string().optional(),
  filtersJson: z.array(filterConditionSchema).optional(),
  segmentsJson: z.array(pipelineSegmentSchema).optional(),
  filterLogic: z.enum(['AND', 'OR']).optional(),
  visibilityType: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  clickAction: z.enum(['OPEN_LEADS', 'OPEN_DRAWER']).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  shares: z
    .array(
      z.object({
        shareType: z.enum(['USER', 'ROLE', 'OFFICE', 'DEPARTMENT']),
        targetId: z.string().min(1),
      }),
    )
    .optional(),
});

export const reorderPipelinesSchema = z.object({
  pipelines: z.array(
    z.object({
      id: z.string(),
      sectionId: z.string().optional(),
      sortOrder: z.number().int().min(0),
    }),
  ),
});

export const previewPipelineSchema = z.object({
  filtersJson: z.array(filterConditionSchema).default([]),
  segmentsJson: z.array(pipelineSegmentSchema).optional(),
  displayType: z.string().optional(),
  filterLogic: z.enum(['AND', 'OR']).default('AND'),
  metricType: z.string().default('LEAD_COUNT'),
});

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type PreviewPipelineInput = z.infer<typeof previewPipelineSchema>;
