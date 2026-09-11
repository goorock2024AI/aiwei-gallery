const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Requires the dedicated local M6 regression database');
}

const base = process.env.M6_API_BASE || 'http://127.0.0.1:3130/rest/v1';
const tokens = {};
let checks = 0;

async function request(path, { method = 'GET', body, role = 'editor', expected = 200 } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  checks++;
  return data;
}

async function sourceSnapshot(db) {
  return (await db.query(`SELECT
    (SELECT COUNT(*) FROM creative_products)::INTEGER product_count,
    (SELECT COALESCE(SUM(stock),0) FROM creative_products)::NUMERIC(16,2) product_stock,
    (SELECT COUNT(*) FROM revenue)::INTEGER revenue_count,
    (SELECT COALESCE(SUM(ticket_amount+combo_amount+coffee_amount+workshop_amount+retail_amount+creative_amount+venue_amount+other_amount),0) FROM revenue)::NUMERIC(16,2) revenue_amount,
    (SELECT COUNT(*) FROM expense)::INTEGER expense_count,
    (SELECT COALESCE(SUM(amount),0) FROM expense)::NUMERIC(16,2) expense_amount,
    (SELECT COUNT(*) FROM gallery_sales)::INTEGER gallery_count,
    (SELECT COALESCE(SUM(price-refund_amount),0) FROM gallery_sales)::NUMERIC(16,2) gallery_amount,
    (SELECT COUNT(*) FROM space_usage)::INTEGER space_count,
    (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage)::NUMERIC(16,2) space_receivable,
    (SELECT COUNT(*) FROM space_payments)::INTEGER payment_count,
    (SELECT COALESCE(SUM(amount),0) FROM space_payments)::NUMERIC(16,2) payment_amount,
    (SELECT COUNT(*) FROM daily_closings)::INTEGER closing_count,
    (SELECT COALESCE(SUM(system_net_amount),0) FROM daily_closings)::NUMERIC(16,2) closing_amount`)).rows[0];
}

async function clean(db) {
  await db.query(`
    DELETE FROM operation_logs WHERE record_id LIKE 'm603-%';
    DELETE FROM daily_closings WHERE id LIKE 'm603-%';
    DELETE FROM revenue WHERE id LIKE 'm603-%';
    DELETE FROM creative_products WHERE id LIKE 'm603-%';
  `);
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  try {
    await clean(db);
    const before = await sourceSnapshot(db);

    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', {
        method: 'POST', role: 'none', body: { username: `m305-${role}`, password: cfg.password }
      })).token;
    }

    const coreReadMatrix = {
      revenue: 200,
      expense: 403,
      daily_closings: 200,
      creative_products: 403,
      gallery_sales: 200,
      space_usage: 200
    };
    for (const [table, viewerStatus] of Object.entries(coreReadMatrix)) {
      await request(`${table}?limit=1&count=none`, { role: 'none', expected: 401 });
      await request(`${table}?limit=1&count=none`, { role: 'editor' });
      await request(`${table}?limit=1&count=none`, { role: 'viewer', expected: viewerStatus });
      await request(table, { method: 'POST', role: 'viewer', body: { id: 'm603-forbidden' }, expected: 403 });
    }
    await request('revenue?status=neq.__m603_none__&status=neq.__m603_none_2__&limit=1&count=none');

    const protectedViews = [
      'business_layer_summary_v2', 'business_revenue_facts_v2', 'business_cost_facts_v2',
      'business_profit_facts_v2', 'data_governance_baseline_v2', 'data_governance_issues_v2',
      'product_alias_candidates_v2', 'product_master_governance_v2', 'product_cost_evidence_v2',
      'revenue_attribution_candidates_v2', 'cost_attribution_candidates_v2',
      'gallery_link_candidates_v2', 'workshop_link_candidates_v2',
      'space_classification_candidates_v2', 'governance_batch_summary_v2'
    ];
    for (const view of protectedViews) {
      await request(`${view}?limit=1&count=none`, { role: 'editor' });
      await request(`${view}?limit=1&count=none`, { role: 'viewer', expected: 403 });
      await request(`${view}?limit=1&count=none`, { role: 'none', expected: 401 });
      await request(view, { method: 'POST', role: 'admin', body: { id: 'm603-forbidden' }, expected: 405 });
    }

    await request('creative_products', {
      method: 'POST', role: 'editor', expected: 403,
      body: { id: 'm603-product-forbidden', name: 'M603越权商品', approvalStatus: '已上架' }
    });
    const product = await request('creative_products', {
      method: 'POST', role: 'editor', expected: 201,
      body: {
        id: 'm603-product', name: 'M603商品', standardName: 'M603标准商品', sku: 'M603-SKU',
        businessTypeCode: 'creative_retail', packageSpec: '1件', costPrice: 8, retailPrice: 30,
        stock: 5, isBeverage: false, isCountableStock: true, isActive: true
      }
    });
    assert.equal(product.approvalStatus, '待确认');
    await request('creative_products?id=eq.m603-product', {
      method: 'PATCH', role: 'editor', expected: 403, body: { approvalStatus: '已上架' }
    });
    const approved = await request('creative_products?id=eq.m603-product', {
      method: 'PATCH', role: 'admin', body: { approvalStatus: '已上架', approvedBy: 'M6管理员' }
    });
    assert.equal(approved.approvalStatus, '已上架');

    const sale = await request('revenue', {
      method: 'POST', role: 'editor', expected: 201,
      body: {
        id: 'm603-pos', date: '2026-09-11', retailAmount: 30, status: '正常', paymentMethod: '扫码支付',
        retailItems: [{
          productId: 'm603-product', productName: 'M603商品', standardName: 'M603标准商品',
          businessTypeCode: 'creative_retail', packageSpec: '1件', qty: 1, unitPrice: 30,
          amount: 30, costPriceSnapshot: 8, snapshotVersion: 1
        }]
      }
    });
    assert.equal(sale.retailAmount, 30);
    const revenueFact = (await request('business_revenue_facts_v2?source_id=eq.m603-pos'))[0];
    assert.equal(revenueFact.netAmount, 30);
    assert.equal(revenueFact.productId, 'm603-product');
    await request('revenue?id=eq.m603-pos', {
      method: 'PATCH', role: 'editor', expected: 403, body: { status: '已作废' }
    });

    const closing = await request('daily_closings', {
      method: 'POST', role: 'editor', expected: 201,
      body: {
        id: 'm603-closing', date: '2026-09-11', systemNetAmount: 30, confirmedAmount: 30,
        differenceAmount: 0, revenueSummary: { retail: 30 }, paymentSummary: { qr: 30 },
        expenseSummary: {}, adjustmentSummary: {}, cashSummary: {}, closerId: 'm305-editor',
        closerName: 'M6编辑', status: '已确认', notes: 'M6-03本地回归'
      }
    });
    assert.equal(closing.differenceAmount, 0);
    assert.deepEqual(await request('daily_closings?id=eq.m603-closing', { role: 'viewer' }), []);
    await request('daily_closings?id=eq.m603-closing', {
      method: 'PATCH', role: 'editor', expected: 403, body: { status: '已复核' }
    });
    const reviewed = await request('daily_closings?id=eq.m603-closing', {
      method: 'PATCH', role: 'admin', body: { status: '已复核', reviewerName: 'M6管理员' }
    });
    assert.equal(reviewed.status, '已复核');
    assert.equal((await request('daily_closings?id=eq.m603-closing', { role: 'viewer' })).length, 1);

    await clean(db);
    assert.deepEqual(await sourceSnapshot(db), before, 'M6 core regression must restore all source facts');

    const result = {
      passed: true,
      checks,
      staticCoreDomains: Object.keys(coreReadMatrix),
      protectedViews: protectedViews.length,
      productApprovalBoundary: true,
      posSnapshotFlow: true,
      dailyClosingReviewBoundary: true,
      sourceFactsRestored: true
    };
    fs.writeFileSync('tmp/m6-03-core-permissions-result.json', JSON.stringify(result, null, 2));
    console.log(`PASS ${checks} HTTP checks: four-role matrix, 15 protected views, product approval, POS snapshot, daily closing review and restored source facts`);
    console.log(JSON.stringify(result));
  } finally {
    await clean(db).catch(() => {});
    await db.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
