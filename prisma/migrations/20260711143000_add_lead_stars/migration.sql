CREATE TABLE IF NOT EXISTS "lead_stars" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "isStarred" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_stars_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_stars_workspaceId_userId_leadId_key"
  ON "lead_stars"("workspaceId", "userId", "leadId");

CREATE INDEX IF NOT EXISTS "lead_stars_workspaceId_userId_isStarred_idx"
  ON "lead_stars"("workspaceId", "userId", "isStarred");

CREATE INDEX IF NOT EXISTS "lead_stars_leadId_idx"
  ON "lead_stars"("leadId");

ALTER TABLE "lead_stars"
  ADD CONSTRAINT "lead_stars_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_stars"
  ADD CONSTRAINT "lead_stars_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_stars"
  ADD CONSTRAINT "lead_stars_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
