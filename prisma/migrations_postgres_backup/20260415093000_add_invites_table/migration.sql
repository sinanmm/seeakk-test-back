CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");
CREATE INDEX "invites_workspaceId_userId_idx" ON "invites"("workspaceId", "userId");
CREATE INDEX "invites_workspaceId_createdBy_idx" ON "invites"("workspaceId", "createdBy");
CREATE INDEX "invites_workspaceId_expiresAt_idx" ON "invites"("workspaceId", "expiresAt");
CREATE INDEX "invites_workspaceId_usedAt_idx" ON "invites"("workspaceId", "usedAt");

ALTER TABLE "invites"
ADD CONSTRAINT "invites_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invites"
ADD CONSTRAINT "invites_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invites"
ADD CONSTRAINT "invites_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
