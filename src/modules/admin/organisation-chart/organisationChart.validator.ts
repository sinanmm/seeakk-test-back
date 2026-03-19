import { z } from 'zod';

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const organisationChartQuerySchema = z.object({
  includeInactive: z.preprocess((value) => toBoolean(value), z.boolean().default(false)),
});

export type OrganisationChartQuery = z.infer<typeof organisationChartQuerySchema>;

