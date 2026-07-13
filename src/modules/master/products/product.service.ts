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
  description: product.description,
  unitPrice: product.unitPrice,
  status: product.status,
  createdById: product.createdById,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

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

  const created = await productDelegate.create({
    data: {
      workspaceId,
      name,
      code: input.code?.trim() || null,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      unitPrice: input.unitPrice,
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

  const updated = await productDelegate.update({
    where: { id },
    data: {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice } : {}),
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
