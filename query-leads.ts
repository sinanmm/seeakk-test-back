import prisma from './src/config/prisma';
async function main() {
  const leads = await prisma.lead.findMany({
    where: { profileImageUrl: { not: null } },
    select: { id: true, name: true, profileImageUrl: true }
  });
  console.log(JSON.stringify(leads, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
