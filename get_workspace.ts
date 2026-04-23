import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ws = await prisma.workspace.findFirst();
  console.log(ws?.id);
}
main().catch(console.error).finally(() => prisma.$disconnect());
