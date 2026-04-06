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
export type ListReportLogsQueryInput = z.infer<typeof listReportLogsQuerySchema>;
