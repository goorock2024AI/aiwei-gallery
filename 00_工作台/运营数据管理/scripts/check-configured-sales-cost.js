#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync('app/js/models.js', 'utf8');
const context = { console, Date };
vm.createContext(context);
vm.runInContext(source + '\nthis.createConfiguredSaleItem=createConfiguredSaleItem;this.createWorkshopSaleItem=createWorkshopSaleItem;this.normalizeWorkshopSaleItem=normalizeWorkshopSaleItem;', context);

const ticket = context.createConfiguredSaleItem({ name: '套票', price: 25, costPrice: 7.25 }, 2);
assert.equal(ticket.amount, 50);
assert.equal(ticket.costPriceSnapshot, 7.25);
assert.equal(ticket.snapshotVersion, 1);

const coffee = context.createConfiguredSaleItem({ name: '手冲咖啡', price: 15, costPrice: 5 }, 3);
assert.equal(coffee.costPriceSnapshot, 5);

const preserved = context.createConfiguredSaleItem(
  { name: '套票', price: 25, costPrice: 9 },
  1,
  { name: '套票', cost_price_snapshot: 6.5, snapshot_version: 1, snapshot_at: '2026-09-01T00:00:00.000Z' }
);
assert.equal(preserved.costPriceSnapshot, 6.5, '编辑历史流水必须保留成交时成本');
assert.equal(preserved.snapshotAt, '2026-09-01T00:00:00.000Z');

const legacy = context.createConfiguredSaleItem({ name: '普通票', price: 10, costPrice: 4 }, 1, {});
assert.equal(legacy.costPriceSnapshot, 0, '无历史证据时不得用当前成本倒推');

const workshop = context.createWorkshopSaleItem({ name: '果壳风铃', price: 128, costPrice: 18.5 }, '周六工坊', 'workshop', 2, 6);
assert.equal(workshop.amount, 250);
assert.equal(workshop.costPriceSnapshot, 18.5);
assert.equal(context.normalizeWorkshopSaleItem({ ...workshop, cost_price_snapshot: 18.5 }).costPriceSnapshot, 18.5);

const uiSource = fs.readFileSync('app/js/ui.js', 'utf8');
assert.match(uiSource, /createConfiguredSaleItem\(p, qty, prior\)/);
assert.match(uiSource, /createWorkshopSaleItem\(product,/);

console.log('PASS configured-sale cost snapshots: ticket, combo, coffee, workshop, edit preservation and legacy no-backfill.');
