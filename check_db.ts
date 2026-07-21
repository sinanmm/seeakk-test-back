import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user1 = await prisma.user.findUnique({ where: { id: 'cmrg82p0l000guxvwsl2ms5zb' }, select: { profileImageUrl: true } });
  const user2 = await prisma.user.findUnique({ where: { id: 'cmrjbekak000k79cv1mx1gjk4' }, select: { profileImageUrl: true } });
  console.log('User 1:', user1);
  console.log('User 2:', user2);
}
main().catch(console.error).finally(() => prisma.$disconnect());
