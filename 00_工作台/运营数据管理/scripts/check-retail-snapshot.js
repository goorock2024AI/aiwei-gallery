const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js/models.js'), 'utf8'), context);
const evaluate = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
context.product = {
  id: 'test-water', name: '水', standard_name: '纯悦饮用水',
  business_type_code: 'beverage_retail', package_spec: '550ml',
  is_beverage: true, is_countable_stock: false, cost_price: 2
};
const sale = evaluate("createRetailSaleItem('水', 2, 5, product)");
assert.equal(sale.amount, 10);
assert.equal(sale.productId, 'test-water');
assert.equal(sale.standardName, '纯悦饮用水');
assert.equal(sale.businessTypeCode, 'beverage_retail');
assert.equal(sale.isCountableStock, false);
assert.equal(sale.costPriceSnapshot, 2);

context.product.standard_name = '已改名';
context.product.cost_price = 99;
assert.equal(sale.standardName, '纯悦饮用水');
assert.equal(sale.costPriceSnapshot, 2);
assert.equal(evaluate("createRetailSaleItem('手工商品', 1, 8, product)").snapshotVersion, undefined);
assert.equal(evaluate("createRetailSaleItem('未选商品', 1, 8)").productId, undefined);

context.raw = Object.fromEntries(Object.entries(sale).map(([key, value]) =>
  [key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), value]));
assert.deepEqual(evaluate('normalizeRetailSaleItem(raw)'), sale);
context.raw = { product_name: '历史商品', quantity: 0, unit_price: 0, amount: 0, custom_note: '保留' };
const legacy = evaluate('normalizeRetailSaleItem(raw)');
assert.equal(legacy.productName, '历史商品');
assert.equal(legacy.qty, 0);
assert.equal(legacy.unitPrice, 0);
assert.equal(legacy.amount, 0);
assert.equal(legacy.customNote, '保留');
assert.equal(legacy.snapshotVersion, undefined);

console.log('Retail snapshot checks passed: stable identity/cost, manual-entry isolation, JSONB roundtrip and legacy zeros.');
