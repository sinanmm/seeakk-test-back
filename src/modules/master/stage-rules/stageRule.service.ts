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

const ACTIVE_CACHE_KEY = 'stage_rules:active';
const ACTIVE_CACHE_TTL_SECONDS = 300;
let stageRuleSchemaCheckedAt: number | null = null;
const STAGE_RULE_SCHEMA_CHECK_TTL_MS = 60_000;
const isStageRuleConsoleDebugEnabled = process.env.DEBUG_STAGE_RULES_CONSOLE === 'true';

const clearActiveStageRulesCache = async (): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.del(ACTIVE_CACHE_KEY);
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
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
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

const assertStageIfProvided = async (stageId?: string | null): Promise<void> => {
  if (!stageId) return;

  const stage = await prisma.leadStage.findFirst({
    where: {
      id: stageId,
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
  const [mapped] = await mapCreatorNames([record]);
  return mapped as StageRuleResponse;
};

export const createStageRule = async (
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
  await assertStageIfProvided(scopedStageId);

  const runCreateTransaction = async () =>
    prisma.$transaction(async (tx) => {
      await tx.stageRule.updateMany({
        where: {
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
          inputType: input.inputType,
          sortOrder: input.sortOrder,
          required: input.required,
          status: input.status,
          stageId: scopedStageId,
          createdBy,
        },
        select: {
          id: true,
          name: true,
          inputType: true,
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

  await clearActiveStageRulesCache();
  return remapSingleRule(created);
};

export const listStageRules = async (query: ListStageRulesQuery): Promise<ListStageRulesResponse> => {
  await ensureStageRuleSchemaReady();

  const { page, limit, search, status, stageId } = query;
  const skip = (page - 1) * limit;

  const where = {
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
    prisma.stageRule.count({ where }),
    prisma.stageRule.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        inputType: true,
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

  const mappedRecords = await mapCreatorNames(records);

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

export const getActiveStageRules = async (): Promise<StageRuleResponse[]> => {
  await ensureStageRuleSchemaReady();

  if (redisClient.isOpen) {
    const cached = await redisClient.get(ACTIVE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as StageRuleResponse[];
    }
  }

  const records = await prisma.stageRule.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      inputType: true,
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

  const mappedRecords = (await mapCreatorNames(records)) as StageRuleResponse[];

  if (redisClient.isOpen) {
    await redisClient.setEx(ACTIVE_CACHE_KEY, ACTIVE_CACHE_TTL_SECONDS, JSON.stringify(mappedRecords));
  }

  return mappedRecords;
};

export const updateStageRule = async (id: string, input: UpdateStageRuleInput): Promise<StageRuleResponse> => {
  await ensureStageRuleSchemaReady();

  const existing = await prisma.stageRule.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      inputType: true,
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

  await assertStageIfProvided(targetStageId);

  const updated = await prisma.$transaction(async (tx) => {
    const hasScopeChanged = targetStageId !== existing.stageId;

    if (hasScopeChanged) {
      await tx.stageRule.updateMany({
        where: {
          id: { not: id },
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
      },
      select: {
        id: true,
        name: true,
        inputType: true,
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

  await clearActiveStageRulesCache();
  return remapSingleRule(updated);
};

export const deleteStageRule = async (id: string): Promise<void> => {
  await ensureStageRuleSchemaReady();

  const existing = await prisma.stageRule.findFirst({
    where: { id, deletedAt: null },
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

  await prisma.$transaction(async (tx) => {
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
        deletedAt: null,
        ...stageScopeFilter(existing.stageId),
        sortOrder: { gt: existing.sortOrder },
      },
      data: {
        sortOrder: { decrement: 1 },
      },
    });
  });

  await clearActiveStageRulesCache();
};

export const getActiveStageRulesForExecution = async (stageId: string): Promise<StageRuleResponse[]> => {
  await ensureStageRuleSchemaReady();

  const records = await prisma.stageRule.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ stageId: null }, { stageId }],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      inputType: true,
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

  return (await mapCreatorNames(records)) as StageRuleResponse[];
};

export const validateLeadStageTransitionInputs = async (
  targetStageId: string,
  leadData: Record<string, unknown>,
): Promise<StageTransitionValidationResult> => {
  const rules = await getActiveStageRulesForExecution(targetStageId);

  const missingFields = rules
    .filter((rule) => rule.required)
    .map((rule) => rule.name)
    .filter((field) => {
      const value = leadData[field];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      return false;
    });

  if (missingFields.length > 0) {
    const error: any = new Error(`Required fields missing: ${missingFields.join(', ')}`);
    error.statusCode = 400;
    error.details = { missingFields };
    throw error;
  }

  return {
    isValid: true,
    missingFields: [],
  };
};
