#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/css/style.css'), 'utf8');

const checks = [
  ['loads creative products', "Store.getAll('creativeProducts')"],
  ['loads sales history for hot keywords', "Store.getAll('revenue')"],
  ['has hot keyword chips', 'cp-hot-chip'],
  ['hot keyword applies search', '_applyCreativePOSKeyword'],
  ['shows unavailable reason', 'cp-select-reason'],
  ['keeps unavailable products visible as disabled', 'is-disabled'],
  ['has supplier filter', 'id="cp-supplier-pos"'],
  ['has picker list styling', '.pos-creative-picker-list']
];

const failures = checks.filter(([, needle]) => !ui.includes(needle) && !css.includes(needle));

if (failures.length) {
  console.error('[check:creative-pos-picker] missing expected picker behavior:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

const removedSilentFilter = !ui.includes('const available = products.filter(p => (p.stock || 0) > 0 && (p.retailPrice || 0) > 0)');
if (!removedSilentFilter) {
  console.error('[check:creative-pos-picker] POS picker still silently filters imported products');
  process.exit(1);
}

if (ui.includes('id="cp-stock-pos"')) {
  console.error('[check:creative-pos-picker] POS picker should stay simple and not render a stock filter');
  process.exit(1);
}

console.log('[check:creative-pos-picker] POS creative picker supports search, supplier filter, hot keywords, and unavailable-state visibility');
