import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import { ListLeadSourcesResponse, LeadSourceResponse } from './leadSource.types';
import { CreateLeadSourceInput, ListLeadSourcesQuery, UpdateLeadSourceInput } from './leadSource.validator';

const ACTIVE_CACHE_KEY = 'lead_sources:active';
const ACTIVE_CACHE_TTL_SECONDS = 300;

const clearActiveLeadSourcesCache = async (): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(ACTIVE_CACHE_KEY);
  }
};

const normalizeLeadSourceName = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ');

const parseCount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
};

const resolveCreatorDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const mapCreatorNames = async <T extends { createdBy: string | null }>(
  records: T[],
): Promise<Array<Omit<T, 'createdBy'> & { createdBy: string | null; createdById: string | null }>> => {
  const creatorIds = Array.from(
    new Set(
      records
        .map((record) => record.createdBy)
        .filter((value): value is string => Boolean(value && value.trim())),
    ),
  );

  if (creatorIds.length === 0) {
    return records.map((record) => ({
      ...record,
      createdById: record.createdBy,
      createdBy: null,
    }));
  }

  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  });

  const creatorMap = new Map<string, string>();
  creators.forEach((creator) => {
    creatorMap.set(creator.id, resolveCreatorDisplayName(creator));
  });

  return records.map((record) => ({
    ...record,
    createdById: record.createdBy,
    createdBy: record.createdBy ? creatorMap.get(record.createdBy) || record.createdBy : null,
  }));
};

const countLeadUsage = async (leadSourceId: string): Promise<number> => {
  const leadDelegate = (prisma as any).lead;
  if (leadDelegate?.count) {
    return await leadDelegate.count({ where: { leadSourceId } });
  }

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.leads')::text AS table_name
  `;
  const hasLeadsTable = Boolean(tableRows[0]?.table_name);
  if (!hasLeadsTable) return 0;

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
  `;

  const hasCamelColumn = columnRows.some((column) => column.column_name === 'leadSourceId');
  const hasSnakeColumn = columnRows.some((column) => column.column_name === 'lead_source_id');

  if (!hasCamelColumn && !hasSnakeColumn) return 0;

  const filterColumn = hasCamelColumn ? '"leadSourceId"' : '"lead_source_id"';
  const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "leads" WHERE ${filterColumn} = $1`,
    leadSourceId,
  );

  return parseCount(result[0]?.count);
};

export const createLeadSource = async (
  input: CreateLeadSourceInput,
  createdBy?: string,
): Promise<LeadSourceResponse> => {
  const existing = await prisma.leadSource.findUnique({
    where: { name: input.name },
  });

  if (existing && !existing.deletedAt) {
    const error: any = new Error(`Lead source "${input.name}" already exists.`);
    error.statusCode = 409;
    throw error;
  }

  if (existing && existing.deletedAt) {
    const restored = await prisma.leadSource.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        deletedAt: null,
        createdBy: createdBy ?? existing.createdBy,
      },
    });
    await clearActiveLeadSourcesCache();
    const [mapped] = await mapCreatorNames([restored]);
    return mapped;
  }

  const created = await prisma.leadSource.create({
    data: {
      name: input.name,
      status: input.status,
      createdBy,
    },
  });

  await clearActiveLeadSourcesCache();
  const [mapped] = await mapCreatorNames([created]);
  return mapped;
};

export const listLeadSources = async (query: ListLeadSourcesQuery): Promise<ListLeadSourcesResponse> => {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive' as const },
        }
      : {}),
    ...(status ? { status } : {}),
  };

  const [total, records] = await prisma.$transaction([
    prisma.leadSource.count({ where }),
    prisma.leadSource.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
  ]);

  const mappedRecords = await mapCreatorNames(records);

  return {
    data: mappedRecords,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getActiveLeadSources = async (): Promise<LeadSourceResponse[]> => {
  if (redisClient.isOpen) {
    const cached = await redisClient.get(ACTIVE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as LeadSourceResponse[];
    }
  }

  const records = await prisma.leadSource.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  const mappedRecords = await mapCreatorNames(records);

  if (redisClient.isOpen) {
    await redisClient.setEx(ACTIVE_CACHE_KEY, ACTIVE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const resolveOrCreateLeadSourceByName = async (
  name: string,
  createdBy?: string,
): Promise<LeadSourceResponse> => {
  const normalizedName = normalizeLeadSourceName(name);
  if (!normalizedName) {
    const error: any = new Error('Lead source name is required.');
    error.statusCode = 422;
    throw error;
  }

  const existing = await prisma.leadSource.findFirst({
    where: {
      name: {
        equals: normalizedName,
        mode: 'insensitive',
      },
    },
  });

  if (existing) {
    if (existing.deletedAt || existing.status !== 'ACTIVE') {
      const restored = await prisma.leadSource.update({
        where: { id: existing.id },
        data: {
          name: normalizedName,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      await clearActiveLeadSourcesCache();
      const [mapped] = await mapCreatorNames([restored]);
      return mapped;
    }

    const [mapped] = await mapCreatorNames([existing]);
    return mapped;
  }

  const created = await prisma.leadSource.create({
    data: {
      name: normalizedName,
      status: 'ACTIVE',
      createdBy,
    },
  });

  await clearActiveLeadSourcesCache();
  const [mapped] = await mapCreatorNames([created]);
  return mapped;
};

export const updateLeadSource = async (id: string, input: UpdateLeadSourceInput): Promise<LeadSourceResponse> => {
  const existing = await prisma.leadSource.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead source not found.');
    error.statusCode = 404;
    throw error;
  }

  if (input.name && input.name !== existing.name) {
    const nameTaken = await prisma.leadSource.findUnique({
      where: { name: input.name },
    });

    if (nameTaken && nameTaken.id !== id && !nameTaken.deletedAt) {
      const error: any = new Error(`Lead source "${input.name}" already exists.`);
      error.statusCode = 409;
      throw error;
    }

    if (nameTaken && nameTaken.id !== id && nameTaken.deletedAt) {
      const error: any = new Error(`Lead source "${input.name}" already exists in archived records.`);
      error.statusCode = 409;
      throw error;
    }
  }

  const updated = await prisma.leadSource.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await clearActiveLeadSourcesCache();
  const [mapped] = await mapCreatorNames([updated]);
  return mapped;
};

export const toggleLeadSourceStatus = async (id: string): Promise<LeadSourceResponse> => {
  const existing = await prisma.leadSource.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead source not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const updated = await prisma.leadSource.update({
    where: { id },
    data: { status: nextStatus },
  });

  await clearActiveLeadSourcesCache();
  const [mapped] = await mapCreatorNames([updated]);
  return mapped;
};

export const deleteLeadSource = async (id: string): Promise<void> => {
  const existing = await prisma.leadSource.findFirst({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead source not found.');
    error.statusCode = 404;
    throw error;
  }

  const usedInLeads = await countLeadUsage(id);
  if (usedInLeads > 0) {
    const error: any = new Error('Lead Source is in use and cannot be deleted.');
    error.statusCode = 400;
    throw error;
  }

  await prisma.leadSource.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await clearActiveLeadSourcesCache();
};
