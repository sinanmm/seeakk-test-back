DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ReportTypeStatus'
  ) THEN
    CREATE TYPE "ReportTypeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ReportBaseDataSource'
  ) THEN
    CREATE TYPE "ReportBaseDataSource" AS ENUM ('LEADS', 'USERS', 'FOLLOWUPS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ReportModule'
  ) THEN
    CREATE TYPE "ReportModule" AS ENUM ('LEADS', 'USERS', 'REPORTS', 'TARGETS', 'FOLLOWUPS');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "report_types" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "module" "ReportModule" NOT NULL,
  "baseDataSource" "ReportBaseDataSource" NOT NULL,
  "description" TEXT,
  "allowedFilters" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" "ReportTypeStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "report_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "report_logs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "reportTypeId" TEXT NOT NULL,
  "generatedById" TEXT,
  "filters" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_types_workspaceId_idx"
ON "report_types"("workspaceId");

CREATE INDEX IF NOT EXISTS "report_types_status_idx"
ON "report_types"("status");

CREATE INDEX IF NOT EXISTS "report_types_module_idx"
ON "report_types"("module");

CREATE INDEX IF NOT EXISTS "report_types_workspaceId_status_module_createdAt_idx"
ON "report_types"("workspaceId", "status", "module", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_report_name_per_workspace"
ON "report_types"("workspaceId", LOWER("name"))
WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "report_logs_workspaceId_idx"
ON "report_logs"("workspaceId");

CREATE INDEX IF NOT EXISTS "report_logs_reportTypeId_idx"
ON "report_logs"("reportTypeId");

CREATE INDEX IF NOT EXISTS "report_logs_generatedById_idx"
ON "report_logs"("generatedById");

CREATE INDEX IF NOT EXISTS "report_logs_workspaceId_createdAt_idx"
ON "report_logs"("workspaceId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_types_workspaceId_fkey'
      AND table_name = 'report_types'
  ) THEN
    ALTER TABLE "report_types"
    ADD CONSTRAINT "report_types_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_types_createdById_fkey'
      AND table_name = 'report_types'
  ) THEN
    ALTER TABLE "report_types"
    ADD CONSTRAINT "report_types_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_types_updatedById_fkey'
      AND table_name = 'report_types'
  ) THEN
    ALTER TABLE "report_types"
    ADD CONSTRAINT "report_types_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_logs_workspaceId_fkey'
      AND table_name = 'report_logs'
  ) THEN
    ALTER TABLE "report_logs"
    ADD CONSTRAINT "report_logs_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_logs_reportTypeId_fkey'
      AND table_name = 'report_logs'
  ) THEN
    ALTER TABLE "report_logs"
    ADD CONSTRAINT "report_logs_reportTypeId_fkey"
    FOREIGN KEY ("reportTypeId") REFERENCES "report_types"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'report_logs_generatedById_fkey'
      AND table_name = 'report_logs'
  ) THEN
    ALTER TABLE "report_logs"
    ADD CONSTRAINT "report_logs_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
