import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`);

const optionalId = (label: string) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`).optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean().optional());

export const countryIdParamSchema = z.object({
  id: requiredId('id'),
});

export const locationIdParamSchema = z.object({
  id: requiredId('id'),
});

export const createCountrySchema = z.object({
  name: z.string().trim().min(1, 'Country name is required').max(100, 'Country name is too long'),
  code: z.preprocess(emptyStringToUndefined, z.string().trim().max(10, 'Country code is too long').optional()),
  isActive: optionalBoolean,
});

export const updateCountrySchema = z
  .object({
    name: z.string().trim().min(1, 'Country name is required').max(100, 'Country name is too long').optional(),
    code: z.preprocess(emptyStringToUndefined, z.string().trim().max(10, 'Country code is too long').optional()),
    isActive: optionalBoolean,
  })
  .refine((value) => value.name !== undefined || value.code !== undefined || value.isActive !== undefined, {
    message: 'At least one country field is required for update.',
  });

export const configureLocationLevelsSchema = z.object({
  countryId: z.union([requiredId('countryId'), z.preprocess(emptyStringToUndefined, requiredId('country_id')).optional()]).optional(),
  country_id: optionalId('country_id'),
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Level name is required').max(100, 'Level name is too long'),
        order: z.coerce.number().int().min(1, 'Level order must be at least 1').max(10, 'Maximum 10 levels supported'),
        isActive: optionalBoolean,
      }),
    )
    .min(1, 'At least one location level is required')
    .max(10, 'Maximum 10 levels supported'),
}).transform((value) => ({
  countryId: value.countryId ?? value.country_id!,
  levels: value.levels,
}));

export const createLocationSchema = z.object({
  countryId: z.union([requiredId('countryId'), z.preprocess(emptyStringToUndefined, requiredId('country_id')).optional()]).optional(),
  country_id: optionalId('country_id'),
  levelId: z.union([requiredId('levelId'), z.preprocess(emptyStringToUndefined, requiredId('level_id')).optional()]).optional(),
  level_id: optionalId('level_id'),
  parentId: z.union([optionalId('parentId'), z.preprocess(emptyStringToUndefined, requiredId('parent_id')).optional()]).optional(),
  parent_id: optionalId('parent_id'),
  name: z.string().trim().min(1, 'Location name is required').max(150, 'Location name is too long'),
  isActive: optionalBoolean,
}).transform((value) => ({
  countryId: value.countryId ?? value.country_id!,
  levelId: value.levelId ?? value.level_id!,
  parentId: value.parentId ?? value.parent_id,
  name: value.name,
  isActive: value.isActive,
}));

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1, 'Location name is required').max(150, 'Location name is too long').optional(),
    parentId: z.union([optionalId('parentId'), z.preprocess(emptyStringToUndefined, requiredId('parent_id')).optional()]).optional(),
    parent_id: optionalId('parent_id'),
    isActive: optionalBoolean,
  })
  .transform((value) => ({
    name: value.name,
    parentId: value.parentId ?? value.parent_id,
    isActive: value.isActive,
  }))
  .refine((value) => value.name !== undefined || value.parentId !== undefined || value.isActive !== undefined, {
    message: 'At least one location field is required for update.',
  });

export const listCountriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(100).optional()),
  isActive: optionalBoolean,
});

export const listLocationLevelsQuerySchema = z.object({
  countryId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  country_id: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
}).transform((value) => ({
  countryId: value.countryId ?? value.country_id,
}));

export const listLocationsQuerySchema = z.object({
  countryId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  country_id: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  parentId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  parent_id: z.preprocess(emptyStringToUndefined, z.string().trim().optional()),
  levelOrder: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(10).optional(),
  ),
  level_order: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(10).optional(),
  ),
}).transform((value) => ({
  countryId: value.countryId ?? value.country_id,
  parentId: value.parentId ?? value.parent_id,
  levelOrder: value.levelOrder ?? value.level_order,
}));

export const locationTreeQuerySchema = z.object({
  countryId: z.union([requiredId('countryId'), z.preprocess(emptyStringToUndefined, requiredId('country_id')).optional()]).optional(),
  country_id: optionalId('country_id'),
}).transform((value) => ({
  countryId: value.countryId ?? value.country_id!,
}));

export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type ConfigureLocationLevelsInput = z.infer<typeof configureLocationLevelsSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ListCountriesQueryInput = z.infer<typeof listCountriesQuerySchema>;
export type ListLocationLevelsQueryInput = z.infer<typeof listLocationLevelsQuerySchema>;
export type ListLocationsQueryInput = z.infer<typeof listLocationsQuerySchema>;
export type LocationTreeQueryInput = z.infer<typeof locationTreeQuerySchema>;
export type CountryIdParamInput = z.infer<typeof countryIdParamSchema>;
export type LocationIdParamInput = z.infer<typeof locationIdParamSchema>;
