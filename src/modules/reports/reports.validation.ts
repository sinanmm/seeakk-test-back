import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const normalizeFilterKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^source$/, 'lead_source');

const parseDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

const reportFilterSchema = z
  .object({
    key: z.string().trim().min(1, 'Filter key is required'),
    value: z.unknown(),
  })
  .transform((input, ctx) => {
    const key = normalizeFilterKey(input.key);
    const supportedKeys = new Set([
      'stage',
      'assignee',
      'lead_source',
      'created_date',
      'follow_up_date',
      'role',
      'department',
      'office',
      'status',
    ]);

    if (!supportedKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: `Unsupported filter key '${input.key}'`,
      });
      return z.NEVER;
    }

    if (key === 'created_date' || key === 'follow_up_date') {
      let from: Date | undefined;
      let to: Date | undefined;

      if (Array.isArray(input.value)) {
        from = parseDate(input.value[0]);
        to = parseDate(input.value[1]);
      } else if (input.value && typeof input.value === 'object') {
        const value = input.value as Record<string, unknown>;
        from = parseDate(value.from ?? value.start ?? value.gte);
        to = parseDate(value.to ?? value.end ?? value.lte);
      } else {
        const parsed = parseDate(input.value);
        from = parsed;
        to = parsed;
      }

      if (!from && !to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: `Filter '${key}' requires a valid date or date range`,
        });
        return z.NEVER;
      }

      if (from && to && from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: `'${key}' from date must be before the to date`,
        });
        return z.NEVER;
      }

      return { key, value: { from, to } };
    }

    const values = Array.isArray(input.value) ? input.value : [input.value];
    const normalizedValues = values
      .map((value) => (typeof value === 'string' ? value.trim() : value))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (normalizedValues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `Filter '${key}' requires at least one value`,
      });
      return z.NEVER;
    }

    return { key, value: normalizedValues };
  });

export const generateReportSchema = z.object({
  reportTypeId: z.string().trim().min(1, 'reportTypeId is required').max(191, 'Invalid reportTypeId'),
  filters: z.array(reportFilterSchema).default([]),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const reportIdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required').max(191, 'Invalid id'),
});

export const createReportSchema = z.object({
  report_name: z.string().trim().min(1, 'report_name is required').max(255, 'report_name must not exceed 255 characters').optional(),
  reportName: z.string().trim().min(1, 'reportName is required').max(255, 'reportName must not exceed 255 characters').optional(),
  report_type_id: z.string().trim().min(1, 'report_type_id is required').max(191, 'Invalid report_type_id').optional(),
  reportTypeId: z.string().trim().min(1, 'reportTypeId is required').max(191, 'Invalid reportTypeId').optional(),
  report_date: z.preprocess((value) => parseDate(value), z.date({ message: 'report_date is required' }).optional()),
  reportDate: z.preprocess((value) => parseDate(value), z.date({ message: 'reportDate is required' }).optional()),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  filters: z.array(reportFilterSchema).default([]),
}).superRefine((value, ctx) => {
  if (!value.report_name && !value.reportName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['report_name'], message: 'Report name is required' });
  }
  if (!value.report_type_id && !value.reportTypeId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['report_type_id'], message: 'Report type is required' });
  }
  if (!value.report_date && !value.reportDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['report_date'], message: 'Report date is required' });
  }
}).transform((value) => ({
  reportName: value.reportName ?? value.report_name!,
  reportTypeId: value.reportTypeId ?? value.report_type_id!,
  reportDate: value.reportDate ?? value.report_date!,
  isActive: value.isActive ?? value.is_active ?? true,
  filters: value.filters,
}));

export const updateReportSchema = z.object({
  report_name: z.string().trim().min(1, 'report_name is required').max(255, 'report_name must not exceed 255 characters').optional(),
  reportName: z.string().trim().min(1, 'reportName is required').max(255, 'reportName must not exceed 255 characters').optional(),
  report_type_id: z.string().trim().min(1, 'report_type_id is required').max(191, 'Invalid report_type_id').optional(),
  reportTypeId: z.string().trim().min(1, 'reportTypeId is required').max(191, 'Invalid reportTypeId').optional(),
  report_date: z.preprocess((value) => parseDate(value), z.date().optional()).optional(),
  reportDate: z.preprocess((value) => parseDate(value), z.date().optional()).optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  filters: z.array(reportFilterSchema).optional(),
}).transform((value) => ({
  reportName: value.reportName ?? value.report_name,
  reportTypeId: value.reportTypeId ?? value.report_type_id,
  reportDate: value.reportDate ?? value.report_date,
  isActive: value.isActive ?? value.is_active,
  filters: value.filters,
}));

export const listReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  report_name: z.preprocess(emptyStringToUndefined, z.string().trim().max(255).optional()).optional(),
  reportName: z.preprocess(emptyStringToUndefined, z.string().trim().max(255).optional()).optional(),
  created_by: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()).optional(),
  createdBy: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()).optional(),
  status: z.preprocess(emptyStringToUndefined, z.enum(['completed', 'pending']).optional()),
  is_active: z.preprocess(emptyStringToUndefined, z.enum(['true', 'false']).optional()).optional(),
  isActive: z.preprocess(emptyStringToUndefined, z.enum(['true', 'false']).optional()).optional(),
  report_type: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()).optional(),
  reportTypeId: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()).optional(),
  created_at_from: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  createdAtFrom: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  created_at_to: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  createdAtTo: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  report_date_from: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  reportDateFrom: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  report_date_to: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
  reportDateTo: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()).optional(),
}).transform((value) => ({
  page: value.page,
  limit: value.limit,
  reportName: value.reportName ?? value.report_name,
  createdBy: value.createdBy ?? value.created_by,
  status: value.status,
  isActive: value.isActive ?? value.is_active,
  reportTypeId: value.reportTypeId ?? value.report_type,
  createdAtFrom: value.createdAtFrom ?? value.created_at_from,
  createdAtTo: value.createdAtTo ?? value.created_at_to,
  reportDateFrom: value.reportDateFrom ?? value.report_date_from,
  reportDateTo: value.reportDateTo ?? value.report_date_to,
}));

export const listReportLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  reportTypeId: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()),
  generatedBy: z.preprocess(emptyStringToUndefined, z.string().trim().max(191).optional()),
  dateFrom: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()),
  dateTo: z.preprocess((value) => parseDate(emptyStringToUndefined(value)), z.date().optional()),
});

export type ReportFilterInput = z.infer<typeof reportFilterSchema>;
export type GenerateReportInput = z.infer<typeof generateReportSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type ListReportsQueryInput = z.infer<typeof listReportsQuerySchema>;
export type ListReportLogsQueryInput = z.infer<typeof listReportLogsQuerySchema>;
export type ReportIdParamInput = z.infer<typeof reportIdParamSchema>;
