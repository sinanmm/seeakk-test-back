CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "expectedRevenue" DOUBLE PRECISION,
    "assignedToId" TEXT,
    "stageId" TEXT,
    "lifecycleId" TEXT,
    "sourceId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "isLOB" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_lob_logs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "remarks" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "lead_lob_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "leads_workspaceId_assignedToId_stageId_idx"
ON "leads"("workspaceId", "assignedToId", "stageId");

CREATE INDEX IF NOT EXISTS "leads_workspaceId_sourceId_createdAt_idx"
ON "leads"("workspaceId", "sourceId", "createdAt");

CREATE INDEX IF NOT EXISTS "leads_workspaceId_deletedAt_idx"
ON "leads"("workspaceId", "deletedAt");

CREATE INDEX IF NOT EXISTS "leads_workspaceId_isLOB_isClosed_idx"
ON "leads"("workspaceId", "isLOB", "isClosed");

CREATE INDEX IF NOT EXISTS "leads_nextFollowUpAt_idx"
ON "leads"("nextFollowUpAt");

CREATE INDEX IF NOT EXISTS "lead_lob_logs_leadId_changedAt_idx"
ON "lead_lob_logs"("leadId", "changedAt");

CREATE INDEX IF NOT EXISTS "lead_lob_logs_workspaceId_reasonId_idx"
ON "lead_lob_logs"("workspaceId", "reasonId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_assignedToId_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_stageId_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_stageId_fkey"
        FOREIGN KEY ("stageId") REFERENCES "lead_stages"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_lifecycleId_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_lifecycleId_fkey"
        FOREIGN KEY ("lifecycleId") REFERENCES "lead_life_cycles"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_sourceId_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_sourceId_fkey"
        FOREIGN KEY ("sourceId") REFERENCES "lead_sources"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_workspaceId_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'leads_createdById_fkey'
          AND table_name = 'leads'
    ) THEN
        ALTER TABLE "leads"
        ADD CONSTRAINT "leads_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'lead_lob_logs_leadId_fkey'
          AND table_name = 'lead_lob_logs'
    ) THEN
        ALTER TABLE "lead_lob_logs"
        ADD CONSTRAINT "lead_lob_logs_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "leads"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'follow_ups_leadId_fkey'
          AND table_name = 'follow_ups'
    ) THEN
        ALTER TABLE "follow_ups"
        ADD CONSTRAINT "follow_ups_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "leads"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
