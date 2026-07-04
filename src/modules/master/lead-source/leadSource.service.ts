import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import { ListLeadSourcesResponse, LeadSourceResponse } from './leadSource.types';
import { CreateLeadSourceInput, ListLeadSourcesQuery, UpdateLeadSourceInput } from './leadSource.validator';

const ACTIVE_CACHE_TTL_SECONDS = 300;
const getCacheKey = (workspaceId: string): string => `lead_sources:active:${workspaceId}`;
const leadSourceDelegate = (prisma as any).leadSource;
let leadSourceSchemaCheckedAt: number | null = null;
const LEAD_SOURCE_SCHEMA_CHECK_TTL_MS = 60_000;

const requireWorkspaceId = (workspaceId: string): string => {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!ws) {
    const error: any = new Error('Workspace context is required.');
    error.statusCode = 403;
    throw error;
  }
  return ws;
};

const clearActiveLeadSourcesCache = async (workspaceId: string): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(getCacheKey(workspaceId));
  }
};

const ensureLeadSourceSchemaReady = async (): Promise<void> => {
  const now = Date.now();
  if (leadSourceSchemaCheckedAt && now - leadSourceSchemaCheckedAt < LEAD_SOURCE_SCHEMA_CHECK_TTL_MS) {
    return;
  }

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'lead_sources'
  `;

  if (!tableRows[0]?.table_name) {
    const error: any = new Error(
      'Lead Source module is not ready. Database table "lead_sources" is missing. Run Prisma migration/db push.',
    );
    error.statusCode = 503;
    throw error;
  }

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'lead_sources'
  `;

  const columnSet = new Set(columnRows.map((row) => row.column_name));
  if (!columnSet.has('workspaceId')) {
    const error: any = new Error(
      'Lead Source module schema is outdated in the database. Run Prisma migration/db push so workspace-scoped master data can be used.',
    );
    error.statusCode = 503;
    throw error;
  }

  leadSourceSchemaCheckedAt = now;
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
    return await leadDelegate.count({ where: { sourceId: leadSourceId } });
  }

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;
  const hasLeadsTable = Boolean(tableRows[0]?.table_name);
  if (!hasLeadsTable) return 0;

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'leads'
  `;

  const hasCamelColumn = columnRows.some((column) => column.column_name === 'leadSourceId');
  const hasSnakeColumn = columnRows.some((column) => column.column_name === 'lead_source_id');

  if (!hasCamelColumn && !hasSnakeColumn) return 0;

  const filterColumn = hasCamelColumn ? 'leadSourceId' : 'lead_source_id';
  const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM leads WHERE ${filterColumn} = ?`,
    leadSourceId,
  );

  return parseCount(result[0]?.count);
};

export const createLeadSource = async (
  workspaceId: string,
  input: CreateLeadSourceInput,
  createdBy?: string,
): Promise<LeadSourceResponse> => {
  const ws = requireWorkspaceId(workspaceId);
  await ensureLeadSourceSchemaReady();
  const existing = await leadSourceDelegate.findFirst({
    where: {
      workspaceId: ws,
      name: { equals: input.name},
    },
  });

  if (existing && !existing.deletedAt) {
    const error: any = new Error(`Lead source "${input.name}" already exists.`);
    error.statusCode = 409;
    throw error;
  }

  if (existing && existing.deletedAt) {
    const restored = await leadSourceDelegate.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        deletedAt: null,
        createdBy: createdBy ?? existing.createdBy,
        workspaceId: ws,
      },
    });
    await clearActiveLeadSourcesCache(ws);
    const [mapped] = await mapCreatorNames([restored]);
    return mapped as LeadSourceResponse;
  }

  const created = await leadSourceDelegate.create({
    data: {
      workspaceId: ws,
      name: input.name,
      status: input.status,
      createdBy,
    },
  });

  await clearActiveLeadSourcesCache(ws);
  const [mapped] = await mapCreatorNames([created]);
  return mapped as LeadSourceResponse;
};

export const listLeadSources = async (
  workspaceId: string,
  query: ListLeadSourcesQuery,
): Promise<ListLeadSourcesResponse> => {
  await ensureLeadSourceSchemaReady();
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    deletedAt: null,
    ...(search
      ? {
          name: { contains: search},
        }
      : {}),
    ...(status ? { status } : {}),
  };

  const [total, records] = await prisma.$transaction([
    leadSourceDelegate.count({ where }),
    leadSourceDelegate.findMany({
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

  const mappedRecords = (await mapCreatorNames(records)) as LeadSourceResponse[];

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

export const getActiveLeadSources = async (workspaceId: string): Promise<LeadSourceResponse[]> => {
  await ensureLeadSourceSchemaReady();
  if (redisClient.isOpen) {
    const cached = await redisClient.get(getCacheKey(workspaceId));
    if (cached) {
      return JSON.parse(cached) as LeadSourceResponse[];
    }
  }

  const records = await leadSourceDelegate.findMany({
    where: {
      workspaceId,
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

  const mappedRecords = (await mapCreatorNames(records)) as LeadSourceResponse[];

  if (redisClient.isOpen) {
    await redisClient.setEx(getCacheKey(workspaceId), ACTIVE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const resolveOrCreateLeadSourceByName = async (
  workspaceId: string,
  name: string,
  createdBy?: string,
): Promise<LeadSourceResponse> => {
  const ws = requireWorkspaceId(workspaceId);
  await ensureLeadSourceSchemaReady();
  const normalizedName = normalizeLeadSourceName(name);
  if (!normalizedName) {
    const error: any = new Error('Lead source name is required.');
    error.statusCode = 422;
    throw error;
  }

  const existing = await leadSourceDelegate.findFirst({
    where: {
      workspaceId: ws,
      name: {
        equals: normalizedName,
      },
    },
  });

  if (existing) {
    if (existing.deletedAt || existing.status !== 'ACTIVE') {
      const restored = await leadSourceDelegate.update({
        where: { id: existing.id },
        data: {
          name: normalizedName,
          workspaceId: ws,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      await clearActiveLeadSourcesCache(ws);
      const [mapped] = await mapCreatorNames([restored]);
      return mapped as LeadSourceResponse;
    }

    const [mapped] = await mapCreatorNames([existing]);
    return mapped as LeadSourceResponse;
  }

  const created = await leadSourceDelegate.create({
    data: {
      workspaceId: ws,
      name: normalizedName,
      status: 'ACTIVE',
      createdBy,
    },
  });

  await clearActiveLeadSourcesCache(ws);
  const [mapped] = await mapCreatorNames([created]);
  return mapped as LeadSourceResponse;
};

export const updateLeadSource = async (
  workspaceId: string,
  id: string,
  input: UpdateLeadSourceInput,
): Promise<LeadSourceResponse> => {
  await ensureLeadSourceSchemaReady();
  const existing = await leadSourceDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead source not found.');
    error.statusCode = 404;
    throw error;
  }

  if (input.name && input.name !== existing.name) {
    const nameTaken = await leadSourceDelegate.findFirst({
      where: {
        workspaceId,
        name: { equals: input.name},
      },
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

  const updated = await leadSourceDelegate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await clearActiveLeadSourcesCache(workspaceId);
  const [mapped] = await mapCreatorNames([updated]);
  return mapped as LeadSourceResponse;
};

export const toggleLeadSourceStatus = async (workspaceId: string, id: string): Promise<LeadSourceResponse> => {
  await ensureLeadSourceSchemaReady();
  const existing = await leadSourceDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });

  if (!existing) {
    const error: any = new Error('Lead source not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const updated = await leadSourceDelegate.update({
    where: { id },
    data: { status: nextStatus },
  });

  await clearActiveLeadSourcesCache(workspaceId);
  const [mapped] = await mapCreatorNames([updated]);
  return mapped as LeadSourceResponse;
};

export const deleteLeadSource = async (workspaceId: string, id: string): Promise<void> => {
  await ensureLeadSourceSchemaReady();
  const existing = await leadSourceDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
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

  await leadSourceDelegate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await clearActiveLeadSourcesCache(workspaceId);
};

