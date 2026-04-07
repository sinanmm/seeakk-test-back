import 'dotenv/config';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const statements = [
  `
  CREATE TABLE IF NOT EXISTS "countries" (
      "id" TEXT NOT NULL,
      "workspaceId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "code" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdById" TEXT,
      "updatedById" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deletedAt" TIMESTAMP(3),

      CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS "location_levels" (
      "id" TEXT NOT NULL,
      "workspaceId" TEXT NOT NULL,
      "countryId" TEXT NOT NULL,
      "levelName" TEXT NOT NULL,
      "levelOrder" INTEGER NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdById" TEXT,
      "updatedById" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "location_levels_pkey" PRIMARY KEY ("id")
  );
  `,
  `
  ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "countryId" TEXT,
  ADD COLUMN IF NOT EXISTS "levelId" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
  `,
  `CREATE INDEX IF NOT EXISTS "countries_workspaceId_idx" ON "countries"("workspaceId");`,
  `CREATE INDEX IF NOT EXISTS "countries_workspaceId_isActive_createdAt_idx" ON "countries"("workspaceId", "isActive", "createdAt" DESC);`,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS "countries_workspaceId_name_active_key"
  ON "countries"("workspaceId", "name")
  WHERE "deletedAt" IS NULL;
  `,
  `CREATE INDEX IF NOT EXISTS "location_levels_workspaceId_idx" ON "location_levels"("workspaceId");`,
  `CREATE INDEX IF NOT EXISTS "location_levels_countryId_isActive_levelOrder_idx" ON "location_levels"("countryId", "isActive", "levelOrder");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "location_levels_countryId_levelOrder_key" ON "location_levels"("countryId", "levelOrder");`,
  `CREATE INDEX IF NOT EXISTS "locations_countryId_idx" ON "locations"("countryId");`,
  `CREATE INDEX IF NOT EXISTS "locations_levelId_idx" ON "locations"("levelId");`,
  `CREATE INDEX IF NOT EXISTS "locations_workspaceId_countryId_levelId_isActive_idx" ON "locations"("workspaceId", "countryId", "levelId", "isActive");`,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'countries_workspaceId_fkey') THEN
      ALTER TABLE "countries"
      ADD CONSTRAINT "countries_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'countries_createdById_fkey') THEN
      ALTER TABLE "countries"
      ADD CONSTRAINT "countries_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'countries_updatedById_fkey') THEN
      ALTER TABLE "countries"
      ADD CONSTRAINT "countries_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_levels_workspaceId_fkey') THEN
      ALTER TABLE "location_levels"
      ADD CONSTRAINT "location_levels_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_levels_countryId_fkey') THEN
      ALTER TABLE "location_levels"
      ADD CONSTRAINT "location_levels_countryId_fkey"
      FOREIGN KEY ("countryId") REFERENCES "countries"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_levels_createdById_fkey') THEN
      ALTER TABLE "location_levels"
      ADD CONSTRAINT "location_levels_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_levels_updatedById_fkey') THEN
      ALTER TABLE "location_levels"
      ADD CONSTRAINT "location_levels_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_countryId_fkey') THEN
      ALTER TABLE "locations"
      ADD CONSTRAINT "locations_countryId_fkey"
      FOREIGN KEY ("countryId") REFERENCES "countries"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_levelId_fkey') THEN
      ALTER TABLE "locations"
      ADD CONSTRAINT "locations_levelId_fkey"
      FOREIGN KEY ("levelId") REFERENCES "location_levels"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;
  `,
];

const main = async () => {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();

  try {
    for (const statement of statements) {
      await client.query(statement);
    }

    console.log('Locations schema applied successfully.');
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('Failed to apply locations schema:', error);
  process.exit(1);
});
