import { Prisma, ReportBaseDataSource, ReportTypeStatus } from '../../../prisma/generated/client';
import auditService from '../../services/Audit/auditService';
import * as reportTypesRepository from './reportTypes.repository';
import * as reportsRepository from './reports.repository';
import type { GenerateReportInput, ListReportLogsQueryInput, ReportFilterInput } from './reports.validation';

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
type ScalarFilterKey = 'stage' | 'assignee' | 'lead_source' | 'role' | 'department' | 'office' | 'status';

type ScalarFilter = {
  key: ScalarFilterKey;
  value: string[];
};

type RangeFilter = {
  key: RangeFilterKey;
  value: DateRange;
};

type NormalizedFilter = ScalarFilter | RangeFilter;

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

const ensureModuleReady = async (): Promise<void> => {
  const ready = await reportTypesRepository.ensureReportSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Report module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const FILTERS_BY_SOURCE: Record<ReportBaseDataSource, string[]> = {
  LEADS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date'],
  USERS: ['created_date', 'role', 'department', 'office', 'status'],
  FOLLOWUPS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date', 'status'],
};

const normalizeFilters = (filters: ReportFilterInput[]): NormalizedFilter[] =>
  filters.map((filter) => filter as NormalizedFilter);

const assertReportExecutionFilters = (
  dataSource: ReportBaseDataSource,
  allowedFilters: string[],
  filters: NormalizedFilter[],
): void => {
  const supportedFilters = new Set(FILTERS_BY_SOURCE[dataSource]);
  const allowedFilterSet = new Set(allowedFilters);

  for (const filter of filters) {
    if (!supportedFilters.has(filter.key)) {
      throw createServiceError(`Filter '${filter.key}' is not supported for ${dataSource.toLowerCase()} reports.`, 422);
    }

    if (!allowedFilterSet.has(filter.key)) {
      throw createServiceError(`Filter '${filter.key}' is not enabled for this report type.`, 422);
    }
  }
};

const buildInClause = (column: string, values: string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`;

const buildDateClause = (column: string, range: DateRange): Prisma.Sql => {
  if (range.from && range.to) {
    return Prisma.sql`${Prisma.raw(column)} BETWEEN ${range.from} AND ${range.to}`;
  }
  if (range.from) {
    return Prisma.sql`${Prisma.raw(column)} >= ${range.from}`;
  }
  return Prisma.sql`${Prisma.raw(column)} <= ${range.to!}`;
};

const buildLeadWhereClauses = (workspaceId: string, filters: NormalizedFilter[]): Prisma.Sql[] => {
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

  return clauses;
};

const buildUserWhereClauses = (workspaceId: string, filters: NormalizedFilter[]): Prisma.Sql[] => {
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

  return clauses;
};

const buildFollowUpWhereClauses = (workspaceId: string, filters: NormalizedFilter[]): Prisma.Sql[] => {
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

  return clauses;
};

const buildLeadReportQueries = (
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildLeadWhereClauses(workspaceId, filters);
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
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildUserWhereClauses(workspaceId, filters);
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
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  const whereClauses = buildFollowUpWhereClauses(workspaceId, filters);
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

const buildQueriesByDataSource = (
  dataSource: ReportBaseDataSource,
  workspaceId: string,
  filters: NormalizedFilter[],
  page: number,
  limit: number,
): { dataQuery: Prisma.Sql; countQuery: Prisma.Sql } => {
  switch (dataSource) {
    case ReportBaseDataSource.USERS:
      return buildUserReportQueries(workspaceId, filters, page, limit);
    case ReportBaseDataSource.FOLLOWUPS:
      return buildFollowUpReportQueries(workspaceId, filters, page, limit);
    case ReportBaseDataSource.LEADS:
    default:
      return buildLeadReportQueries(workspaceId, filters, page, limit);
  }
};

const mapReportType = (row: any) => ({
  ...row,
  allowedFilters: Array.isArray(row.allowedFilters) ? row.allowedFilters : [],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
});

export const generateReport = async (
  workspaceId: string,
  actor: Actor,
  input: GenerateReportInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();

  const reportType = await reportsRepository.findReportTypeById(workspaceId, input.reportTypeId);
  if (!reportType) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  if (reportType.status !== ReportTypeStatus.ACTIVE) {
    throw createServiceError('Only ACTIVE report types can be executed.', 409);
  }

  const normalizedFilters = normalizeFilters(input.filters);
  const allowedFilters = Array.isArray(reportType.allowedFilters)
    ? reportType.allowedFilters.filter((value): value is string => typeof value === 'string')
    : [];

  assertReportExecutionFilters(reportType.baseDataSource, allowedFilters, normalizedFilters);

  const { dataQuery, countQuery } = buildQueriesByDataSource(
    reportType.baseDataSource,
    workspaceId,
    normalizedFilters,
    input.page,
    input.limit,
  );

  const [rows, countRows] = await Promise.all([
    reportTypesRepository.executeDynamicQuery<Record<string, unknown>>(dataQuery),
    reportTypesRepository.executeDynamicQuery<{ total: number }>(countQuery),
  ]);

  const total = Number(countRows[0]?.total ?? 0);

  await reportsRepository.createReportLog({
    workspaceId,
    reportTypeId: reportType.id,
    generatedById: actor.id,
    filters: normalizedFilters as unknown as Prisma.InputJsonValue,
    resultCount: total,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_GENERATED',
    entityType: 'ReportType',
    entityId: reportType.id,
    details: {
      reportTypeId: reportType.id,
      reportTypeName: reportType.name,
      baseDataSource: reportType.baseDataSource,
      filters: normalizedFilters,
      resultCount: total,
      page: input.page,
      limit: input.limit,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return {
    reportType: mapReportType(reportType),
    rows,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
    },
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
      filters: Array.isArray(row.filters) ? row.filters : [],
      createdAt: row.createdAt.toISOString(),
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
