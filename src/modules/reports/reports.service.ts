import { Prisma, ReportBaseDataSource, ReportTypeStatus } from '@prisma/client';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import auditService from '../../services/Audit/auditService';
import { resolveVisibleLeadUserScope } from '../leads/leads.service';
import * as reportTypesRepository from './reportTypes.repository';
import * as reportsRepository from './reports.repository';
import type {
  CreateReportInput,
  GenerateReportInput,
  ListReportLogsQueryInput,
  ListReportsQueryInput,
  ReportFilterInput,
  UpdateReportInput,
} from './reports.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type DateRange = {
  from?: Date;
  to?: Date;
};

type RangeFilterKey = 'created_date' | 'follow_up_date';
type ScalarFilterKey = 'stage' | 'assignee' | 'lead_source' | 'role' | 'department' | 'office' | 'status' | 'user' | 'module' | 'action';

type ScalarFilter = {
  key: ScalarFilterKey;
  value: string[];
};

type RangeFilter = {
  key: RangeFilterKey;
  value: DateRange;
};

type NormalizedFilter = ScalarFilter | RangeFilter;

type ReportExecutionResult = {
  reportType: ReturnType<typeof mapReportType>;
  rows: Record<string, unknown>[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string | null => {
  if (!user) return null;
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return user.username.trim();
  return user.email || null;
};

const toIsoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const toDateOnly = (value: unknown): string | null => {
  const iso = toIsoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await reportTypesRepository.ensureReportSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Report module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const ensureReportInstanceReady = async (): Promise<void> => {
  const ready = await reportsRepository.ensureReportInstanceSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Saved reports module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const FILTERS_BY_SOURCE: Record<string, string[]> = {
  LEADS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date'],
  USERS: ['created_date', 'role', 'department', 'office', 'status'],
  FOLLOWUPS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date', 'status'],
  ACTIVITY: ['created_date', 'user', 'module', 'action'],
};

const parseJsonStringArray = (value: unknown, fallback: string[]): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return fallback;
};

const resolveBaseDataSources = (reportType: { baseDataSource: ReportBaseDataSource; baseDataSources?: unknown }): ReportBaseDataSource[] => {
  const fromJson = parseJsonStringArray(reportType.baseDataSources, []);
  if (fromJson.length > 0) {
    return fromJson as ReportBaseDataSource[];
  }
  return [reportType.baseDataSource];
};

const unionSupportedFilterKeys = (dataSources: ReportBaseDataSource[]): Set<string> => {
  const keys = new Set<string>();
  for (const ds of dataSources) {
    for (const key of FILTERS_BY_SOURCE[ds] || []) {
      keys.add(key);
    }
  }
  return keys;
};

const normalizeFilters = (filters: ReportFilterInput[]): NormalizedFilter[] =>
  filters.map((filter) => filter as NormalizedFilter);

const serializeFiltersForStorage = (filters: NormalizedFilter[]) =>
  filters.map((filter) => ({
    filterKey: filter.key,
    filterValue: JSON.stringify(filter.value),
  }));

const parseStoredFilters = (filters: Array<{ filterKey: string; filterValue: string }>): NormalizedFilter[] =>
  filters.reduce<NormalizedFilter[]>((acc, filter) => {
    try {
      const parsed = JSON.parse(filter.filterValue);

      if (filter.filterKey === 'created_date' || filter.filterKey === 'follow_up_date') {
        const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        acc.push({
          key: filter.filterKey as RangeFilterKey,
          value: {
            from: value.from ? new Date(String(value.from)) : undefined,
            to: value.to ? new Date(String(value.to)) : undefined,
          },
        });
        return acc;
      }

      const values = Array.isArray(parsed) ? parsed : [parsed];
      acc.push({
        key: filter.filterKey as ScalarFilterKey,
        value: values
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
          .filter((entry) => entry.length > 0),
      });
    } catch {
      if (filter.filterKey === 'created_date' || filter.filterKey === 'follow_up_date') {
        acc.push({
          key: filter.filterKey as RangeFilterKey,
          value: {
            from: new Date(filter.filterValue),
            to: new Date(filter.filterValue),
          },
        });
      } else if (filter.filterValue.trim()) {
        acc.push({
          key: filter.filterKey as ScalarFilterKey,
          value: [filter.filterValue.trim()],
        });
      }
    }

    return acc;
  }, []);

/**
 * Validates saved-report or execution filters.
 * For create/update saved reports, pass all report type base data sources (union), because
 * `baseDataSource` is only the legacy primary column while `baseDataSources` may list LEADS + USERS etc.
 * For a single execution pass (runReportType with override), pass a one-element array.
 */
const assertReportExecutionFilters = (
  evaluationDataSources: ReportBaseDataSource[],
  allowedFilters: string[],
  filters: NormalizedFilter[],
): void => {
  const supportedFilters = unionSupportedFilterKeys(evaluationDataSources);
  const allowedFilterSet = new Set(allowedFilters);
  const sourcesLabel = evaluationDataSources.map((d) => String(d).toLowerCase()).join(', ');

  for (const filter of filters) {
    if (!supportedFilters.has(filter.key)) {
      throw createServiceError(
        `Filter '${filter.key}' is not supported for this report type's data sources (${sourcesLabel}).`,
        422,
      );
    }

    if (!allowedFilterSet.has(filter.key)) {
      throw createServiceError(`Filter '${filter.key}' is not enabled for this report type.`, 422);
    }
  }
};

const buildInClause = (column: string, values: string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`;

/** User ids from USER and/or ASSIGNEE filters (before per-data-source stripping). */
const extractSelectedUserIds = (filters: NormalizedFilter[]): string[] => {
  const ids = new Set<string>();
  for (const filter of filters) {
    if (filter.key !== 'user' && filter.key !== 'assignee') continue;
    for (const id of filter.value) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return Array.from(ids);
};

const intersectUserScopes = (a: string[] | 'ALL', b: string[] | 'ALL'): string[] | 'ALL' => {
  if (a === 'ALL') return b;
  if (b === 'ALL') return a;
  const allowed = new Set(b);
  return a.filter((id) => allowed.has(id));
};

const getActorPermissions = async (roleId?: string | null): Promise<string[]> => {
  if (!roleId) return [];
  const cacheKey = `role_permissions:${roleId}`;
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }
  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: { select: { key: true } } },
  });
  return rolePermissions.map((rp: any) => rp.permission.key);
};

const getActivityReportUserScope = async (workspaceId: string, actor: Actor): Promise<string[] | 'ALL'> => {
  if (actor.role?.name?.toLowerCase() === 'superadmin') {
    return 'ALL';
  }

  const permissions = await getActorPermissions(actor.roleId);
  if (permissions.includes('SYSTEM_CONFIG') || permissions.includes('USERS_VIEW')) {
    return 'ALL';
  }

  const supervisedUsers = await prisma.user.findMany({
    where: { workspaceId, supervisorId: actor.id, deletedAt: null },
    select: { id: true },
  });

  if (supervisedUsers.length > 0) {
    return [actor.id, ...supervisedUsers.map((u: any) => u.id)];
  }

  return [actor.id];
};

/** RBAC ceiling for report exports when no explicit user filter is set. */
const getReportExportUserScope = async (workspaceId: string, actor: Actor): Promise<string[] | 'ALL'> => {
  if (actor.role?.name?.toLowerCase() === 'superadmin') {
    return 'ALL';
  }

  const permissions = await getActorPermissions(actor.roleId);
  if (
    permissions.includes('SYSTEM_CONFIG') ||
    permissions.includes('REPORTS_VIEW') ||
    permissions.includes('USERS_VIEW')
  ) {
    return 'ALL';
  }

  const supervisedUsers = await prisma.user.findMany({
    where: { workspaceId, supervisorId: actor.id, deletedAt: null },
    select: { id: true },
  });

  if (supervisedUsers.length > 0) {
    return [actor.id, ...supervisedUsers.map((u) => u.id)];
  }

  return [actor.id];
};

/**
 * Resolves user ids to apply on every report section (leads, users, followups, activity).
 * - Explicit USER/ASSIGNEE selection → only those users (intersected with RBAC).
 * - No selection → null when RBAC allows all, otherwise RBAC scope only.
 */
const resolveEffectiveUserIds = (
  allFilters: NormalizedFilter[],
  rbacScope: string[] | 'ALL',
): string[] | null => {
  const selected = extractSelectedUserIds(allFilters);

  if (selected.length > 0) {
    if (rbacScope === 'ALL') return selected;
    return selected.filter((id) => rbacScope.includes(id));
  }

  if (rbacScope === 'ALL') return null;
  return rbacScope;
};

const appendEffectiveUserScope = (
  clauses: Prisma.Sql[],
  effectiveUserIds: string[] | null,
  buildScope: (ids: string[]) => Prisma.Sql,
): void => {
  if (effectiveUserIds === null) return;
  if (effectiveUserIds.length === 0) {
    clauses.push(Prisma.sql`1 = 0`);
    return;
  }
  clauses.push(buildScope(effectiveUserIds));
};

const buildDateClause = (column: string, range: DateRange): Prisma.Sql => {
  if (range.from && range.to) {
    return Prisma.sql`${Prisma.raw(column)} BETWEEN ${range.from} AND ${range.to}`;
  }
  if (range.from) {
    return Prisma.sql`${Prisma.raw(column)} >= ${range.from}`;
  }
  return Prisma.sql`${Prisma.raw(column)} <= ${range.to!}`;
};

const buildLeadWhereClauses = (
  workspaceId: string,
  filters: NormalizedFilter[],
  effectiveUserIds: string[] | null = null,
): Prisma.Sql[] => {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`l."workspaceId" = ${workspaceId}`,
    Prisma.sql`l."deletedAt" IS NULL`,
  ];

  for (const filter of filters) {
    switch (filter.key) {
      case 'stage':
        clauses.push(buildInClause('l."stageId"', filter.value));
        break;
      case 'assignee':
        clauses.push(buildInClause('l."assignedToId"', filter.value));
        break;
      case 'lead_source':
        clauses.push(buildInClause('l."sourceId"', filter.value));
        break;
      case 'created_date':
        clauses.push(buildDateClause('l."createdAt"', filter.value));
        break;
      case 'follow_up_date': {
        const subClauses: Prisma.Sql[] = [
          Prisma.sql`f."leadId" = l."id"`,
          Prisma.sql`f."workspaceId" = ${workspaceId}`,
          buildDateClause('f."scheduledAt"', filter.value),
        ];
        clauses.push(
          Prisma.sql`EXISTS (
            SELECT 1
            FROM "follow_ups" f
            WHERE ${Prisma.join(subClauses, ' AND ')}
          )`,
        );
        break;
      }
      default:
        break;
    }
  }

  appendEffectiveUserScope(clauses, effectiveUserIds, (ids) =>
    Prisma.sql`(
      l."assignedToId" IN (${Prisma.join(ids)})
      OR l."createdById" IN (${Prisma.join(ids)})
    )`,
  );

  return clauses;
};

const buildUserWhereClauses = (
  workspaceId: string,
  filters: NormalizedFilter[],
  effectiveUserIds: string[] | null = null,
): Prisma.Sql[] => {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`u."workspaceId" = ${workspaceId}`,
    Prisma.sql`u."deletedAt" IS NULL`,
  ];

  for (const filter of filters) {
    switch (filter.key) {
      case 'created_date':
        clauses.push(buildDateClause('u."createdAt"', filter.value));
        break;
      case 'role':
        clauses.push(buildInClause('u."roleId"', filter.value));
        break;
      case 'department':
        clauses.push(buildInClause('u."departmentId"', filter.value));
        break;
      case 'office':
        clauses.push(buildInClause('u."officeId"', filter.value));
        break;
      case 'status':
        clauses.push(
          Prisma.sql`LOWER(CASE WHEN u."isActive" THEN 'active' ELSE 'inactive' END) IN (${Prisma.join(
            filter.value.map((value) => value.toLowerCase()),
          )})`,
        );
        break;
      default:
        break;
    }
  }

  appendEffectiveUserScope(clauses, effectiveUserIds, (ids) => buildInClause('u."id"', ids));

  return clauses;
};

const buildFollowUpWhereClauses = (
  workspaceId: string,
  filters: NormalizedFilter[],
  effectiveUserIds: string[] | null = null,
): Prisma.Sql[] => {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`f."workspaceId" = ${workspaceId}`,
    Prisma.sql`l."deletedAt" IS NULL`,
  ];

  for (const filter of filters) {
    switch (filter.key) {
      case 'stage':
        clauses.push(buildInClause('l."stageId"', filter.value));
        break;
      case 'assignee':
        clauses.push(buildInClause('l."assignedToId"', filter.value));
        break;
      case 'lead_source':
        clauses.push(buildInClause('l."sourceId"', filter.value));
        break;
      case 'created_date':
        clauses.push(buildDateClause('f."createdAt"', filter.value));
        break;
      case 'follow_up_date':
        clauses.push(buildDateClause('f."scheduledAt"', filter.value));
        break;
      case 'status':
        clauses.push(
          Prisma.sql`LOWER(f."status") IN (${Prisma.join(filter.value.map((value) => value.toLowerCase()))})`,
        );
        break;
      default:
        break;
    }
  }

  appendEffectiveUserScope(clauses, effectiveUserIds, (ids) =>
    Prisma.sql`(
      f."userId" IN (${Prisma.join(ids)})
      OR l."assignedToId" IN (${Prisma.join(ids)})
      OR l."createdById" IN (${Prisma.join(ids)})
    )`,
  );

  return clauses;
};

const buildLeadReportQueries = (
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  effectiveUserIds: string[] | null = null,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildLeadWhereClauses(workspaceId, filters, effectiveUserIds);
  const offset = (page - 1) * limit;

  return {
    dataQuery: Prisma.sql`
      SELECT
        l."id",
        l."name",
        l."email",
        l."phone",
        l."expectedRevenue",
        l."generatedRevenue",
        l."createdAt",
        l."updatedAt",
        l."nextFollowUpAt",
        s."name" AS "stageName",
        src."name" AS "sourceName",
        lc."name" AS "lifecycleName",
        COALESCE(u."name", u."username", u."email") AS "assignedToName"
      FROM "leads" l
      LEFT JOIN "lead_stages" s ON s."id" = l."stageId"
      LEFT JOIN "lead_sources" src ON src."id" = l."sourceId"
      LEFT JOIN "lead_life_cycles" lc ON lc."id" = l."lifecycleId"
      LEFT JOIN "users" u ON u."id" = l."assignedToId"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
      ORDER BY l."createdAt" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    countQuery: Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "leads" l
      WHERE ${Prisma.join(whereClauses, ' AND ')}
    `,
  };
};

const buildUserReportQueries = (
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  effectiveUserIds: string[] | null = null,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildUserWhereClauses(workspaceId, filters, effectiveUserIds);
  const offset = (page - 1) * limit;

  return {
    dataQuery: Prisma.sql`
      SELECT
        u."id",
        u."name",
        u."username",
        u."email",
        u."phone",
        u."isActive",
        u."createdAt",
        COALESCE(r."name", '') AS "roleName",
        COALESCE(d."name", '') AS "departmentName",
        COALESCE(o."name", '') AS "officeName"
      FROM "users" u
      LEFT JOIN "roles" r ON r."id" = u."roleId"
      LEFT JOIN "departments" d ON d."id" = u."departmentId"
      LEFT JOIN "offices" o ON o."id" = u."officeId"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
      ORDER BY u."createdAt" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    countQuery: Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "users" u
      WHERE ${Prisma.join(whereClauses, ' AND ')}
    `,
  };
};

const buildFollowUpReportQueries = (
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  effectiveUserIds: string[] | null = null,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildFollowUpWhereClauses(workspaceId, filters, effectiveUserIds);
  const offset = (page - 1) * limit;

  return {
    dataQuery: Prisma.sql`
      SELECT
        f."id",
        f."type",
        f."status",
        f."description",
        f."scheduledAt",
        f."completedAt",
        f."createdAt",
        f."recentDescription" AS "snoozeOutcome",
        f."extensionReasonName" AS "extensionReason",
        f."previousFollowupDate",
        f."newFollowupDate",
        l."id" AS "leadId",
        l."name" AS "leadName",
        s."name" AS "stageName",
        src."name" AS "sourceName",
        COALESCE(u."name", u."username", u."email") AS "assignedToName"
      FROM "follow_ups" f
      INNER JOIN "leads" l ON l."id" = f."leadId"
      LEFT JOIN "lead_stages" s ON s."id" = l."stageId"
      LEFT JOIN "lead_sources" src ON src."id" = l."sourceId"
      LEFT JOIN "users" u ON u."id" = l."assignedToId"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
      ORDER BY f."scheduledAt" DESC, f."createdAt" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    countQuery: Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "follow_ups" f
      INNER JOIN "leads" l ON l."id" = f."leadId"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
    `,
  };
};

const buildActivityWhereClauses = (
  workspaceId: string,
  filters: NormalizedFilter[],
  effectiveUserIds: string[] | null = null,
): Prisma.Sql[] => {
  const clauses: Prisma.Sql[] = [Prisma.sql`a."workspaceId" = ${workspaceId}`];

  for (const filter of filters) {
    switch (filter.key) {
      case 'module':
        clauses.push(buildInClause('a."entityType"', filter.value));
        break;
      case 'action':
        clauses.push(buildInClause('a."action"', filter.value));
        break;
      case 'created_date':
        clauses.push(buildDateClause('a."createdAt"', filter.value));
        break;
      default:
        break;
    }
  }

  appendEffectiveUserScope(clauses, effectiveUserIds, (ids) => buildInClause('a."userId"', ids));

  return clauses;
};

const buildActivityReportQueries = (
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  effectiveUserIds: string[] | null = null,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildActivityWhereClauses(workspaceId, filters, effectiveUserIds);
  const offset = (page - 1) * limit;

  return {
    dataQuery: Prisma.sql`
      SELECT
        a."id",
        a."action",
        a."entityType",
        a."entityId",
        COALESCE(a."details"::text, '') AS "details",
        a."ipAddress",
        a."userAgent",
        a."createdAt",
        COALESCE(u."name", u."username", u."email") AS "performedByName"
      FROM "audit_logs" a
      LEFT JOIN "users" u ON u."id" = a."userId"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
      ORDER BY a."createdAt" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    countQuery: Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "audit_logs" a
      WHERE ${Prisma.join(whereClauses, ' AND ')}
    `,
  };
};

const buildQueriesByDataSource = (
  dataSource: ReportBaseDataSource,
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  effectiveUserIds: string[] | null = null,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  switch (dataSource as string) {
    case 'USERS':
      return buildUserReportQueries(workspaceId, filters, page, limit, effectiveUserIds);
    case 'FOLLOWUPS':
      return buildFollowUpReportQueries(workspaceId, filters, page, limit, effectiveUserIds);
    case 'ACTIVITY':
      return buildActivityReportQueries(workspaceId, filters, page, limit, effectiveUserIds);
    case 'LEADS':
    default:
      return buildLeadReportQueries(workspaceId, filters, page, limit, effectiveUserIds);
  }
};

const filtersForDataSource = (dataSource: ReportBaseDataSource, filters: NormalizedFilter[]): NormalizedFilter[] => {
  const supported = new Set(FILTERS_BY_SOURCE[dataSource]);
  return filters.filter((filter) => supported.has(filter.key));
};

const mapReportType = (row: any) => {
  const modules = parseJsonStringArray(row.modules, row.module ? [row.module] : []);
  const baseDataSources = parseJsonStringArray(row.baseDataSources, row.baseDataSource ? [row.baseDataSource] : []);
  const categories = parseJsonStringArray(row.categories, row.category ? [row.category] : ['Leads Report']);

  return {
    ...row,
    modules,
    baseDataSources,
    categories,
    category: categories[0] ?? row.category ?? 'Leads Report',
    allowedFilters: Array.isArray(row.allowedFilters) ? row.allowedFilters : [],
    createdAt: toIsoOrNull(row.createdAt),
    updatedAt: toIsoOrNull(row.updatedAt),
    deletedAt: toIsoOrNull(row.deletedAt),
  };
};

const mapStoredFilter = (filter: { id: string; filterKey: string; filterValue: string; createdAt: Date }) => {
  let parsed: unknown = filter.filterValue;
  try {
    parsed = JSON.parse(filter.filterValue);
  } catch {
    parsed = filter.filterValue;
  }

  return {
    id: filter.id,
    key: filter.filterKey,
    value: parsed,
    createdAt: toIsoOrNull(filter.createdAt),
  };
};

const mapReport = (row: any) => ({
  ...row,
  reportDate: toDateOnly(row.reportDate) ?? row.reportDate,
  generatedAt: toIsoOrNull(row.generatedAt),
  createdAt: toIsoOrNull(row.createdAt),
  updatedAt: toIsoOrNull(row.updatedAt),
  deletedAt: toIsoOrNull(row.deletedAt),
  reportType: row.reportType ? mapReportType(row.reportType) : null,
  createdBy: row.createdBy
    ? {
        ...row.createdBy,
        displayName: resolveDisplayName(row.createdBy),
      }
    : null,
  filters: Array.isArray(row.filters) ? row.filters.map(mapStoredFilter) : [],
});

const escapeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const serialized = value instanceof Date ? value.toISOString() : String(value);
  if (serialized.includes(',') || serialized.includes('"') || serialized.includes('\n')) {
    return `"${serialized.replace(/"/g, '""')}"`;
  }
  return serialized;
};

const buildCsv = (rows: Record<string, unknown>[]): string => {
  if (rows.length === 0) {
    return 'message\nNo data available';
  }

  const headers = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      Object.keys(row).forEach((key) => acc.add(key));
      return acc;
    }, new Set()),
  );

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
  ];

  return lines.join('\n');
};

const buildConsolidatedCsv = (
  sections: Array<{ title: string; rows: Record<string, unknown>[] }>,
): string => {
  if (sections.every((section) => section.rows.length === 0)) {
    return 'message\nNo data available';
  }

  return sections
    .map((section) => {
      const header = `=== ${section.title} ===`;
      const body = section.rows.length > 0 ? buildCsv(section.rows) : 'message\nNo data available';
      return `${header}\n${body}`;
    })
    .join('\n\n');
};

const toCsvDataUrl = (csvContent: string): string =>
  `data:text/csv;charset=utf-8;base64,${Buffer.from(csvContent, 'utf8').toString('base64')}`;

const runReportType = async (
  workspaceId: string,
  actor: Actor,
  reportTypeId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
  logTarget?: { reportId?: string; action?: string },
  context?: { ipAddress?: string; userAgent?: string },
  options?: { dataSourceOverride?: ReportBaseDataSource; skipAuditLog?: boolean },
): Promise<ReportExecutionResult> => {
  await ensureModuleReady();

  const reportType = await reportsRepository.findReportTypeById(workspaceId, reportTypeId);
  if (!reportType) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  if (reportType.status !== ReportTypeStatus.ACTIVE) {
    throw createServiceError('Only ACTIVE report types can be executed.', 409);
  }

  const allowedFilters = Array.isArray(reportType.allowedFilters)
    ? reportType.allowedFilters.filter((value): value is string => typeof value === 'string')
    : [];

  const executionDataSource = options?.dataSourceOverride ?? reportType.baseDataSource;
  const scopedFilters = filtersForDataSource(executionDataSource, filters);

  assertReportExecutionFilters([executionDataSource], allowedFilters, scopedFilters);

  let rbacScope =
    executionDataSource === 'LEADS' || executionDataSource === 'FOLLOWUPS'
      ? await resolveVisibleLeadUserScope(workspaceId, actor)
      : await getReportExportUserScope(workspaceId, actor);
  if ((executionDataSource as string) === 'ACTIVITY') {
    const permissions = await getActorPermissions(actor.roleId);
    if (
      !permissions.includes('VIEW_ACTIVITY_REPORTS') &&
      !permissions.includes('SYSTEM_CONFIG') &&
      actor.role?.name?.toLowerCase() !== 'superadmin'
    ) {
      throw createServiceError('Access denied. You need the VIEW_ACTIVITY_REPORTS permission to run Activity reports.', 403);
    }
    rbacScope = intersectUserScopes(rbacScope, await getActivityReportUserScope(workspaceId, actor));
  }

  const effectiveUserIds = resolveEffectiveUserIds(filters, rbacScope);

  const { dataQuery, countQuery } = buildQueriesByDataSource(
    executionDataSource,
    workspaceId,
    scopedFilters,
    page,
    limit,
    effectiveUserIds,
  );

  const [rows, countRows] = await Promise.all([
    reportsRepository.executeDynamicQuery<Record<string, unknown>>(dataQuery),
    reportsRepository.executeDynamicQuery<{ total: number }>(countQuery),
  ]);

  const total = Number(countRows[0]?.total ?? 0);

  if (!options?.skipAuditLog) {
    await reportsRepository.createReportLog({
      workspaceId,
      reportTypeId: reportType.id,
      reportId: logTarget?.reportId ?? null,
      generatedById: actor.id,
      action: logTarget?.action ?? 'GENERATE',
      filters: filters as unknown as Prisma.InputJsonValue,
      resultCount: total,
      meta: {
        reportTypeName: reportType.name,
        baseDataSource: executionDataSource,
        page,
        limit,
        executionMode: logTarget?.reportId ? 'saved_report' : 'adhoc',
      } as Prisma.InputJsonValue,
    });

    await auditService.log({
      userId: actor.id,
      workspaceId,
      action: logTarget?.reportId ? 'REPORT_INSTANCE_GENERATED' : 'REPORT_GENERATED',
      entityType: logTarget?.reportId ? 'Report' : 'ReportType',
      entityId: logTarget?.reportId ?? reportType.id,
      details: {
        reportId: logTarget?.reportId ?? null,
        reportTypeId: reportType.id,
        reportTypeName: reportType.name,
        baseDataSource: executionDataSource,
        filters,
        resultCount: total,
        page,
        limit,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
  }

  return {
    reportType: mapReportType(reportType),
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const createReport = async (
  workspaceId: string,
  actor: Actor,
  input: CreateReportInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const reportType = await reportsRepository.findReportTypeById(workspaceId, input.reportTypeId);
  if (!reportType) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  if (reportType.status !== ReportTypeStatus.ACTIVE) {
    throw createServiceError('Only ACTIVE report types can be used to create saved reports.', 409);
  }

  const normalizedFilters = normalizeFilters(input.filters);
  const allowedFilters = Array.isArray(reportType.allowedFilters)
    ? reportType.allowedFilters.filter((value): value is string => typeof value === 'string')
    : [];

  assertReportExecutionFilters(resolveBaseDataSources(reportType), allowedFilters, normalizedFilters);

  const created = await reportsRepository.createReport(
    {
      workspaceId,
      reportName: input.reportName,
      reportTypeId: input.reportTypeId,
      reportDate: input.reportDate,
      isActive: input.isActive,
      createdById: actor.id,
    },
    serializeFiltersForStorage(normalizedFilters),
  );

  await reportsRepository.createReportLog({
    workspaceId,
    reportId: created.id,
    reportTypeId: created.reportTypeId,
    generatedById: actor.id,
    action: 'CREATE',
    filters: normalizedFilters as unknown as Prisma.InputJsonValue,
    resultCount: 0,
    meta: {
      reportName: created.reportName,
      reportDate: created.reportDate,
      isActive: created.isActive,
    } as Prisma.InputJsonValue,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_CREATED',
    entityType: 'Report',
    entityId: created.id,
    details: {
      reportName: created.reportName,
      reportTypeId: created.reportTypeId,
      reportTypeName: created.reportType?.name ?? null,
      reportDate: created.reportDate,
      isActive: created.isActive,
      filters: normalizedFilters,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReport(created);
};

export const updateReport = async (
  workspaceId: string,
  actor: Actor,
  reportId: string,
  input: UpdateReportInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const existing = await reportsRepository.findReportById(workspaceId, reportId);
  if (!existing) {
    throw createServiceError('Report not found in this workspace.', 404);
  }

  const nextReportTypeId = input.reportTypeId ?? existing.reportTypeId;
  const reportType = await reportsRepository.findReportTypeById(workspaceId, nextReportTypeId);
  if (!reportType) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  if (reportType.status !== ReportTypeStatus.ACTIVE) {
    throw createServiceError('Only ACTIVE report types can be used for saved reports.', 409);
  }

  const normalizedFilters =
    input.filters !== undefined ? normalizeFilters(input.filters) : parseStoredFilters(existing.filters);
  const allowedFilters = Array.isArray(reportType.allowedFilters)
    ? reportType.allowedFilters.filter((value): value is string => typeof value === 'string')
    : [];

  assertReportExecutionFilters(resolveBaseDataSources(reportType), allowedFilters, normalizedFilters);

  const reportName = input.reportName ?? existing.reportName;
  const reportDate = input.reportDate ?? existing.reportDate;
  const isActive = input.isActive ?? existing.isActive;
  const definitionChanged =
    nextReportTypeId !== existing.reportTypeId ||
    reportName !== existing.reportName ||
    reportDate.getTime() !== existing.reportDate.getTime() ||
    JSON.stringify(serializeFiltersForStorage(normalizedFilters)) !== JSON.stringify(serializeFiltersForStorage(parseStoredFilters(existing.filters)));

  const updated = await reportsRepository.replaceReportDefinition(
    reportId,
    {
      reportName,
      reportTypeId: nextReportTypeId,
      reportDate,
      isActive,
      ...(definitionChanged
        ? {
            isGenerated: false,
            generatedFileUrl: null,
            generatedAt: null,
          }
        : {}),
    },
    serializeFiltersForStorage(normalizedFilters),
  );

  await reportsRepository.createReportLog({
    workspaceId,
    reportId: updated.id,
    reportTypeId: updated.reportTypeId,
    generatedById: actor.id,
    action: 'UPDATE',
    filters: normalizedFilters as unknown as Prisma.InputJsonValue,
    resultCount: 0,
    meta: {
      reportName: updated.reportName,
      definitionChanged,
    } as Prisma.InputJsonValue,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_UPDATED',
    entityType: 'Report',
    entityId: updated.id,
    details: {
      reportName: updated.reportName,
      reportTypeId: updated.reportTypeId,
      definitionChanged,
      isActive: updated.isActive,
      filters: normalizedFilters,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReport(updated);
};

export const listReports = async (workspaceId: string, query: ListReportsQueryInput) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const where: Prisma.ReportWhereInput = {
    workspaceId,
    deletedAt: null,
  };

  if (query.reportName) {
    where.reportName = {
      contains: query.reportName,
      mode: 'insensitive',
    };
  }

  if (query.createdBy) {
    where.createdById = query.createdBy;
  }

  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }

  if (query.status) {
    where.isGenerated = query.status === 'completed';
  }

  if (query.reportTypeId) {
    where.reportTypeId = query.reportTypeId;
  }

  if (query.createdAtFrom || query.createdAtTo) {
    where.createdAt = {
      ...(query.createdAtFrom ? { gte: query.createdAtFrom } : {}),
      ...(query.createdAtTo ? { lte: query.createdAtTo } : {}),
    };
  }

  if (query.reportDateFrom || query.reportDateTo) {
    where.reportDate = {
      ...(query.reportDateFrom ? { gte: query.reportDateFrom } : {}),
      ...(query.reportDateTo ? { lte: query.reportDateTo } : {}),
    };
  }

  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await reportsRepository.listReports(where, skip, query.limit);

  return {
    data: rows.map(mapReport),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const generateReport = async (
  workspaceId: string,
  actor: Actor,
  input: GenerateReportInput,
  context?: { ipAddress?: string; userAgent?: string },
) =>
  runReportType(workspaceId, actor, input.reportTypeId, normalizeFilters(input.filters), input.page, input.limit, undefined, context);

export const generateSavedReport = async (
  workspaceId: string,
  actor: Actor,
  reportId: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const report = await reportsRepository.findReportById(workspaceId, reportId);
  if (!report) {
    throw createServiceError('Report not found in this workspace.', 404);
  }

  const normalizedFilters = parseStoredFilters(report.filters);
  const reportType = report.reportType!;
  const dataSources = resolveBaseDataSources(reportType);

  const sections: Array<{ title: string; rows: Record<string, unknown>[] }> = [];
  let totalRows = 0;

  for (const source of dataSources) {
    const execution = await runReportType(
      workspaceId,
      actor,
      report.reportTypeId,
      normalizedFilters,
      1,
      500,
      { reportId: report.id, action: 'GENERATE' },
      context,
      { dataSourceOverride: source, skipAuditLog: dataSources.length > 1 },
    );
    sections.push({ title: source, rows: execution.rows });
    totalRows += execution.rows.length;
  }

  if (dataSources.length === 1) {
    await reportsRepository.createReportLog({
      workspaceId,
      reportTypeId: report.reportTypeId,
      reportId: report.id,
      generatedById: actor.id,
      action: 'GENERATE',
      filters: normalizedFilters as unknown as Prisma.InputJsonValue,
      resultCount: totalRows,
      meta: {
        reportName: report.reportName,
        baseDataSource: dataSources[0],
        consolidated: false,
      } as Prisma.InputJsonValue,
    });
  } else {
    await reportsRepository.createReportLog({
      workspaceId,
      reportTypeId: report.reportTypeId,
      reportId: report.id,
      generatedById: actor.id,
      action: 'GENERATE',
      filters: normalizedFilters as unknown as Prisma.InputJsonValue,
      resultCount: totalRows,
      meta: {
        reportName: report.reportName,
        baseDataSources: dataSources,
        consolidated: true,
      } as Prisma.InputJsonValue,
    });
  }

  const csv = dataSources.length > 1 ? buildConsolidatedCsv(sections) : buildCsv(sections[0]?.rows || []);
  const fileUrl = toCsvDataUrl(csv);

  const updated = await reportsRepository.updateReport(report.id, {
    isGenerated: true,
    generatedFileUrl: fileUrl,
    generatedAt: new Date(),
  });

  return {
    message: 'Report generated successfully.',
    fileUrl,
    report: mapReport(updated),
    execution: {
      dataSources,
      sections,
      totalRows,
      rows: sections.flatMap((section) => section.rows),
    },
  };
};

export const downloadReport = async (
  workspaceId: string,
  actor: Actor,
  reportId: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const report = await reportsRepository.findReportById(workspaceId, reportId);
  if (!report) {
    throw createServiceError('Report not found in this workspace.', 404);
  }

  const activitySources = report.reportType
    ? resolveBaseDataSources(report.reportType as { baseDataSource: ReportBaseDataSource; baseDataSources?: unknown })
    : [];
  if (activitySources.some((s) => String(s) === 'ACTIVITY')) {
    const permissions = await getActorPermissions(actor.roleId);
    if (!permissions.includes('EXPORT_ACTIVITY_REPORTS') && !permissions.includes('SYSTEM_CONFIG') && actor.role?.name?.toLowerCase() !== 'superadmin') {
      throw createServiceError('Access denied. You need the EXPORT_ACTIVITY_REPORTS permission to download Activity reports.', 403);
    }
  }

  if (!report.generatedFileUrl) {
    throw createServiceError('Report not generated yet.', 409);
  }

  const normalizedFilters = parseStoredFilters(report.filters);

  await reportsRepository.createReportLog({
    workspaceId,
    reportId: report.id,
    reportTypeId: report.reportTypeId,
    generatedById: actor.id,
    action: 'DOWNLOAD',
    filters: normalizedFilters as unknown as Prisma.InputJsonValue,
    resultCount: 0,
    meta: {
      reportName: report.reportName,
      generatedAt: report.generatedAt,
    } as Prisma.InputJsonValue,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_DOWNLOADED',
    entityType: 'Report',
    entityId: report.id,
    details: {
      reportName: report.reportName,
      reportTypeId: report.reportTypeId,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return {
    fileUrl: report.generatedFileUrl,
    report: mapReport(report),
  };
};

export const deleteReport = async (
  workspaceId: string,
  actor: Actor,
  reportId: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await ensureReportInstanceReady();

  const report = await reportsRepository.findReportById(workspaceId, reportId);
  if (!report) {
    throw createServiceError('Report not found in this workspace.', 404);
  }

  const deleted = await reportsRepository.updateReport(report.id, {
    deletedAt: new Date(),
    isActive: false,
  });

  const normalizedFilters = parseStoredFilters(report.filters);

  await reportsRepository.createReportLog({
    workspaceId,
    reportId: report.id,
    reportTypeId: report.reportTypeId,
    generatedById: actor.id,
    action: 'DELETE',
    filters: normalizedFilters as unknown as Prisma.InputJsonValue,
    resultCount: 0,
    meta: {
      reportName: report.reportName,
    } as Prisma.InputJsonValue,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_DELETED',
    entityType: 'Report',
    entityId: report.id,
    details: {
      reportName: report.reportName,
      reportTypeId: report.reportTypeId,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return {
    message: 'Report deleted successfully.',
    report: mapReport(deleted),
  };
};

export const listReportLogs = async (workspaceId: string, query: ListReportLogsQueryInput) => {
  await ensureModuleReady();

  const where: {
    workspaceId: string;
    reportTypeId?: string;
    generatedById?: string;
    createdAt?: { gte?: Date; lte?: Date };
  } = {
    workspaceId,
  };

  if (query.reportTypeId) where.reportTypeId = query.reportTypeId;
  if (query.generatedBy) where.generatedById = query.generatedBy;
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    reportsRepository.listReportLogs(where, skip, query.limit),
    reportsRepository.countReportLogs(where),
  ]);

  return {
    data: rows.map((row: any) => ({
      ...row,
      action: row.action ?? null,
      filters: Array.isArray(row.filters) ? row.filters : [],
      meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
      createdAt: toIsoOrNull(row.createdAt),
      reportType: row.reportType ? mapReportType(row.reportType) : null,
      report: row.report
        ? {
            ...row.report,
            reportDate: toDateOnly(row.report.reportDate) ?? row.report.reportDate,
          }
        : null,
      generatedBy: row.generatedBy
        ? {
            ...row.generatedBy,
            displayName: resolveDisplayName(row.generatedBy),
          }
        : null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};
