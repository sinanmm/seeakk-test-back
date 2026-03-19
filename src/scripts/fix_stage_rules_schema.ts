import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const migrationFiles = [
  path.resolve(__dirname, '../../../prisma/migrations/20260318103000_refactor_stage_rules_dynamic_engine/migration.sql'),
  path.resolve(__dirname, '../../../prisma/migrations/20260318121500_stage_rules_safe_defaults/migration.sql'),
];

const run = async () => {
  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();
  try {
    console.log('Connected. Applying Stage Rules schema fixes...');

    for (const file of migrationFiles) {
      if (!fs.existsSync(file)) {
        console.log(`Skipping missing migration file: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`Applying: ${path.basename(path.dirname(file))}`);
      await client.query(sql);
      console.log(`Applied: ${path.basename(path.dirname(file))}`);
    }

    const check = await client.query<{
      column_name: string;
    }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stage_rules'
      `,
    );

    const cols = new Set(check.rows.map((r) => r.column_name));
    const required = ['name', 'inputType', 'sortOrder', 'required', 'status', 'updatedAt'];
    const missing = required.filter((c) => !cols.has(c));

    if (missing.length > 0) {
      throw new Error(`Stage rules schema still incomplete. Missing columns: ${missing.join(', ')}`);
    }

    console.log('Stage Rules schema is ready.');
  } finally {
    await client.end();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to fix Stage Rules schema:', error);
    process.exit(1);
  });

