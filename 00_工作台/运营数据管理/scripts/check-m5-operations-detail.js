const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;
dashboard._period = { year: '2026', month: '09' };

const revenueRows = [
  {
    factId: 'revenue:r-1:retail:1', sourceTable: 'revenue', sourceId: 'r-1', sourceLineKey: 'retail:1', businessDate: '2026-09-12',
    businessLayerCode: 'onsite_consumption', businessLayerName: '现场消费', businessTypeName: '文创零售', productId: 'p-1',
    productNameStandard: '明信片,「秋」', netAmount: 30, grossAmount: 30, quantity: 2, unitPrice: 15,
    mappingStatus: 'manual_link', qualityFlags: { missing_unit_cost: true }
  },
  {
    factId: 'revenue:r-2:ticket', sourceTable: 'revenue', sourceId: 'r-2', sourceLineKey: 'ticket', businessDate: '2026-09-11',
    businessLayerCode: 'visit', businessLayerName: '到馆参观', businessTypeName: '门票', netAmount: 50,
    mappingStatus: 'system_field', qualityFlags: {}
  }
];

const model = dashboard._buildDetailModel('revenue', revenueRows, 'r-1');
assert.equal(model.rows.length, 2);
assert.equal(model.visible.length, 1);
assert.equal(model.amount, 30);
assert.equal(model.sourceCount, 1);
assert.equal(model.qualityCount, 1);
assert.deepEqual(model.visible[0].quality, ['缺单位成本']);
assert.match(dashboard._detailResultsHtml(model), /来源 ID/);
assert.match(dashboard._detailResultsHtml(model), /明细键/);

dashboard._detailType = 'profit';
dashboard._detailLayer = 'visit';
dashboard._detailStatus = 'manual_link';
assert.equal(dashboard._detailRequestPath(), '/rest/v1/business_profit_facts_v2?business_date=gte.2026-09-01&business_date=lte.2026-09-30&business_layer_code=eq.visit&mapping_status=eq.manual_link&order=business_date.desc&limit=500&count=none');

const profit = dashboard._buildDetailModel('profit', [{
  factId: 'profit:one', sourceTable: 'revenue', sourceId: 'r,3', sourceLineKey: 'retail:1', businessDate: '2026-09-10',
  businessLayerName: '现场消费', businessTypeName: '文创零售', productNameStandard: '带"引号"商品',
  revenueAmount: 100, costAmount: 40, grossProfit: 60, grossMargin: 0.6, mappingStatus: 'rule_confirmed', qualityFlags: {}
}]);
const csv = dashboard._detailCsvContent(profit);
assert.equal(csv.charCodeAt(0), 0xFEFF);
assert.match(csv, /事实ID.*来源表.*来源ID.*明细键.*毛利率/s);
assert.match(csv, /"r,3"/);
assert.match(csv, /"带""引号""商品"/);
assert.match(csv, /,100,40,60,0.6,/);

const empty = dashboard._buildDetailModel('cost', [], 'none');
assert.equal(empty.visible.length, 0);
assert.match(dashboard._detailResultsHtml(empty), /没有符合筛选的成本事实/);

console.log('PASS M5-07 detail model: bounded server filters, keyword location, source drilldown, quality flags and UTF-8 CSV');
