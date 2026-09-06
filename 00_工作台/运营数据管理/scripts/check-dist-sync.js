#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const pairs = [
  ['app/index.html', 'dist/index.html'],
  ['app/css/style.css', 'dist/css/style.css'],
  ['app/js/app.js', 'dist/js/app.js'],
  ['app/js/models.js', 'dist/js/models.js'],
  ['app/js/auth.js', 'dist/js/auth.js'],
  ['app/js/ui.js', 'dist/js/ui.js'],
  ['app/js/import-export.js', 'dist/js/import-export.js']
];

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const mismatches = [];
for (const [srcRel, distRel] of pairs) {
  const src = path.join(root, srcRel);
  const dist = path.join(root, distRel);
  if (!fs.existsSync(src) || !fs.existsSync(dist)) {
    mismatches.push(`${srcRel} -> ${distRel}: missing file`);
    continue;
  }
  if (hash(src) !== hash(dist)) {
    mismatches.push(`${srcRel} -> ${distRel}: content differs`);
  }
}

if (mismatches.length) {
  console.error('[check:dist-sync] app/dist mismatch:');
  mismatches.forEach(m => console.error(`- ${m}`));
  process.exit(1);
}

console.log('[check:dist-sync] app/dist key files are in sync');
