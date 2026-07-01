-- Phase 1: extend the schema without immediately breaking live reads/writes.
ALTER TABLE "roles" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "roles" ADD COLUMN "isSystemRole" BOOLEAN NOT NULL DEFAULT false;

-- The old global uniqueness on role name must be removed before workspace-scoped roles can coexist.
DROP INDEX IF EXISTS "roles_name_key";

-- Ensure workspace owners are linked to their workspace before we repoint superadmin roles.
UPDATE "users" u
SET "workspaceId" = w."id"
FROM "workspaces" w
WHERE u."id" = w."ownerId"
  AND u."workspaceId" IS NULL;

-- Clone every non-superadmin legacy role into the workspaces where it is actually used or owned.
CREATE TEMP TABLE "_role_workspace_targets" AS
SELECT DISTINCT
  r."id" AS "sourceRoleId",
  u."workspaceId" AS "workspaceId",
  r."name" AS "name",
  r."status" AS "status",
  r."description" AS "description",
  r."createdBy" AS "createdBy",
  false AS "isSystemRole",
  r."createdAt" AS "createdAt",
  r."updatedAt" AS "updatedAt"
FROM "roles" r
JOIN "users" u ON u."roleId" = r."id"
WHERE u."workspaceId" IS NOT NULL
  AND lower(regexp_replace(r."name", '[\s_-]+', '', 'g')) <> 'superadmin'

UNION

SELECT DISTINCT
  r."id" AS "sourceRoleId",
  creator."workspaceId" AS "workspaceId",
  r."name" AS "name",
  r."status" AS "status",
  r."description" AS "description",
  r."createdBy" AS "createdBy",
  false AS "isSystemRole",
  r."createdAt" AS "createdAt",
  r."updatedAt" AS "updatedAt"
FROM "roles" r
JOIN "users" creator ON creator."id" = r."createdBy"
WHERE creator."workspaceId" IS NOT NULL
  AND lower(regexp_replace(r."name", '[\s_-]+', '', 'g')) <> 'superadmin';

INSERT INTO "roles" (
  "id",
  "workspaceId",
  "name",
  "status",
  "description",
  "createdBy",
  "isSystemRole",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(t."sourceRoleId" || ':' || t."workspaceId"),
  t."workspaceId",
  t."name",
  t."status",
  t."description",
  t."createdBy",
  t."isSystemRole",
  t."createdAt",
  t."updatedAt"
FROM "_role_workspace_targets" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "roles" existing
  WHERE existing."workspaceId" = t."workspaceId"
    AND existing."name" = t."name"
);

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT
  cloned."id",
  rp."permissionId"
FROM "_role_workspace_targets" t
JOIN "roles" cloned
  ON cloned."workspaceId" = t."workspaceId"
 AND cloned."name" = t."name"
JOIN "role_permissions" rp
  ON rp."roleId" = t."sourceRoleId"
ON CONFLICT DO NOTHING;

UPDATE "users" u
SET "roleId" = cloned."id"
FROM "_role_workspace_targets" t
JOIN "roles" cloned
  ON cloned."workspaceId" = t."workspaceId"
 AND cloned."name" = t."name"
WHERE u."roleId" = t."sourceRoleId"
  AND u."workspaceId" = t."workspaceId";

DROP TABLE "_role_workspace_targets";

-- Guarantee one workspace-scoped superadmin role per workspace.
INSERT INTO "roles" (
  "id",
  "workspaceId",
  "name",
  "status",
  "description",
  "createdBy",
  "isSystemRole",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('superadmin:' || w."id"),
  w."id",
  'superadmin',
  'ACTIVE',
  'Workspace Owner with full system access',
  w."ownerId",
  true,
  NOW(),
  NOW()
FROM "workspaces" w
WHERE NOT EXISTS (
  SELECT 1
  FROM "roles" existing
  WHERE existing."workspaceId" = w."id"
    AND lower(regexp_replace(existing."name", '[\s_-]+', '', 'g')) = 'superadmin'
);

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT
  superadmin_role."id",
  p."id"
FROM "roles" superadmin_role
JOIN "permissions" p ON TRUE
WHERE lower(regexp_replace(superadmin_role."name", '[\s_-]+', '', 'g')) = 'superadmin'
  AND superadmin_role."workspaceId" IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "users" u
SET
  "roleId" = superadmin_role."id",
  "workspaceId" = w."id"
FROM "workspaces" w
JOIN "roles" superadmin_role
  ON superadmin_role."workspaceId" = w."id"
 AND lower(regexp_replace(superadmin_role."name", '[\s_-]+', '', 'g')) = 'superadmin'
WHERE u."id" = w."ownerId";

-- Remove leftover legacy global roles after all user pointers and permissions have been migrated.
DELETE FROM "role_permissions"
WHERE "roleId" IN (
  SELECT "id"
  FROM "roles"
  WHERE "workspaceId" IS NULL
);

DELETE FROM "roles"
WHERE "workspaceId" IS NULL;

-- Phase 2: enforce the new tenant-safe invariants.
ALTER TABLE "roles"
  ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "roles_workspaceId_name_key" ON "roles"("workspaceId", "name");
CREATE INDEX "roles_workspaceId_idx" ON "roles"("workspaceId");
CREATE INDEX "roles_workspaceId_status_idx" ON "roles"("workspaceId", "status");
