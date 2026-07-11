import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
};

const optionalId = (label: string) =>
  z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1, `${label} is required`).optional(),
  );

const optionalDateString = (label: string) =>
  z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(new Date(value).getTime()), `${label} must be a valid date`)
      .optional(),
  );

const paginationNumber = (fallback: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    },
    z.number().int().positive(),
  );

export const lobAnalysisQuerySchema = z.object({
  date_from: optionalDateString('date_from'),
  date_to: optionalDateString('date_to'),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(160, 'search is too long').optional()),
  stage: optionalId('stage'),
  reason_id: optionalId('reason_id'),
  user_id: optionalId('user_id'),
  location_id: optionalId('location_id'),
});

export const lobAnalysisAuditQuerySchema = lobAnalysisQuerySchema.extend({
  page: paginationNumber(1),
  limit: paginationNumber(20).transform((value) => Math.min(value, 100)),
});

export type LOBAnalysisQueryInput = z.infer<typeof lobAnalysisQuerySchema>;
export type LOBAnalysisAuditQueryInput = z.infer<typeof lobAnalysisAuditQuerySchema>;
