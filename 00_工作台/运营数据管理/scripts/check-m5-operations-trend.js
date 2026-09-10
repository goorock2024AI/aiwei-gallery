const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;
dashboard._period = { year: '2026', month: '02' };

const model = dashboard._buildTrendModel('2026', [
  { periodMonth: '2026-01', businessLayerCode: 'visit', revenueAmount: 100, salesCostAmount: 20, periodCostAmount: 10, totalCostAmount: 30, grossProfit: 80, operatingContribution: 70 },
  { periodMonth: '2026-01', businessLayerCode: 'onsite_consumption', revenueAmount: 50, salesCostAmount: 10, periodCostAmount: 0, totalCostAmount: 10, grossProfit: 40, operatingContribution: 40 },
  { periodMonth: '2026-02', businessLayerCode: 'visit', revenueAmount: 200, salesCostAmount: 0, periodCostAmount: 50, totalCostAmount: 50, grossProfit: 200, operatingContribution: 150 },
  { periodMonth: '2025-12', businessLayerCode: 'visit', revenueAmount: 999, totalCostAmount: 999, grossProfit: 0, operatingContribution: 0 }
], [
  { date: '2026-01-05', netAmount: 100 },
  { date: '2026-01-20', netAmount: 75 },
  { date: '2026-02-03', amount: 180 },
  { date: '2025-12-20', netAmount: 999 }
]);

assert.equal(model.rows.length, 12);
assert.equal(model.rows[0].revenue, 150);
assert.equal(model.rows[0].totalCost, 40);
assert.equal(model.rows[0].legacyRevenue, 175);
assert.equal(model.rows[0].difference, -25);
assert.equal(model.rows[1].revenue, 200);
assert.equal(model.rows[1].legacyRevenue, 180);
assert.equal(model.rows[1].difference, 20);
assert.equal(model.rows[2].revenue, 0);
assert.equal(model.selected.period, '2026-02');
assert.deepEqual(model.totals, {
  revenue: 350, salesCost: 30, periodCost: 60, totalCost: 90,
  grossProfit: 320, contribution: 260, legacyRevenue: 355, difference: -5
});
assert.equal(model.hasData, true);
assert.equal(dashboard._signedMoney(-25), '−¥25.00');
assert.equal(dashboard._signedMoney(20), '+¥20.00');
assert.equal(dashboard._signedMoney(0), '¥0.00');
const html = dashboard._trendHtml(model);
assert.match(html, /operations-performance-chart/);
assert.match(html, /operations-definition-chart/);
assert.match(html, /data-trend-period="2026-02"/);
assert.match(html, /2\.0 使用四层业务明细/);

const empty = dashboard._buildTrendModel('2026', [], []);
assert.equal(empty.rows.length, 12);
assert.equal(empty.hasData, false);
assert.match(dashboard._trendHtml(empty), /2026 年暂无经营数据/);

console.log('PASS M5-04 trend model: 12 months, cross-layer totals, 1.0/2.0 differences, selected month and empty year');
