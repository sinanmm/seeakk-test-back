CREATE TABLE "sheets" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL DEFAULT 'BLANK',
  "columns" JSONB NOT NULL,
  "rows" JSONB NOT NULL,
  "formatting" JSONB,
  "metadata" JSONB,
  "originalSnapshot" JSONB,
  "autoSaveEnabled" BOOLEAN NOT NULL DEFAULT true,
  "lastAutoSavedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,
  CONSTRAINT "sheets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sheet_versions" (
  "id" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "columns" JSONB NOT NULL,
  "rows" JSONB NOT NULL,
  "formatting" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "sheet_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sheets_workspaceId_deletedAt_updatedAt_idx" ON "sheets"("workspaceId", "deletedAt", "updatedAt");
CREATE INDEX "sheets_workspaceId_name_idx" ON "sheets"("workspaceId", "name");
CREATE UNIQUE INDEX "sheet_versions_sheetId_version_key" ON "sheet_versions"("sheetId", "version");
CREATE INDEX "sheet_versions_workspaceId_sheetId_createdAt_idx" ON "sheet_versions"("workspaceId", "sheetId", "createdAt");

ALTER TABLE "sheets" ADD CONSTRAINT "sheets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sheet_versions" ADD CONSTRAINT "sheet_versions_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sheet_versions" ADD CONSTRAINT "sheet_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sheet_versions" ADD CONSTRAINT "sheet_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
