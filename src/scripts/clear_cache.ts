import { createClient } from 'redis';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const client = createClient({
    url: process.env.REDIS_URL
  });
  await client.connect();

  const keys = await client.keys('role_permissions:*');
  console.log(`Found ${keys.length} permission cache keys. Deleting...`);
  
  if (keys.length > 0) {
    await client.del(keys);
  }

  console.log('Cache cleared!');
  await client.disconnect();
}

main().catch(console.error);
