UPDATE "users"
SET "isOnboarded" = true
WHERE "workspaceId" IS NOT NULL
  AND "isOnboarded" = false
  AND "isActive" = true
  AND "password" IS NOT NULL
  AND "deletedAt" IS NULL;
