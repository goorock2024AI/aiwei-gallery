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
  'space-contract-profiles.js','space-project-workflow.js','space-contract-document.js','space-accounting.js','templates/space-contract-v1.json','app/js/space-project-schema.js','app/js/space-projects.js','sql/20261025_space_project_workflow.sql',
  'coffee-forecast.js', 'coffee-inventory.js', 'app/js/inventory-inbox.js', 'app/css/inventory-inbox.css',
  'Dockerfile', 'docker-compose.yml', 'nginx.conf', 'server.js',
  'expense-entry.js', 'expense-pdf-entry.js', 'gallery-entry.js', 'space-entry.js',
  'governance-batches.js', 'operations-item-analysis.js', 'trial-observability.js', 'VERSION', 'package.json',
  'app/js/operations-item-analysis.js',
  'app/js/operations-business-analysis.js',
  'app/js/visitor-analysis.js',
  'operations-reports.js', 'operations-report-metrics.js', 'operations-report-html.js', 'scripts/operations-report-workflow.js', 'app/operations-report.html', 'app/js/operations-report-center.js', 'app/js/operations-report-page.js', 'app/js/operations-report-layout.js',
  'app/index.html', 'app/js/app.js', 'app/js/supabase-config.js',
  'scripts/build-version.js', 'scripts/backup-db.sh', 'scripts/local-backup-db.ps1',
  'scripts/m6-07-restore-rehearsal.js', 'sql/m6-07-baseline.sql'
];
const distPairs = [
  ['app/js/space-project-schema.js','dist/js/space-project-schema.js'],['app/js/space-projects.js','dist/js/space-projects.js'],['app/css/space-projects.css','dist/css/space-projects.css'],
  ['app/js/inventory-inbox.js', 'dist/js/inventory-inbox.js'],
  ['app/css/inventory-inbox.css', 'dist/css/inventory-inbox.css'],
  ['app/js/operations-report-layout.js', 'dist/js/operations-report-layout.js'],
  ['app/operations-report.html', 'dist/operations-report.html'], ['app/js/operations-report-center.js', 'dist/js/operations-report-center.js'], ['app/js/operations-report-page.js', 'dist/js/operations-report-page.js'],
  ['app/analysis.html', 'dist/analysis.html'], ['app/js/analysis-page.js', 'dist/js/analysis-page.js'],
  ['app/index.html', 'dist/index.html'], ['app/css/style.css', 'dist/css/style.css'],
  ['app/js/app.js', 'dist/js/app.js'], ['app/js/charts.js', 'dist/js/charts.js'],
  ['app/js/models.js', 'dist/js/models.js'], ['app/js/auth.js', 'dist/js/auth.js'],
  ['app/js/operation-logger.js', 'dist/js/operation-logger.js'],
  ['app/js/operations-dashboard.js', 'dist/js/operations-dashboard.js'],
  ['app/js/operations-item-analysis.js', 'dist/js/operations-item-analysis.js'],
  ['app/js/operations-business-analysis.js', 'dist/js/operations-business-analysis.js'],
  ['app/js/visitor-analysis.js', 'dist/js/visitor-analysis.js'],
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
assert.equal(manifest.forward.length, 28, 'Expected 28 forward migrations including space project workflow');
assert.equal(manifest.rollback.length, 24, 'Expected 24 supported rollback migrations');
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
