import prisma from '../config/prisma';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Testing shared prisma client...');
  const count = await (prisma as any).permission.count();
  console.log('Count:', count);
}

main().catch(console.error).finally(() => process.exit());
