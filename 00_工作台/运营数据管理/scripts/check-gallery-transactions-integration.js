#!/usr/bin/env node
// Requires the isolated local M3 database and API on port 3107. Never use production data.
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');
const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') throw new Error('Requires the dedicated local M3 test database');
const tokens = {};
let checks = 0;
async function request(path, method = 'GET', body, role = 'editor', status = 200) {
  const response = await fetch('http://127.0.0.1:3107/rest/v1/' + path, { method, headers: { 'Content-Type': 'application/json', ...(tokens[role] ? { Authorization: 'Bearer ' + tokens[role] } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(json));
  checks++;
  return json;
}
(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  try {
    for (const role of ['admin', 'editor', 'viewer']) tokens[role] = (await request('login', 'POST', { username: 'm305-' + role, password: cfg.password }, 'none')).token;
    await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm307-%'; DELETE FROM cash_movements WHERE source_id LIKE 'm307-%'; DELETE FROM transaction_adjustments WHERE target_id LIKE 'm307-%'; DELETE FROM gallery_sales WHERE id LIKE 'm307-%'; DELETE FROM artworks WHERE id LIKE 'm307-%'");
    await db.query(`INSERT INTO artworks(id,artwork_no,title,artist,status,settlement_price,retail_price,total_qty,sold_qty,approval_status) VALUES
      ('m307-art-1','M307-001','测试作品一','测试艺术家','在库',300,800,2,0,'已上架'),
      ('m307-art-2','M307-002','测试作品二','测试艺术家','在库',500,1200,1,0,'已上架')`);
    const base = { id: 'm307-sale-1', date: '2026-09-06', price: 750, commission: 50, saleQuantity: 1, paymentMethod: '现金', status: '已售出', galleryChannel: '馆内画廊' };
    const created = await request('gallery-entry', 'POST', { sale: base, artworkId: 'm307-art-1' }, 'editor', 201);
    assert.equal(created.sale.artworkId, 'm307-art-1');
    assert.equal(created.sale.artworkName, '测试作品一');
    assert.equal(created.sale.settlementPriceSnapshot, 300);
    assert.equal(created.sale.retailPriceSnapshot, 800);
    assert.equal(created.sale.grossAmountSnapshot, 750);
    assert.equal(created.sale.netAmountSnapshot, 700);
    assert.equal(Number((await db.query("SELECT sold_qty FROM artworks WHERE id='m307-art-1'")).rows[0].sold_qty), 1);
    assert.equal(Number((await db.query("SELECT amount FROM cash_movements WHERE source_id='m307-sale-1' AND type='cash_sale'")).rows[0].amount), 700);
    await db.query("UPDATE artworks SET settlement_price=999,retail_price=1999 WHERE id='m307-art-1'");
    const fact = (await request('gallery_transaction_performance_v2?id=eq.m307-sale-1', 'GET', undefined, 'editor'))[0];
    assert.equal(fact.settlementCost, 300);
    assert.equal(fact.contributionAmount, 400);
    await request('gallery-entry', 'POST', { sale: { ...base, id: 'm307-sale-no-link' }, artworkId: '' }, 'editor', 400);
    await request('gallery-entry', 'POST', { sale: { ...base, id: 'm307-sale-too-many', saleQuantity: 2 }, artworkId: 'm307-art-2' }, 'editor', 400);
    assert.equal(Number((await db.query("SELECT sold_qty FROM artworks WHERE id='m307-art-2'")).rows[0].sold_qty), 0);
    assert.equal(Number((await db.query("SELECT count(*) FROM gallery_sales WHERE id='m307-sale-too-many'")).rows[0].count), 0);
    await request('gallery-entry?id=m307-sale-1&action=refund', 'POST', { amount: 200, reason: '客户协商部分退款', payoutMethod: '现金' }, 'editor', 403);
    let adjusted = await request('gallery-entry?id=m307-sale-1&action=refund', 'POST', { amount: 200, reason: '客户协商部分退款', payoutMethod: '现金' }, 'admin');
    assert.equal(adjusted.sale.status, '部分退款');
    assert.equal(adjusted.inventoryReleased, false);
    assert.equal(Number((await db.query("SELECT sold_qty FROM artworks WHERE id='m307-art-1'")).rows[0].sold_qty), 1);
    adjusted = await request('gallery-entry?id=m307-sale-1&action=refund', 'POST', { amount: 500, reason: '完成剩余退款', payoutMethod: '原路退回' }, 'admin');
    assert.equal(adjusted.sale.status, '已退款');
    assert.equal(adjusted.inventoryReleased, true);
    assert.equal(Number((await db.query("SELECT sold_qty FROM artworks WHERE id='m307-art-1'")).rows[0].sold_qty), 0);
    await request('gallery-entry?id=m307-sale-1&action=refund', 'POST', { amount: 1, reason: '重复退款', payoutMethod: '现金' }, 'admin', 400);
    const audit = await db.query("SELECT action,details FROM operation_logs WHERE record_id='m307-sale-1' ORDER BY created_at");
    assert.equal(audit.rowCount, 3);
    assert.equal(audit.rows[2].details.originalRecordId, 'm307-sale-1');
    assert.equal(audit.rows[2].details.reason, '完成剩余退款');
    const adjustments = await db.query("SELECT action,operator_id,reason FROM transaction_adjustments WHERE target_id='m307-sale-1' ORDER BY created_at");
    assert.deepEqual(adjustments.rows.map(x => x.action), ['partial_refund', 'refund']);
    assert.ok(adjustments.rows.every(x => x.operator_id && x.reason));
    console.log(`PASS ${checks} HTTP checks: explicit artwork link, frozen snapshots, atomic inventory/cash, contribution, permissions and audited refunds.`);
  } finally { await db.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
