import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient() as any;

async function ensureSuperAdminRole() {
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'superadmin' },
    update: {
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
    },
    create: {
      name: 'superadmin',
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
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
  const superAdminRole = await ensureSuperAdminRole();

  const workspaceOwners = await prisma.workspace.findMany({
    select: { ownerId: true },
  });

  const ownerIds = [...new Set(workspaceOwners.map((workspace: { ownerId: string | null }) => workspace.ownerId).filter(Boolean))];

  if (ownerIds.length === 0) {
    console.log('No workspace owners found. Nothing to promote.');
    return;
  }

  const result = await prisma.user.updateMany({
    where: { id: { in: ownerIds } },
    data: { roleId: superAdminRole.id },
  });

  console.log(`Promoted ${result.count} workspace owner(s) to superadmin.`);
}

main()
  .catch((error) => {
    console.error('Failed to promote workspace owners:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
