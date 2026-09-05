const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'charts.js'), 'utf8');

function makeInput(value, checked) {
  return { value, checked };
}

const checkedInputs = [makeInput('门票', true), makeInput('画廊', false)];
const controls = {
  querySelectorAll(selector) {
    if (selector === 'input:checked') return checkedInputs.filter(input => input.checked);
    return [];
  }
};

const context = {
  console,
  document: {
    getElementById(id) {
      return id === 'revenue-compare-categories' ? controls : null;
    },
    querySelectorAll() {
      throw new Error('Selection should read from the live controls container');
    }
  },
  localStorage: {
    getItem() {
      return JSON.stringify(['门票', '画廊']);
    },
    setItem() {}
  },
  window: { innerWidth: 1200 },
  todayStr: () => '2026-08-22'
};

vm.createContext(context);
vm.runInContext(source, context);

const Charts = context.Charts;
const selected = Charts._getRevenueCompareSelection();
assert.deepStrictEqual(Array.from(selected), ['门票'], 'live checkbox state must override stale saved categories');

const current = {
  totals: [100, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  byCategory: {
    '门票': [100, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    '画廊': [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]
  }
};
const previous = {
  totals: [80, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
const datasets = Charts._buildRevenueComparisonDatasets('2026', selected, current, previous, {
  '门票': Charts._chartColors.revenue.ticket,
  '画廊': Charts._chartColors.revenue.gallery
});

assert.deepStrictEqual(
  Array.from(datasets.map(dataset => dataset.label)),
  ['2026年筛选合计', '门票', '2025年同口径合计'],
  'only selected categories should be rendered between the two total lines'
);
assert.deepStrictEqual(Array.from(datasets[0].data), current.totals, 'current monthly total line should use current totals');
assert.ok(!datasets.some(dataset => dataset.label === '画廊'), 'unchecked gallery line must not appear');

const grandDatasets = Charts._buildRevenueComparisonDatasets('2026', [], current, previous, {}, {
  includeGrandTotal: true,
  grandCurrent: current,
  grandPrevious: previous
});
assert.deepStrictEqual(
  Array.from(grandDatasets.map(dataset => dataset.label)),
  ['2026年总收入', '2025年同口径合计'],
  'grand total option should render a total line without an empty selected-total line'
);

console.log('revenue comparison chart checks passed');
