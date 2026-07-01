DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'LOBReasonStatus'
  ) THEN
    CREATE TYPE "LOBReasonStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lob_reasons" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "status" "LOBReasonStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "lob_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lob_reasons_workspaceId_idx"
ON "lob_reasons"("workspaceId");

CREATE INDEX IF NOT EXISTS "lob_reasons_status_idx"
ON "lob_reasons"("status");

CREATE INDEX IF NOT EXISTS "lob_reasons_workspaceId_status_createdAt_idx"
ON "lob_reasons"("workspaceId", "status", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_lob_reason_name_per_workspace"
ON "lob_reasons"("workspaceId", LOWER("name"))
WHERE "deletedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'lob_reasons_workspaceId_fkey'
      AND table_name = 'lob_reasons'
  ) THEN
    ALTER TABLE "lob_reasons"
    ADD CONSTRAINT "lob_reasons_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'lob_reasons_createdById_fkey'
      AND table_name = 'lob_reasons'
  ) THEN
    ALTER TABLE "lob_reasons"
    ADD CONSTRAINT "lob_reasons_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'lob_reasons_updatedById_fkey'
      AND table_name = 'lob_reasons'
  ) THEN
    ALTER TABLE "lob_reasons"
    ADD CONSTRAINT "lob_reasons_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
