const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
}

if (!envContent.includes('DIRECT_URL=') && process.env.DATABASE_URL) {
  const directUrl = process.env.DATABASE_URL.replace('-pooler', '');
  fs.appendFileSync(envPath, `\nDIRECT_URL=${directUrl}\n`);
  console.log('Successfully injected DIRECT_URL into .env for Prisma migrations.');
}
