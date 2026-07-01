DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'LeadClosureType'
  ) THEN
    CREATE TYPE "LeadClosureType" AS ENUM ('WON', 'LOST', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "generatedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedById" TEXT,
  ADD COLUMN IF NOT EXISTS "closureType" "LeadClosureType";

CREATE INDEX IF NOT EXISTS "leads_isClosed_idx"
ON "leads"("isClosed");

CREATE INDEX IF NOT EXISTS "leads_workspaceId_isClosed_idx"
ON "leads"("workspaceId", "isClosed");

CREATE INDEX IF NOT EXISTS "leads_closureType_idx"
ON "leads"("closureType");

CREATE INDEX IF NOT EXISTS "leads_closedAt_idx"
ON "leads"("closedAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'leads_closedById_fkey'
      AND table_name = 'leads'
  ) THEN
    ALTER TABLE "leads"
    ADD CONSTRAINT "leads_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
