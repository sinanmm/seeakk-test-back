import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { ensureDefaultLeadStagesForWorkspace } from '../services/Seeding/seedingService';

dotenv.config();

const prisma = new PrismaClient() as any;

async function main() {
  const enforceStageFlagsOnExisting = process.argv.includes('--enforce-existing');
  const recreateDeletedDefaults = process.argv.includes('--recreate-deleted');

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (workspaces.length === 0) {
    console.log('No workspaces found. Nothing to backfill.');
    return;
  }

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const workspace of workspaces) {
    const { created, updated } = await ensureDefaultLeadStagesForWorkspace(workspace.id, workspace.ownerId || undefined, {
      enforceStageFlagsOnExisting,
      recreateDeletedDefaults,
    });
    totalCreated += created;
    totalUpdated += updated;
    console.log(
      `Workspace ${workspace.id}: created ${created} default stage(s), updated ${updated} stage flag set(s).`,
    );
  }

  console.log(
    `Backfill complete. Workspaces processed: ${workspaces.length}, stages created: ${totalCreated}, stages updated: ${totalUpdated}.`,
  );
}

main()
  .catch((error) => {
    console.error('Failed to backfill default lead stages:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
