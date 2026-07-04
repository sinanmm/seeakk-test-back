const fs = require('fs');
const path = require('path');

const prismaDir = path.join(__dirname, '..', 'node_modules', '.prisma');
const clientDir = path.join(prismaDir, 'client');
const staleDir = path.join(prismaDir, 'stale-engines');

if (!fs.existsSync(prismaDir)) {
  process.exit(0);
}

if (!fs.existsSync(staleDir)) {
  fs.mkdirSync(staleDir, { recursive: true });
}

// 1. Move any locked .node or .tmp files to staleDir
if (fs.existsSync(clientDir)) {
  const files = fs.readdirSync(clientDir);
  for (const file of files) {
    if (file.includes('query_engine') || file.includes('.node') || file.includes('.tmp')) {
      const oldPath = path.join(clientDir, file);
      try {
        fs.unlinkSync(oldPath);
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          const newPath = path.join(staleDir, `${file}.${Date.now()}.stale`);
          try {
            fs.renameSync(oldPath, newPath);
            console.log(`Moved locked file to safely allow generation: ${file}`);
          } catch (renameErr) {
            console.warn(`Could not move locked file ${file}:`, renameErr.message);
          }
        }
      }
    }
  }
}

// 2. Safely remove stale directory contents if they are no longer locked
try {
  const staleFiles = fs.readdirSync(staleDir);
  for (const file of staleFiles) {
    try {
      fs.unlinkSync(path.join(staleDir, file));
    } catch (e) {
      // Still locked, ignore
    }
  }
} catch (e) {}

// 3. Now try to remove the clientDir if it exists, so Prisma generates a fresh one
if (fs.existsSync(clientDir)) {
  try {
    fs.rmSync(clientDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Could not completely remove clientDir:`, err.message);
  }
}

console.log('Prisma cleanup completed successfully.');
