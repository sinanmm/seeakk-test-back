import prisma from './src/config/prisma';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadUserProfileImage } from './src/services/User/userProfileImageService';
import * as dotenv from 'dotenv';
dotenv.config();

const s3Client = new S3Client({
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY || '',
    secretAccessKey: process.env.WASABI_SECRET_KEY || '',
  },
});

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function migrateUserImages() {
  const users = await prisma.user.findMany({
    where: { profileImageUrl: { not: null } }
  });

  for (const user of users) {
    if (!user.profileImageUrl) continue;
    
    if (user.profileImageUrl.includes('wasabisys.com') || user.profileImageUrl.includes('localhost') || user.profileImageUrl.includes('Seeak App Data')) {
      console.log(`Migrating user ${user.id} - ${user.name}`);
      
      let key = '';
      if (user.profileImageUrl.startsWith('Seeak')) {
          key = user.profileImageUrl;
      } else if (user.profileImageUrl.includes('wasabisys.com')) {
          const match = user.profileImageUrl.match(/seeakk-files\/(.*)$/);
          if (match && match[1]) key = decodeURIComponent(match[1]);
      } else if (user.profileImageUrl.includes('localhost')) {
          const match = user.profileImageUrl.match(/api\/upload\/(.*)$/);
          if (match && match[1]) key = decodeURIComponent(match[1]);
      }
      
      if (!key) {
        console.log(`Could not extract key from ${user.profileImageUrl}`);
        continue;
      }
      
      try {
        console.log(`Downloading key: ${key}`);
        const command = new GetObjectCommand({
          Bucket: 'geniusgroup',
          Key: key
        });
        const response = await s3Client.send(command);
        const buffer = await streamToBuffer(response.Body);
        
        const mockFile = {
            buffer,
            mimetype: response.ContentType || 'image/jpeg',
            originalname: 'migrated.jpg'
        } as any;
        
        await uploadUserProfileImage(user.id, mockFile);
        console.log(`Successfully migrated user ${user.id}`);
      } catch (err: any) {
        console.error(`Failed to migrate user ${user.id}:`, err.message);
      }
    }
  }
}

migrateUserImages().then(() => {
    console.log('Migration complete');
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
