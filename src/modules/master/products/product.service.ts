import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './product.validator';

const ACTIVE_CACHE_TTL_SECONDS = 300;
const PRODUCT_SCHEMA_CHECK_TTL_MS = 60_000;
let productSchemaCheckedAt: number | null = null;

const productDelegate = (prisma as any).product;

const getActiveCacheKey = (workspaceId: string) => `products:active:${workspaceId}`;

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const clearActiveProductsCache = async (workspaceId: string) => {
  if (redisClient.isOpen) {
    await redisClient.del(getActiveCacheKey(workspaceId));
  }
};

export const ensureProductSchemaReady = async (): Promise<void> => {
  const now = Date.now();
  if (productSchemaCheckedAt && now - productSchemaCheckedAt < PRODUCT_SCHEMA_CHECK_TTL_MS) return;

  const tables = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('products', 'lead_products')
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  if (!tableNames.has('products') || !tableNames.has('lead_products')) {
    throw createServiceError(
      'Product Management module is not ready. Run Prisma migration/db push so product tables are available.',
      503,
    );
  }

  productSchemaCheckedAt = now;
};

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');

const mapProduct = (product: any) => ({
  id: product.id,
  name: product.name,
  code: product.code,
  category: product.category,
  categories: Array.isArray(product.categories) && product.categories.length > 0
    ? product.categories
    : (product.category ? [product.category] : []),
  types: Array.isArray(product.types) ? product.types : [],
  typeOptions: Array.isArray(product.typeOptions)
    ? product.typeOptions.map((t: any) => ({
        id: t.id,
        name: t.name,
        unitPrice: t.unitPrice,
        status: t.status,
        isDefault: t.isDefault,
        categories: Array.isArray(t.categories) ? t.categories : [],
      }))
    : [],
  description: product.description,
  unitPrice: product.unitPrice,
  status: product.status,
  createdById: product.createdById,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

const sanitizeTypeOptions = (
  rawOptions?: Array<{
    id?: string;
    name: string;
    unitPrice: number;
    status?: string;
    isDefault?: boolean;
    categories?: string[];
  }>,
  rawTypes?: string[],
  fallbackUnitPrice: number = 0,
) => {
  if (!rawOptions || rawOptions.length === 0) {
    if (Array.isArray(rawTypes) && rawTypes.length > 0) {
      const uniqueNames = Array.from(new Set(rawTypes.map((t) => t.trim()).filter(Boolean)));
      const options = uniqueNames.map((name, idx) => ({
        id: randomUUID(),
        name,
        unitPrice: Math.max(0, fallbackUnitPrice),
        status: 'ACTIVE' as const,
        isDefault: idx === 0,
        categories: [] as string[],
      }));
      return {
        typeOptions: options,
        types: uniqueNames,
        baselineUnitPrice: options.length > 0 ? options[0].unitPrice : fallbackUnitPrice,
        allTypeCategories: [] as string[],
      };
    }
    return {
      typeOptions: [],
      types: [],
      baselineUnitPrice: fallbackUnitPrice,
      allTypeCategories: [] as string[],
    };
  }

  const seenNames = new Set<string>();
  const sanitized = rawOptions
    .map((item) => {
      const name = item.name ? item.name.trim().replace(/\s+/g, ' ') : '';
      if (!name) return null;
      const lower = name.toLowerCase();
      if (seenNames.has(lower)) {
        throw createServiceError(`Duplicate type name "${name}". Each type must have a unique name.`, 400);
      }
      seenNames.add(lower);

      const price = Math.max(0, Number(item.unitPrice) || 0);
      const rawCats = Array.isArray(item.categories) ? item.categories : [];
      const categories = Array.from(
        new Set(
          rawCats
            .map((c) => (typeof c === 'string' ? c.trim().replace(/\s+/g, ' ') : ''))
            .filter(Boolean),
        ),
      );

      return {
        id: item.id && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : randomUUID(),
        name,
        unitPrice: price,
        status: item.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        isDefault: Boolean(item.isDefault),
        categories,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      name: string;
      unitPrice: number;
      status: 'ACTIVE' | 'INACTIVE';
      isDefault: boolean;
      categories: string[];
    }>;

  if (sanitized.length > 0) {
    const defaultIndex = sanitized.findIndex((t) => t.isDefault);
    if (defaultIndex === -1) {
      sanitized[0].isDefault = true;
    } else {
      sanitized.forEach((t, i) => {
        t.isDefault = i === defaultIndex;
      });
    }
  }

  const types = sanitized.map((t) => t.name);
  const defaultOption = sanitized.find((t) => t.isDefault) || sanitized[0];
  const baselineUnitPrice = defaultOption ? defaultOption.unitPrice : fallbackUnitPrice;
  const allTypeCategories = Array.from(new Set(sanitized.flatMap((t) => t.categories || [])));

  return {
    typeOptions: sanitized,
    types,
    baselineUnitPrice,
    allTypeCategories,
  };
};

const assertUniqueName = async (workspaceId: string, name: string, productId?: string) => {
  const existing = await productDelegate.findFirst({
    where: {
      workspaceId,
      name: { equals: name },
    },
    select: { id: true, deletedAt: true },
  });

  if (existing && existing.id !== productId && !existing.deletedAt) {
    throw createServiceError(`Product "${name}" already exists.`, 409);
  }
  if (existing && existing.id !== productId && existing.deletedAt) {
    throw createServiceError(`Product "${name}" already exists in archived records.`, 409);
  }
};

export const createProduct = async (workspaceId: string, input: CreateProductInput, createdById?: string) => {
  await ensureProductSchemaReady();
  const name = normalizeName(input.name);
  await assertUniqueName(workspaceId, name);

  const { typeOptions, types, baselineUnitPrice, allTypeCategories } = sanitizeTypeOptions(
    input.typeOptions,
    input.types,
    input.unitPrice !== undefined ? Math.max(0, Number(input.unitPrice)) : 0,
  );

  const rawCategories = Array.isArray(input.categories) ? input.categories : [];
  const combinedCategories = [
    ...allTypeCategories,
    ...rawCategories,
    ...(input.category?.trim() ? [input.category.trim()] : []),
  ];
  const sanitizedCategories = Array.from(new Set(combinedCategories.map((c) => c.trim()).filter(Boolean)));
  const primaryCategory = sanitizedCategories[0] || input.category?.trim() || null;

  const created = await productDelegate.create({
    data: {
      workspaceId,
      name,
      code: input.code?.trim() || null,
      category: primaryCategory,
      categories: sanitizedCategories,
      types,
      typeOptions,
      description: input.description?.trim() || null,
      unitPrice: baselineUnitPrice,
      status: input.status,
      createdById,
    },
  });

  await clearActiveProductsCache(workspaceId);
  return mapProduct(created);
};

export const listProducts = async (workspaceId: string, query: ListProductsQuery) => {
  await ensureProductSchemaReady();
  const skip = (query.page - 1) * query.limit;
  const where: Prisma.ProductWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
          { category: { contains: query.search, mode: 'insensitive' } },
          { types: { has: query.search } },
          { categories: { has: query.search } },
        ],
      }
      : {}),
  };

  const [total, records] = await prisma.$transaction([
    productDelegate.count({ where }),
    productDelegate.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    }),
  ]);

  return {
    data: records.map(mapProduct),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const getActiveProducts = async (workspaceId: string) => {
  await ensureProductSchemaReady();
  if (redisClient.isOpen) {
    const cached = await redisClient.get(getActiveCacheKey(workspaceId));
    if (cached) return JSON.parse(cached);
  }

  const records = await productDelegate.findMany({
    where: {
      workspaceId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    orderBy: { name: 'asc' },
  });
  const data = records.map(mapProduct);

  if (redisClient.isOpen) {
    await redisClient.setEx(getActiveCacheKey(workspaceId), ACTIVE_CACHE_TTL_SECONDS, JSON.stringify(data));
  }

  return data;
};

export const updateProduct = async (workspaceId: string, id: string, input: UpdateProductInput) => {
  await ensureProductSchemaReady();
  const existing = await productDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) throw createServiceError('Product not found.', 404);

  const nextName = input.name !== undefined ? normalizeName(input.name) : undefined;
  if (nextName && nextName !== existing.name) {
    await assertUniqueName(workspaceId, nextName, id);
  }

  let typeDataToUpdate: {
    types?: string[];
    typeOptions?: any;
    unitPrice?: number;
  } = {};
  let allTypeCategories: string[] = [];

  if (input.typeOptions !== undefined) {
    const { typeOptions, types, baselineUnitPrice, allTypeCategories: extractedCats } = sanitizeTypeOptions(
      input.typeOptions,
      input.types,
      input.unitPrice !== undefined ? Math.max(0, Number(input.unitPrice)) : Number(existing.unitPrice || 0),
    );
    typeDataToUpdate = {
      typeOptions,
      types,
      unitPrice: baselineUnitPrice,
    };
    allTypeCategories = extractedCats;
  } else if (input.types !== undefined) {
    const { typeOptions, types, baselineUnitPrice, allTypeCategories: extractedCats } = sanitizeTypeOptions(
      undefined,
      input.types,
      input.unitPrice !== undefined ? Math.max(0, Number(input.unitPrice)) : Number(existing.unitPrice || 0),
    );
    typeDataToUpdate = {
      typeOptions,
      types,
      unitPrice: baselineUnitPrice,
    };
    allTypeCategories = extractedCats;
  } else if (input.unitPrice !== undefined) {
    typeDataToUpdate.unitPrice = Math.max(0, Number(input.unitPrice));
  }

  let nextCategories: string[] | undefined = undefined;
  if (input.categories !== undefined) {
    nextCategories = Array.from(new Set(input.categories.map((c) => c.trim()).filter(Boolean)));
  } else if (input.category !== undefined) {
    nextCategories = input.category?.trim() ? [input.category.trim()] : [];
  } else if (input.typeOptions !== undefined && allTypeCategories.length > 0) {
    const existingCats = Array.isArray(existing.categories) ? existing.categories : [];
    nextCategories = Array.from(new Set([...existingCats, ...allTypeCategories]));
  }

  const nextCategory = nextCategories !== undefined
    ? (nextCategories[0] || null)
    : (input.category !== undefined ? (input.category?.trim() || null) : undefined);

  const updated = await productDelegate.update({
    where: { id },
    data: {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
      ...(nextCategory !== undefined ? { category: nextCategory } : {}),
      ...(nextCategories !== undefined ? { categories: nextCategories } : {}),
      ...typeDataToUpdate,
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await clearActiveProductsCache(workspaceId);
  return mapProduct(updated);
};

export const toggleProductStatus = async (workspaceId: string, id: string) => {
  await ensureProductSchemaReady();
  const existing = await productDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) throw createServiceError('Product not found.', 404);

  const updated = await productDelegate.update({
    where: { id },
    data: { status: existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
  });

  await clearActiveProductsCache(workspaceId);
  return mapProduct(updated);
};

export const deleteProduct = async (workspaceId: string, id: string) => {
  await ensureProductSchemaReady();
  const existing = await productDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw createServiceError('Product not found.', 404);

  const usedCount = await (prisma as any).leadProduct.count({
    where: { workspaceId, productId: id },
  });
  if (usedCount > 0) {
    throw createServiceError(
      'This product is already used by existing leads and cannot be deleted. Please deactivate it instead.',
      400,
    );
  }

  await productDelegate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await clearActiveProductsCache(workspaceId);
};
