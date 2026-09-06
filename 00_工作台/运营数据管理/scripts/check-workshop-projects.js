#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync('app/js/models.js', 'utf8');
const context = { console, Date };
vm.createContext(context);
vm.runInContext(source + '\nthis.createWorkshopSaleItem=createWorkshopSaleItem;this.normalizeWorkshopSaleItem=normalizeWorkshopSaleItem;', context);

const item = context.createWorkshopSaleItem({ name: '果壳风铃', price: 128 }, '周六亲子木刻', 'course_study', 3, 30);
assert.equal(item.productName, '果壳风铃');
assert.equal(item.projectName, '周六亲子木刻');
assert.equal(item.participantCount, 3);
assert.equal(item.qty, 3);
assert.equal(item.amount, 354);
assert.equal(item.activityTypeCode, 'course_study');
assert.equal(item.snapshotVersion, 1);

const roundtrip = context.normalizeWorkshopSaleItem({
  product_name: '拓印体验', project_name: '研学一班', activity_type_code: 'course_study',
  participant_count: '12', unit_price: '38', discount: '6', amount: '450'
});
assert.equal(roundtrip.productName, '拓印体验');
assert.equal(roundtrip.projectName, '研学一班');
assert.equal(roundtrip.qty, 12);
assert.equal(roundtrip.amount, 450);
assert.equal(roundtrip.activityTypeCode, 'course_study');

const legacy = context.normalizeWorkshopSaleItem({ name: '旧工坊', qty: 2, price: 50 });
assert.equal(legacy.productName, '旧工坊');
assert.equal(legacy.projectName, '');
assert.equal(legacy.amount, 100);
assert.equal(legacy.activityTypeCode, 'workshop');
console.log('Workshop snapshot checks passed: project, activity type, participants, amount and legacy normalization.');
