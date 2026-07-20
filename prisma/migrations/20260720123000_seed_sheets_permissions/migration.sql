INSERT INTO "permissions" ("id", "key", "group", "description", "createdAt")
VALUES
  (gen_random_uuid(), 'SHEETS_VIEW', 'SHEETS', 'View Sheets module and sheet files', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_CREATE', 'SHEETS', 'Create blank sheets and duplicate sheets', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_EDIT', 'SHEETS', 'Edit and save sheet cell values', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_DELETE', 'SHEETS', 'Delete sheets', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_IMPORT', 'SHEETS', 'Import CSV/XLS/XLSX files and lead exports into Sheets', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_EXPORT', 'SHEETS', 'Export sheets to CSV or Excel', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_SYNC_LEADS', 'SHEETS', 'Validate and synchronize sheet changes back to leads', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHEETS_FORMAT_MANAGE', 'SHEETS', 'Manage sheet formatting and layout', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET
  "group" = EXCLUDED."group",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE LOWER(TRIM(r."name")) = 'superadmin'
  AND p."key" IN (
    'SHEETS_VIEW',
    'SHEETS_CREATE',
    'SHEETS_EDIT',
    'SHEETS_DELETE',
    'SHEETS_IMPORT',
    'SHEETS_EXPORT',
    'SHEETS_SYNC_LEADS',
    'SHEETS_FORMAT_MANAGE'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
