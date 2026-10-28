#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const pairs = [
  ['app/js/space-quick-rental.js','dist/js/space-quick-rental.js'],
  ['app/js/space-project-schema.js','dist/js/space-project-schema.js'],['app/js/space-projects.js','dist/js/space-projects.js'],['app/css/space-projects.css','dist/css/space-projects.css'],
  ['app/js/space-execution.js','dist/js/space-execution.js'],
  ['app/js/operations-report-hub.js','dist/js/operations-report-hub.js'],['app/css/operations-report-hub.css','dist/css/operations-report-hub.css'],
  ['app/weekly-management.html', 'dist/weekly-management.html'], ['app/js/weekly-management-page.js', 'dist/js/weekly-management-page.js'],
  ['app/daily-brief.html', 'dist/daily-brief.html'], ['app/js/daily-brief-page.js', 'dist/js/daily-brief-page.js'],
  ['app/js/inventory-inbox.js', 'dist/js/inventory-inbox.js'],
  ['app/css/inventory-inbox.css', 'dist/css/inventory-inbox.css'],
  ['app/operations-report.html', 'dist/operations-report.html'], ['app/js/operations-report-center.js', 'dist/js/operations-report-center.js'], ['app/js/operations-report-page.js', 'dist/js/operations-report-page.js'], ['app/js/operations-report-layout.js', 'dist/js/operations-report-layout.js'],
  ['app/analysis.html', 'dist/analysis.html'], ['app/js/analysis-page.js', 'dist/js/analysis-page.js'],
  ['app/index.html', 'dist/index.html'],
  ['app/css/style.css', 'dist/css/style.css'],
  ['app/js/app.js', 'dist/js/app.js'],
  ['app/js/charts.js', 'dist/js/charts.js'],
  ['app/js/models.js', 'dist/js/models.js'],
  ['app/js/auth.js', 'dist/js/auth.js'],
  ['app/js/operation-logger.js', 'dist/js/operation-logger.js'],
  ['app/js/operations-dashboard.js', 'dist/js/operations-dashboard.js'],
  ['app/js/operations-item-analysis.js', 'dist/js/operations-item-analysis.js'],
  ['app/js/visitor-analysis.js', 'dist/js/visitor-analysis.js'],
  ['app/js/operations-business-analysis.js', 'dist/js/operations-business-analysis.js'],
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
