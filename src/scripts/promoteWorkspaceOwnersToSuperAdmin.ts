import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient() as any;

async function ensureSuperAdminRole(workspaceId: string) {
  const superAdminRole = await prisma.role.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: 'superadmin',
      },
    },
    update: {
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
    create: {
      workspaceId,
      name: 'superadmin',
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
  });

  const permissions = await prisma.permission.findMany({
    select: { id: true },
  });

  if (permissions.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission: { id: string }) => ({
        roleId: superAdminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  return superAdminRole;
}

async function main() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, ownerId: true },
  });

  if (workspaces.length === 0) {
    console.log('No workspace owners found. Nothing to promote.');
    return;
  }

  let promoted = 0;
  for (const workspace of workspaces) {
    const superAdminRole = await ensureSuperAdminRole(workspace.id);
    const result = await prisma.user.updateMany({
      where: {
        id: workspace.ownerId,
      },
      data: {
        roleId: superAdminRole.id,
        workspaceId: workspace.id,
      },
    });

    promoted += result.count;
  }

  console.log(`Promoted ${promoted} workspace owner(s) to workspace-scoped superadmin.`);
}

main()
  .catch((error) => {
    console.error('Failed to promote workspace owners:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
