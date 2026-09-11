#!/usr/bin/env node
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const allowDirty = process.argv.includes('--allow-dirty');
const manifestPath = path.join(root, 'sql', 'm6-forward-manifest.json');
const outputPath = path.join(root, 'tmp', 'm6-07-release-candidate.json');
const requiredFiles = [
  'Dockerfile', 'docker-compose.yml', 'nginx.conf', 'server.js',
  'expense-entry.js', 'gallery-entry.js', 'space-entry.js',
  'governance-batches.js', 'trial-observability.js', 'VERSION', 'package.json',
  'app/index.html', 'app/js/app.js', 'app/js/supabase-config.js',
  'scripts/build-version.js', 'scripts/backup-db.sh', 'scripts/local-backup-db.ps1',
  'scripts/m6-07-restore-rehearsal.js', 'sql/m6-07-baseline.sql'
];
const distPairs = [
  ['app/index.html', 'dist/index.html'], ['app/css/style.css', 'dist/css/style.css'],
  ['app/js/app.js', 'dist/js/app.js'], ['app/js/charts.js', 'dist/js/charts.js'],
  ['app/js/models.js', 'dist/js/models.js'], ['app/js/auth.js', 'dist/js/auth.js'],
  ['app/js/operation-logger.js', 'dist/js/operation-logger.js'],
  ['app/js/operations-dashboard.js', 'dist/js/operations-dashboard.js'],
  ['app/js/ui.js', 'dist/js/ui.js'], ['app/js/import-export.js', 'dist/js/import-export.js']
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalSqlBytes(buffer) {
  return Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

for (const relative of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, relative)), `Missing release file: ${relative}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.forward.length, 20, 'Expected 20 forward migrations through M6-06');
assert.equal(manifest.rollback.length, 16, 'Expected 16 supported rollback migrations');
for (const entry of [manifest.baseline, ...manifest.forward, ...manifest.rollback]) {
  const file = path.join(root, entry.path);
  assert.ok(fs.existsSync(file), `Missing manifest file: ${entry.path}`);
  assert.equal(sha256(canonicalSqlBytes(fs.readFileSync(file))), entry.sha256, `Checksum mismatch: ${entry.path}`);
}

for (const [source, built] of distPairs) {
  assert.equal(sha256(fs.readFileSync(path.join(root, source))), sha256(fs.readFileSync(path.join(root, built))), `Static copy differs: ${source} -> ${built}`);
}

const status = git('status', '--porcelain');
if (!allowDirty) assert.equal(status, '', 'Release candidate requires a clean Git worktree');
const candidate = {
  generatedAt: new Date().toISOString(),
  version: fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(),
  commit: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  dirty: Boolean(status),
  manifest: {
    sha256: sha256(fs.readFileSync(manifestPath)),
    forwardCount: manifest.forward.length,
    rollbackCount: manifest.rollback.length,
    sqlChecksumsUseCanonicalLf: true
  },
  requiredFiles: Object.fromEntries(requiredFiles.map(relative => [relative, sha256(fs.readFileSync(path.join(root, relative)))]))
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(candidate, null, 2));
console.log(`PASS M6-07 release preflight: ${candidate.version}, ${candidate.manifest.forwardCount} forward, ${candidate.manifest.rollbackCount} rollback, dirty=${candidate.dirty}`);
console.log(outputPath);
