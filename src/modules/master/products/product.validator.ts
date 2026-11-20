import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const productNameSchema = z.string().trim().min(1, 'Product name is required').max(160, 'Product name is too long');
const optionalTextSchema = (label: string, max = 255) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(max, `${label} is too long`).optional());

const stringListSchema = (label: string, maxItemLength = 120) =>
  z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (Array.isArray(val)) {
        return val
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0);
      }
      if (typeof val === 'string' && val.trim().length > 0) {
        return [val.trim()];
      }
      return [];
    },
    z.array(z.string().max(maxItemLength, `${label} value is too long`)).optional(),
  );

export const productStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const productTypeOptionSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Type name is required').max(120, 'Type name is too long'),
  unitPrice: z.coerce
    .number({ message: 'Unit price must be a valid number' })
    .nonnegative('Unit price must be non-negative'),
  status: productStatusSchema.default('ACTIVE'),
  isDefault: z.coerce.boolean().default(false),
});

export type ProductTypeOption = z.infer<typeof productTypeOptionSchema>;

const unitPriceSchema = z.coerce
  .number({ message: 'Unit price must be a valid number' })
  .nonnegative('Unit price must be non-negative');

export const createProductSchema = z.object({
  name: productNameSchema,
  code: optionalTextSchema('Product code', 80),
  category: optionalTextSchema('Category', 120),
  categories: stringListSchema('Category').default([]),
  types: stringListSchema('Type').default([]),
  typeOptions: z.array(productTypeOptionSchema).optional().default([]),
  description: optionalTextSchema('Description', 1000),
  unitPrice: unitPriceSchema.optional().default(0),
  status: productStatusSchema.default('ACTIVE'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required for update.' },
);

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? parseInt(value, 10) : 1;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? parseInt(value, 10) : 10;
      if (!Number.isFinite(parsed) || parsed < 1) return 10;
      return Math.min(parsed, 100);
    }),
  search: z.string().trim().optional().default(''),
  status: productStatusSchema.optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
