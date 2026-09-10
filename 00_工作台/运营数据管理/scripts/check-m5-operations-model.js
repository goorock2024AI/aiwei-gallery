const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;

const rows = [
  { dimensionType: 'business_type', code: 'coffee', name: '咖啡', parentCode: 'onsite_consumption', sortOrder: 230, isActive: true, notes: '咖啡销售' },
  { dimensionType: 'business_layer', code: 'art_transaction_cooperation', name: '艺术交易与合作', sortOrder: 40, isActive: true },
  { dimensionType: 'capability_axis', code: 'content_ip', name: '内容/IP能力', sortOrder: 10, isActive: true },
  { dimensionType: 'business_layer', code: 'visit', name: '到馆参观', sortOrder: 10, isActive: true },
  { dimensionType: 'cost_type', code: 'marketing', name: '市场推广成本', sortOrder: 160, isActive: false },
  { dimensionType: 'business_layer', code: 'experience_activity', name: '体验活动', sortOrder: 30, isActive: true },
  { dimensionType: 'business_type', code: 'ticket', name: '门票', parentCode: 'visit', sortOrder: 110, isActive: true },
  { dimensionType: 'business_layer', code: 'onsite_consumption', name: '现场消费', sortOrder: 20, isActive: true }
];

const model = dashboard._buildBusinessModel(rows);
assert.equal(model.totalCount, 8);
assert.equal(model.activeCount, 7);
assert.equal(model.inactiveCount, 1);
assert.deepEqual(model.groups.map(group => group.key), ['business_layer', 'business_type', 'cost_type', 'capability_axis']);
assert.deepEqual(model.groups[0].items.map(item => item.code), ['visit', 'onsite_consumption', 'experience_activity', 'art_transaction_cooperation']);
assert.equal(model.groups[1].items.find(item => item.code === 'coffee').parentName, '现场消费');
assert.equal(model.groups[2].inactiveCount, 1);

const html = dashboard._businessModelHtml(model);
assert.match(html, /data-dimension-type="business_layer"/);
assert.match(html, /归属：现场消费/);
assert.match(html, /business_revenue_facts_v2\.net_amount/);
assert.match(html, /business_layer_summary_v2\.gross_margin/);
assert.match(html, /data_governance_baseline_v2\.affected_amount/);
assert.match(html, /净收入为零时显示“—”/);
assert.match(html, /全局模型说明，不随当前年月筛选变化/);
assert.equal((html.match(/data-model-metric=/g) || []).length, 9);

const empty = dashboard._buildBusinessModel([]);
assert.equal(empty.hasRows, false);
assert.match(dashboard._businessModelHtml(empty), /不会用前端默认值伪造字典/);

console.log('PASS M5-06 business model: four frozen dimensions, parent mapping, inactive visibility, fact chain and nine metric mappings');
