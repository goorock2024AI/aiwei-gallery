#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  ['has picker list styling', '.pos-creative-picker-list'],
  ['has inline autocomplete list', 'id="rt-product-suggestions"'],
  ['loads shared autocomplete products', '_loadCreativePOSProducts'],
  ['uses fuzzy ordered matching', '_isCreativePOSSubsequence'],
  ['fills selected inline product', '_selectRetailProductSuggestion']
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

const context = {
  localStorage: { getItem: () => null },
  console,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(`${ui}\n;globalThis.__UI = UI;`, context);
const UI = context.__UI;
const fuzzyResults = UI._filterCreativePOSProducts([
  { id: 'cola', name: '可口可乐', _retailPrice: 3 },
  { id: 'coffee', name: '咖啡', _retailPrice: 18 },
  { id: 'bag', name: '帆布袋', _aliases: '环保袋', _retailPrice: 28 }
], '可乐');
if (fuzzyResults.length !== 1 || fuzzyResults[0].id !== 'cola') {
  console.error('[check:creative-pos-picker] “可乐” should match “可口可乐” through ordered fuzzy matching');
  process.exit(1);
}
const aliasResults = UI._filterCreativePOSProducts([
  { id: 'bag', name: '艾维托特包', _aliases: '帆布袋 环保袋', _retailPrice: 28 }
], '环保袋');
if (aliasResults.length !== 1 || aliasResults[0].id !== 'bag') {
  console.error('[check:creative-pos-picker] active aliases should match inline autocomplete');
  process.exit(1);
}

console.log('[check:creative-pos-picker] POS creative picker supports modal and inline fuzzy search, aliases, supplier filter, and unavailable-state visibility');
