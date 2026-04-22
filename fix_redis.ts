import dotenv from 'dotenv';
dotenv.config();

import { createClient } from 'redis';

async function fix() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = createClient({ url });
  
  client.on('error', (err) => console.log('Redis Client Error', err));
  
  try {
    await client.connect();
    await client.configSet('maxmemory-policy', 'noeviction');
    console.log('Successfully updated maxmemory-policy to noeviction');
  } catch (err) {
    console.error('Failed to configure redis:', err);
  } finally {
    await client.quit();
  }
}

fix();
