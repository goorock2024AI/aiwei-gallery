const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;

const model = dashboard._buildOverviewModel([
  {
    businessLayerCode: 'visit', revenueAmount: 100, salesCostAmount: 10,
    periodCostAmount: 20, totalCostAmount: 30, grossProfit: 90,
    grossMargin: 0.9, operatingContribution: 70
  },
  {
    businessLayerCode: 'onsite_consumption', revenueAmount: 50, salesCostAmount: 20,
    periodCostAmount: 0, totalCostAmount: 20, grossProfit: 30,
    grossMargin: 0.6, operatingContribution: 30
  }
], [
  { issueType: 'unclassified_revenue', issueCount: 2, affectedAmount: 25 },
  { issueType: 'unclassified_cost', issueCount: 1, affectedAmount: 5 },
  { issueType: 'missing_product_cost', issueCount: 4, affectedAmount: 999 }
]);

assert.equal(model.layers.length, 4);
assert.deepEqual(model.layers.map(layer => layer.code), [
  'visit', 'onsite_consumption', 'experience_activity', 'art_transaction_cooperation'
]);
assert.deepEqual(model.totals, {
  revenue: 150, salesCost: 30, periodCost: 20, totalCost: 50, grossProfit: 120, contribution: 100
});
assert.deepEqual(model.pendingRevenue, { count: 2, amount: 25 });
assert.deepEqual(model.pendingCost, { count: 1, amount: 5 });
assert.equal(model.pendingCount, 3);
assert.equal(model.pendingImpact, 30);
assert.equal(model.layers[2].grossMargin, null);
assert.equal(dashboard._margin(model.layers[2].grossMargin), '—');
assert.equal(dashboard._margin(0), '0.0%');
assert.match(dashboard._overviewHtml(model), /¥150\.00/);
assert.match(dashboard._overviewHtml(model), /待归类影响/);
assert.match(dashboard._layersHtml(model), /data-layer="art_transaction_cooperation"/);

const empty = dashboard._buildOverviewModel([], []);
assert.equal(empty.layers.length, 4);
assert.equal(empty.hasPeriodRows, false);
assert.equal(empty.hasBusinessValues, false);
assert.match(dashboard._overviewHtml(empty), /本期间暂无经营事实/);
assert.equal((dashboard._layersHtml(empty).match(/>—<\/td>/g) || []).length, 4);

console.log('PASS M5-03 overview model: totals, four fixed layers, pending impact, zero/null and empty-period rules');
