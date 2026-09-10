const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;

const model = dashboard._buildGovernanceModel('2026-09', [
  { issueType: 'unclassified_revenue', priority: 'P2', issueCount: 2, affectedRecordCount: 2, affectedAmount: 25, sourceTable: 'revenue' },
  { issueType: 'unclassified_cost', priority: 'P2', issueCount: 1, affectedRecordCount: 1, affectedAmount: 20, sourceTable: 'expense' },
  { issueType: 'missing_product_cost', priority: 'P1', issueCount: 3, affectedRecordCount: 3, affectedAmount: 30, sourceTable: 'revenue' }
], {
  baseline: { rows: [], failed: false },
  aliases: { rows: [
    { candidateStatus: 'ambiguous', affectedAmount: 100 },
    { candidateStatus: 'matched', affectedAmount: 50 }
  ], failed: false },
  products: { rows: [
    { governanceStatus: 'classification_and_cost_review', reviewPriority: 'P1', affectedAmount: 80 },
    { governanceStatus: 'complete', reviewPriority: 'P4', affectedAmount: 20 }
  ], failed: false },
  revenue: { rows: [
    { candidateStatus: 'unique_rule', reviewPriority: 'P3', affectedAmount: 100 },
    { candidateStatus: 'ambiguous_rules', reviewPriority: 'P1', affectedAmount: 40 }
  ], failed: false },
  cost: { rows: [{ candidateStatus: 'partial_rule', reviewPriority: 'P2', affectedAmount: 20 }], failed: false },
  gallery: { rows: [{ candidateStatus: 'linked_snapshot', reviewPriority: 'P4', affectedAmount: 200 }], failed: false },
  workshop: { rows: [{ candidateStatus: 'missing_direct_cost', reviewPriority: 'P3', affectedAmount: 80 }], failed: false },
  space: { rows: [{ candidateStatus: 'suggested', reviewPriority: 'P2', affectedAmount: 90 }], failed: false },
  batches: { rows: [
    { name: '测试草稿', status: 'draft', itemCount: 2, affectedAmount: 140 },
    { name: '测试已应用', status: 'applied', itemCount: 1, affectedAmount: 50 }
  ], failed: false }
});

assert.deepEqual(model.issueTotals, { count: 6, records: 6, amount: 75 });
assert.deepEqual(model.issuePriority, { P1: 3, P2: 3, P3: 0, P4: 0 });
assert.equal(model.domains.length, 6);
assert.deepEqual(model.candidateTotals, { count: 10, p1: 3, human: 5, ready: 2 });
assert.deepEqual(model.candidatePriority, { P1: 3, P2: 2, P3: 2, P4: 3 });
assert.equal(model.domains[0].key, 'products');
assert.equal(model.domains[0].count, 4);
assert.equal(model.domains[0].p1, 2);
assert.equal(model.domains[0].amount, 250);
assert.equal(model.openBatchCount, 1);
assert.equal(model.batchAmount, 190);
assert.equal(model.batchStatuses.find(row => row.status === 'draft').count, 1);
assert.equal(model.hasPeriodData, true);
assert.deepEqual(model.failedSources, []);

const html = dashboard._governanceHtml(model);
assert.match(html, /data-governance-metric="issues"/);
assert.match(html, /data-candidate-domain="products"/);
assert.match(html, /data-batch-status="draft"/);
assert.match(html, /运营管理页保持只读/);

const partial = dashboard._buildGovernanceModel('2026-10', [], {
  baseline: { rows: [], failed: true },
  aliases: { rows: [], failed: false }, products: { rows: [], failed: false },
  revenue: { rows: [], failed: false }, cost: { rows: [], failed: false },
  gallery: { rows: [], failed: false }, workshop: { rows: [], failed: false },
  space: { rows: [], failed: false }, batches: { rows: [], failed: false }
});
assert.equal(partial.hasPeriodData, false);
assert.deepEqual(partial.failedSources, ['baseline']);
assert.match(dashboard._governanceHtml(partial), /部分治理数据暂不可用/);
assert.match(dashboard._governanceHtml(partial), /问题基线加载失败/);

console.log('PASS M5-05 governance model: baseline totals, P1-P4 queues, six candidate domains, batch states and partial failure');
