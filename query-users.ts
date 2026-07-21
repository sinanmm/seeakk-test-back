import prisma from './src/config/prisma';
async function main() {
  const users = await prisma.user.findMany({
    where: { profileImageUrl: { not: null } },
    select: { id: true, name: true, profileImageUrl: true }
  });
  console.log(JSON.stringify(users, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
