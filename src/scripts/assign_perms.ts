import { PrismaClient } from '../../prisma/generated/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient() as any;

async function main() {
  const roles = await prisma.role.findMany();
  console.log('Roles in system:', JSON.stringify(roles, null, 2));

  const adminRole = roles.find((r: any) => r.name.toLowerCase().includes('admin'));
  if (adminRole) {
    console.log(`Found admin role: ${adminRole.name} (${adminRole.id})`);
    
    const allPermissions = await prisma.permission.findMany();
    console.log(`Assigning ${allPermissions.length} permissions to ${adminRole.name}...`);

    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      });
    }
    console.log('Done!');
  } else {
    console.log('No admin role found to assign permissions to.');
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
