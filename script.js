const fs = require('fs');
const path = require('path');

function walkSync(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      walkSync(filepath, filelist);
    } else if (filepath.endsWith('.ts')) {
      filelist.push(filepath);
    }
  }
  return filelist;
}

const files = walkSync('d:\\seeakk code postgres\\seeakk\\backend\\src');
let changedFiles = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace { contains: variable } with { contains: variable, mode: 'insensitive' }
  content = content.replace(/contains:\s*([a-zA-Z0-9_.'"]+)(?![\s,]*mode)/g, "contains: $1, mode: 'insensitive'");

  if (content !== original) {
    fs.writeFileSync(file, content);
    changedFiles++;
    console.log('Updated:', file);
  }
}
console.log('Total files updated:', changedFiles);
