import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import {
  ListStageRulesResponse,
  StageRuleResponse,
  StageTransitionValidationResult,
} from './stageRule.types';
import {
  CreateStageRuleInput,
  ListStageRulesQuery,
  UpdateStageRuleInput,
} from './stageRule.validator';
import { Prisma } from '@prisma/client';

const ACTIVE_CACHE_TTL_SECONDS = 300;
const getActiveCacheKey = (workspaceId: string): string => `stage_rules:active:${workspaceId}`;
const leadStageDelegate = (prisma as any).leadStage;
const stageRuleDelegate = (prisma as any).stageRule;

const parseRuleOptions = (raw: unknown): string[] => {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const withParsedRuleOptions = <T extends Record<string, unknown>>(record: T): T & { options: string[] } => ({
  ...record,
  options: parseRuleOptions((record as { options?: unknown }).options),
});

let stageRuleSchemaCheckedAt: number | null = null;
const STAGE_RULE_SCHEMA_CHECK_TTL_MS = 60_000;
const isStageRuleConsoleDebugEnabled = process.env.DEBUG_STAGE_RULES_CONSOLE === 'true';

const clearActiveStageRulesCache = async (workspaceId: string): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(getActiveCacheKey(workspaceId));
  }
};

type StageRuleColumnMeta = {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
};

const getStageRuleColumnsMeta = async (): Promise<StageRuleColumnMeta[]> =>
  prisma.$queryRaw<StageRuleColumnMeta[]>`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stage_rules'
  `;

const ensureStageIdNullable = async (): Promise<void> => {
  const stageIdNullabilityRows = await prisma.$queryRaw<Array<{ is_nullable: 'YES' | 'NO' }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stage_rules'
      AND column_name = 'stageId'
    LIMIT 1
  `;

  if (stageIdNullabilityRows[0]?.is_nullable === 'NO') {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
      ALTER COLUMN "stageId" DROP NOT NULL;
    `);
  }
};

const ensureLegacyStageRuleColumnsCompatible = async (): Promise<void> => {
  const columns = await getStageRuleColumnsMeta();
  const findColumn = (name: string) =>
    columns.find((column) => column.column_name.toLowerCase() === name.toLowerCase());

  const relaxLegacyTextNotNull = async (columnName: string): Promise<void> => {
    const column = findColumn(columnName);
    if (column?.is_nullable === 'NO') {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "stage_rules"
        ALTER COLUMN "${columnName}" DROP NOT NULL;
      `);
    }
  };

  await relaxLegacyTextNotNull('field');
  await relaxLegacyTextNotNull('condition');
  await relaxLegacyTextNotNull('value');

  const legacyIsMandatory = findColumn('isMandatory');
  if (legacyIsMandatory && !legacyIsMandatory.column_default) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
      ALTER COLUMN "isMandatory" SET DEFAULT false;
    `);
  }
};

const isStageIdNullConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const known = error as { code?: string; meta?: { target?: unknown; constraint?: unknown }; message?: string };
  const target = known.meta?.target;
  const constraint = known.meta?.constraint;
  const message = known.message ?? '';

  const targetHasStageId =
    (Array.isArray(target) && target.some((item) => String(item).toLowerCase().includes('stageid'))) ||
    String(target ?? '').toLowerCase().includes('stageid');
  const constraintHasStageId = String(constraint ?? '').toLowerCase().includes('stageid');
  const messageHasStageId =
    message.includes('Null constraint violation') && message.toLowerCase().includes('stageid');

  return known.code === 'P2011' && (targetHasStageId || constraintHasStageId || messageHasStageId);
};

const ensureStageRuleSchemaReady = async (): Promise<void> => {
  const now = Date.now();
  if (stageRuleSchemaCheckedAt && now - stageRuleSchemaCheckedAt < STAGE_RULE_SCHEMA_CHECK_TTL_MS) {
    return;
  }

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.stage_rules')::text AS table_name
  `;
  const hasStageRulesTable = Boolean(tableRows[0]?.table_name);
  if (!hasStageRulesTable) {
    const error: any = new Error(
      'Stage Rules module is not ready. Database table "stage_rules" is missing. Run Prisma migration/db push.',
    );
    error.statusCode = 503;
    throw error;
  }

  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stage_rules'
  `;

  // Stage Rules supports global rules (stageId = null); legacy schemas may still keep this column NOT NULL.
  await ensureStageIdNullable();
  // Legacy pre-refactor columns may still enforce constraints not used by new Prisma model.
  await ensureLegacyStageRuleColumnsCompatible();

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "stage_rules"
      ADD COLUMN IF NOT EXISTS "options" JSONB;
  `);

  const colSet = new Set(columns.map((column) => column.column_name));
  const lowerColSet = new Set(columns.map((column) => column.column_name.toLowerCase()));
  const requiredColumns = ['name', 'inputType', 'sortOrder', 'required', 'status', 'deletedAt'];
  const hasAllColumns = requiredColumns.every(
    (column) => colSet.has(column) || lowerColSet.has(column.toLowerCase()),
  );

  if (!hasAllColumns) {
    // Attempt self-heal for older stage_rules structure without data loss.
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        CREATE TYPE "InputType" AS ENUM ('TEXT', 'TEXTAREA', 'RADIO', 'SELECT');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
        ADD COLUMN IF NOT EXISTS "name" TEXT,
        ADD COLUMN IF NOT EXISTS "inputType" "InputType",
        ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER,
        ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
        ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "options" JSONB;
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
      ALTER COLUMN "stageId" DROP NOT NULL;
    `);

    const hasField = lowerColSet.has('field');
    const hasIsMandatory = lowerColSet.has('ismandatory');
    if (hasField || hasIsMandatory) {
      await prisma.$executeRawUnsafe(`
        WITH ranked AS (
          SELECT "id", ROW_NUMBER() OVER (PARTITION BY "stageId" ORDER BY "id") AS row_num
          FROM "stage_rules"
        )
        UPDATE "stage_rules" AS sr
        SET
          "name" = COALESCE(NULLIF(TRIM(sr."name"), ''), NULLIF(TRIM(sr."field"), ''), CONCAT('Rule ', ranked.row_num::text)),
          "inputType" = COALESCE(sr."inputType", 'TEXT'::"InputType"),
          "sortOrder" = COALESCE(sr."sortOrder", ranked.row_num),
          "required" = COALESCE(sr."required", sr."isMandatory", false),
          "status" = COALESCE(sr."status", 'ACTIVE'::"RuleStatus"),
          "updatedAt" = COALESCE(sr."updatedAt", NOW())
        FROM ranked
        WHERE sr."id" = ranked."id";
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE "stage_rules"
        SET
          "name" = COALESCE(NULLIF(TRIM("name"), ''), 'Untitled Rule'),
          "inputType" = COALESCE("inputType", 'TEXT'::"InputType"),
          "sortOrder" = COALESCE("sortOrder", 1),
          "updatedAt" = COALESCE("updatedAt", NOW())
        WHERE
          "name" IS NULL OR TRIM("name") = ''
          OR "inputType" IS NULL
          OR "sortOrder" IS NULL
          OR "updatedAt" IS NULL;
      `);
    }

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
        ALTER COLUMN "name" SET DEFAULT 'Untitled Rule',
        ALTER COLUMN "inputType" SET DEFAULT 'TEXT'::"InputType",
        ALTER COLUMN "sortOrder" SET DEFAULT 1,
        ALTER COLUMN "updatedAt" SET DEFAULT NOW();
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stage_rules"
        ALTER COLUMN "name" SET NOT NULL,
        ALTER COLUMN "inputType" SET NOT NULL,
        ALTER COLUMN "sortOrder" SET NOT NULL,
        ALTER COLUMN "updatedAt" SET NOT NULL;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "stage_rules_name_idx" ON "stage_rules"("name");
      CREATE INDEX IF NOT EXISTS "stage_rules_status_idx" ON "stage_rules"("status");
      CREATE INDEX IF NOT EXISTS "stage_rules_sortOrder_idx" ON "stage_rules"("sortOrder");
      CREATE INDEX IF NOT EXISTS "stage_rules_stageId_idx" ON "stage_rules"("stageId");
    `);

    const finalColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stage_rules'
    `;

    const finalSet = new Set(finalColumns.map((column) => column.column_name.toLowerCase()));
    const finalRequired = ['name', 'inputtype', 'sortorder', 'required', 'status', 'deletedat'];
    const finallyReady = finalRequired.every((column) => finalSet.has(column));

    if (!finallyReady) {
      const error: any = new Error(
        'Stage Rules DB schema is not updated. Run Prisma migration/db push for latest stage_rules columns, then restart backend.',
      );
      error.statusCode = 503;
      throw error;
    }
  }

  stageRuleSchemaCheckedAt = now;
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

const assertStageIfProvided = async (workspaceId: string, stageId?: string | null): Promise<void> => {
  if (!stageId) return;

  const stage = await leadStageDelegate.findFirst({
    where: {
      id: stageId,
      workspaceId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!stage) {
    const error: any = new Error('Linked lead stage not found.');
    error.statusCode = 404;
    throw error;
  }
};

const stageScopeFilter = (stageId: string | null): { stageId: string | null } => ({ stageId });

const remapSingleRule = async (record: any): Promise<StageRuleResponse> => {
  const normalized = withParsedRuleOptions(record);
  const [mapped] = await mapCreatorNames([normalized]);
  return mapped as StageRuleResponse;
};

export const createStageRule = async (
  workspaceId: string,
  input: CreateStageRuleInput,
  createdBy?: string,
): Promise<StageRuleResponse> => {
  if (isStageRuleConsoleDebugEnabled) {
    console.log('[StageRule][service.create] input', {
      name: input.name,
      inputType: input.inputType,
      sortOrder: input.sortOrder,
      required: input.required,
      status: input.status,
      stageId: input.stageId ?? null,
      createdBy: createdBy ?? null,
    });
  }

  await ensureStageRuleSchemaReady();

  const scopedStageId = input.stageId ?? null;
  await assertStageIfProvided(workspaceId, scopedStageId);

  const runCreateTransaction = async () =>
    prisma.$transaction(async (tx: any) => {
      await tx.stageRule.updateMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...stageScopeFilter(scopedStageId),
          sortOrder: { gte: input.sortOrder },
        },
        data: {
          sortOrder: { increment: 1 },
        },
      });

      return tx.stageRule.create({
        data: {
          name: input.name,
          workspaceId,
          inputType: input.inputType,
          sortOrder: input.sortOrder,
          required: input.required,
          status: input.status,
          stageId: scopedStageId,
          createdBy,
          ...(input.inputType === 'RADIO' || input.inputType === 'SELECT'
            ? { options: input.options as Prisma.InputJsonValue }
            : {}),
        },
        select: {
          id: true,
          name: true,
          inputType: true,
          options: true,
          sortOrder: true,
          required: true,
          status: true,
          stageId: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
    });

  let created;
  try {
    created = await runCreateTransaction();
  } catch (error) {
    if (isStageRuleConsoleDebugEnabled) {
      const errorMeta = error as { message?: string; code?: string; meta?: unknown };
      console.error('[StageRule][service.create] prisma error', {
        message: errorMeta?.message,
        code: errorMeta?.code,
        meta: errorMeta?.meta,
      });
    }

    if (scopedStageId === null && isStageIdNullConstraintError(error)) {
      await ensureStageIdNullable();
      await ensureLegacyStageRuleColumnsCompatible();
      created = await runCreateTransaction();
    } else {
      throw error;
    }
  }

  await clearActiveStageRulesCache(workspaceId);
  return remapSingleRule(created);
};

export const listStageRules = async (
  workspaceId: string,
  query: ListStageRulesQuery,
): Promise<ListStageRulesResponse> => {
  await ensureStageRuleSchemaReady();

  const { page, limit, search, status, stageId } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    deletedAt: null,
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive' as const },
        }
      : {}),
    ...(status ? { status } : {}),
    ...(stageId !== undefined ? { stageId } : {}),
  };

  const [total, records] = await prisma.$transaction([
    stageRuleDelegate.count({ where }),
    stageRuleDelegate.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        inputType: true,
        options: true,
        sortOrder: true,
        required: true,
        status: true,
        stageId: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
  ]);

  const mappedRecords = await mapCreatorNames(records.map((record: any) => withParsedRuleOptions(record)));

  return {
    data: mappedRecords as StageRuleResponse[],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getActiveStageRules = async (workspaceId: string): Promise<StageRuleResponse[]> => {
  await ensureStageRuleSchemaReady();

  if (redisClient.isOpen) {
    const cached = await redisClient.get(getActiveCacheKey(workspaceId));
    if (cached) {
      return JSON.parse(cached) as StageRuleResponse[];
    }
  }

  const records = await stageRuleDelegate.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      inputType: true,
      options: true,
      sortOrder: true,
      required: true,
      status: true,
      stageId: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  const mappedRecords = (await mapCreatorNames(records.map((record: any) => withParsedRuleOptions(record)))) as StageRuleResponse[];

  if (redisClient.isOpen) {
    await redisClient.setEx(getActiveCacheKey(workspaceId), ACTIVE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const updateStageRule = async (
  workspaceId: string,
  id: string,
  input: UpdateStageRuleInput,
): Promise<StageRuleResponse> => {
  await ensureStageRuleSchemaReady();

  const existing = await stageRuleDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      inputType: true,
      options: true,
      sortOrder: true,
      required: true,
      status: true,
      stageId: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  if (!existing) {
    const error: any = new Error('Stage rule not found.');
    error.statusCode = 404;
    throw error;
  }

  const targetStageId = input.stageId !== undefined ? input.stageId : existing.stageId;
  const targetSortOrder = input.sortOrder ?? existing.sortOrder;

  await assertStageIfProvided(workspaceId, targetStageId);

  const mergedInputType = input.inputType ?? existing.inputType;
  const existingOptions = parseRuleOptions((existing as { options?: unknown }).options);
  const effectiveOptions = input.options !== undefined ? input.options : existingOptions;
  if (mergedInputType === 'RADIO' || mergedInputType === 'SELECT') {
    if (effectiveOptions.length < 1) {
      const error: any = new Error('Radio and select rules require at least one option.');
      error.statusCode = 422;
      throw error;
    }
  }

  const updated = await prisma.$transaction(async (tx: any) => {
    const hasScopeChanged = targetStageId !== existing.stageId;

    if (hasScopeChanged) {
      await tx.stageRule.updateMany({
        where: {
          id: { not: id },
          workspaceId,
          deletedAt: null,
          ...stageScopeFilter(existing.stageId),
          sortOrder: { gt: existing.sortOrder },
        },
        data: {
          sortOrder: { decrement: 1 },
        },
      });

      await tx.stageRule.updateMany({
        where: {
          id: { not: id },
          workspaceId,
          deletedAt: null,
          ...stageScopeFilter(targetStageId),
          sortOrder: { gte: targetSortOrder },
        },
        data: {
          sortOrder: { increment: 1 },
        },
      });
    } else if (targetSortOrder !== existing.sortOrder) {
      if (targetSortOrder > existing.sortOrder) {
        await tx.stageRule.updateMany({
          where: {
            id: { not: id },
            workspaceId,
            deletedAt: null,
            ...stageScopeFilter(existing.stageId),
            sortOrder: { gt: existing.sortOrder, lte: targetSortOrder },
          },
          data: {
            sortOrder: { decrement: 1 },
          },
        });
      } else {
        await tx.stageRule.updateMany({
          where: {
            id: { not: id },
            workspaceId,
            deletedAt: null,
            ...stageScopeFilter(existing.stageId),
            sortOrder: { gte: targetSortOrder, lt: existing.sortOrder },
          },
          data: {
            sortOrder: { increment: 1 },
          },
        });
      }
    }

    return tx.stageRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.inputType !== undefined ? { inputType: input.inputType } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
        ...(input.options !== undefined && (mergedInputType === 'RADIO' || mergedInputType === 'SELECT')
          ? {
              options:
                input.options.length > 0 ? (input.options as Prisma.InputJsonValue) : Prisma.JsonNull,
            }
          : {}),
        ...(mergedInputType === 'TEXT' || mergedInputType === 'TEXTAREA' ? { options: Prisma.JsonNull } : {}),
      },
      select: {
        id: true,
        name: true,
        inputType: true,
        options: true,
        sortOrder: true,
        required: true,
        status: true,
        stageId: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  });

  await clearActiveStageRulesCache(workspaceId);
  return remapSingleRule(updated);
};

export const deleteStageRule = async (workspaceId: string, id: string): Promise<void> => {
  await ensureStageRuleSchemaReady();

  const existing = await stageRuleDelegate.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: {
      id: true,
      sortOrder: true,
      stageId: true,
    },
  });

  if (!existing) {
    const error: any = new Error('Stage rule not found.');
    error.statusCode = 404;
    throw error;
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.stageRule.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
    });

    await tx.stageRule.updateMany({
      where: {
        id: { not: id },
        workspaceId,
        deletedAt: null,
        ...stageScopeFilter(existing.stageId),
        sortOrder: { gt: existing.sortOrder },
      },
      data: {
        sortOrder: { decrement: 1 },
      },
    });
  });

  await clearActiveStageRulesCache(workspaceId);
};

export const getActiveStageRulesForExecution = async (
  workspaceId: string,
  stageId: string,
): Promise<StageRuleResponse[]> => {
  await ensureStageRuleSchemaReady();

  const records = await stageRuleDelegate.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      stageId,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      inputType: true,
      options: true,
      sortOrder: true,
      required: true,
      status: true,
      stageId: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  return (await mapCreatorNames(records.map((record: any) => withParsedRuleOptions(record)))) as StageRuleResponse[];
};

export const validateLeadStageTransitionInputs = async (
  workspaceId: string,
  targetStageId: string,
  _leadData: Record<string, unknown>,
  stageRuleAnswers?: Record<string, string>,
): Promise<StageTransitionValidationResult> => {
  const rules = await getActiveStageRulesForExecution(workspaceId, targetStageId);
  const answers = stageRuleAnswers || {};

  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  for (const rule of rules) {
    const rawValue = answers[rule.id];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (rule.required && !value) {
      missingFields.push(rule.name);
      continue;
    }

    if (!value) continue;

    const opts = rule.options || [];
    if ((rule.inputType === 'RADIO' || rule.inputType === 'SELECT') && opts.length > 0 && !opts.includes(value)) {
      invalidFields.push(rule.name);
    }
  }

  if (missingFields.length > 0) {
    const error: any = new Error(`Required stage rule fields missing: ${missingFields.join(', ')}`);
    error.statusCode = 400;
    error.details = { missingFields };
    throw error;
  }

  if (invalidFields.length > 0) {
    const error: any = new Error(`Invalid option value for: ${invalidFields.join(', ')}`);
    error.statusCode = 400;
    error.details = { invalidFields };
    throw error;
  }

  return {
    isValid: true,
    missingFields: [],
  };
};
