import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;
  
  const users = await prisma.user.findMany({
    where: { profileImageUrl: { contains: 's3.wasabisys.com/seeakk-files' } }
  });

  for (const user of users) {
    if (user.profileImageUrl) {
      const urlObj = new URL(user.profileImageUrl);
      // The pathname will be "/seeakk-files/Seeak%20App%20Data/..."
      // We want to extract the key "Seeak App Data/..."
      let key = decodeURIComponent(urlObj.pathname).replace('/seeakk-files/', '');
      
      const newUrl = `${backendUrl}/api/upload/${encodeURIComponent(key)}`;
      await prisma.user.update({
        where: { id: user.id },
        data: { profileImageUrl: newUrl }
      });
      console.log(`Updated user ${user.id} to ${newUrl}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
