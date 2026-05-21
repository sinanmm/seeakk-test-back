import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true
            }
          }
        }
      }
    }
  });

  console.log(`Found ${users.length} active users.`);
  for (const user of users) {
    const roleName = user.role?.name || 'No Role';
    const permissionKeys = user.role?.permissions.map((p: any) => p.permission.key) || [];
    console.log(`User: ${user.name} (${user.email}) | Role: ${roleName}`);
    console.log(`Permissions (${permissionKeys.length}):`, permissionKeys);
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
