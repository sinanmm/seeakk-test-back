import { z } from 'zod';
import { ReportBaseDataSource, ReportModule, ReportTypeStatus } from '@prisma/client';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const normalizeFilterKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^source$/, 'lead_source');

const allowedFilterKeySchema = z
  .string()
  .trim()
  .transform((value) => normalizeFilterKey(value))
  .refine(
    (value) =>
      [
        'stage',
        'assignee',
        'lead_source',
        'created_date',
        'follow_up_date',
        'role',
        'department',
        'office',
        'status',
        'user',
        'module',
        'action',
      ].includes(value),
    {
      message: 'Unsupported filter key',
    },
  );

const reportTypeStatusSchema = z.preprocess(
  emptyStringToUndefined,
  z.nativeEnum(ReportTypeStatus).optional(),
);

const reportModuleSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.nativeEnum(ReportModule),
);

const reportBaseDataSourceSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase();
    if (normalized === 'ACTIVITIES') return 'FOLLOWUPS';
    return normalized;
  },
  z.nativeEnum(ReportBaseDataSource),
);

const allowedFiltersSchema = z
  .array(allowedFilterKeySchema)
  .min(1, 'At least one filter is required')
  .transform((values) => Array.from(new Set(values)));

export const reportTypeIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(191, 'Invalid id'),
});

export const createReportTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255, 'Name must not exceed 255 characters'),
  module: reportModuleSchema,
  base_data_source: reportBaseDataSourceSchema.optional(),
  baseDataSource: reportBaseDataSourceSchema.optional(),
  description: z.preprocess(emptyStringToUndefined, z.string().trim().max(5000).optional()),
  allowed_filters: allowedFiltersSchema.optional(),
  allowedFilters: allowedFiltersSchema.optional(),
  status: reportTypeStatusSchema.default(ReportTypeStatus.ACTIVE),
  category: z.string().trim().optional(),
  trackModules: z.array(z.string()).optional(),
  enableUserFilter: z.boolean().optional(),
  enableDateFilter: z.boolean().optional(),
  trackActivityTypes: z.array(z.string()).optional(),
  allowExport: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  showDetailedLogs: z.boolean().optional(),
})
  .superRefine((value, ctx) => {
    if (!value.baseDataSource && !value.base_data_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseDataSource'],
        message: 'Base data source is required',
      });
    }

    if (!value.allowedFilters && !value.allowed_filters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedFilters'],
        message: 'At least one filter is required',
      });
    }
  })
  .transform((value) => ({
    name: value.name,
    module: value.module,
    baseDataSource: value.baseDataSource ?? value.base_data_source!,
    description: value.description,
    allowedFilters: value.allowedFilters ?? value.allowed_filters!,
    status: value.status ?? ReportTypeStatus.ACTIVE,
    category: value.category ?? "Leads Report",
    trackModules: value.trackModules ?? [],
    enableUserFilter: value.enableUserFilter ?? false,
    enableDateFilter: value.enableDateFilter ?? false,
    trackActivityTypes: value.trackActivityTypes ?? [],
    allowExport: value.allowExport ?? false,
    showSummary: value.showSummary ?? false,
    showDetailedLogs: value.showDetailedLogs ?? false,
  }));

export const updateReportTypeSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255, 'Name must not exceed 255 characters').optional(),
    module: reportModuleSchema.optional(),
    base_data_source: reportBaseDataSourceSchema.optional(),
    baseDataSource: reportBaseDataSourceSchema.optional(),
    description: z.preprocess(emptyStringToUndefined, z.string().trim().max(5000).optional()).optional(),
    allowed_filters: allowedFiltersSchema.optional(),
    allowedFilters: allowedFiltersSchema.optional(),
    status: reportTypeStatusSchema,
    category: z.string().trim().optional(),
    trackModules: z.array(z.string()).optional(),
    enableUserFilter: z.boolean().optional(),
    enableDateFilter: z.boolean().optional(),
    trackActivityTypes: z.array(z.string()).optional(),
    allowExport: z.boolean().optional(),
    showSummary: z.boolean().optional(),
    showDetailedLogs: z.boolean().optional(),
  })
  .transform((value) => ({
    name: value.name,
    module: value.module,
    baseDataSource: value.baseDataSource ?? value.base_data_source,
    description: value.description,
    allowedFilters: value.allowedFilters ?? value.allowed_filters,
    status: value.status,
    category: value.category,
    trackModules: value.trackModules,
    enableUserFilter: value.enableUserFilter,
    enableDateFilter: value.enableDateFilter,
    trackActivityTypes: value.trackActivityTypes,
    allowExport: value.allowExport,
    showSummary: value.showSummary,
    showDetailedLogs: value.showDetailedLogs,
  }))
  .refine(
    (value) =>
      value.name !== undefined ||
      value.module !== undefined ||
      value.baseDataSource !== undefined ||
      value.description !== undefined ||
      value.allowedFilters !== undefined ||
      value.status !== undefined ||
      value.category !== undefined ||
      value.trackModules !== undefined ||
      value.enableUserFilter !== undefined ||
      value.enableDateFilter !== undefined ||
      value.trackActivityTypes !== undefined ||
      value.allowExport !== undefined ||
      value.showSummary !== undefined ||
      value.showDetailedLogs !== undefined,
    {
      message: 'At least one field is required for update.',
    },
  );

export const toggleReportTypeStatusSchema = z.object({
  status: reportTypeStatusSchema,
});

export const listReportTypesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(255).optional()),
  status: reportTypeStatusSchema,
  module: z.preprocess(
    emptyStringToUndefined,
    z.preprocess(
      (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
      z.nativeEnum(ReportModule).optional(),
    ),
  ),
});

export type AllowedReportFilterKey = z.infer<typeof allowedFilterKeySchema>;
export type CreateReportTypeInput = z.infer<typeof createReportTypeSchema>;
export type UpdateReportTypeInput = z.infer<typeof updateReportTypeSchema>;
export type ToggleReportTypeStatusInput = z.infer<typeof toggleReportTypeStatusSchema>;
export type ListReportTypesQueryInput = z.infer<typeof listReportTypesQuerySchema>;
export type ReportTypeIdParamInput = z.infer<typeof reportTypeIdParamSchema>;
