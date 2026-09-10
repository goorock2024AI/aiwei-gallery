const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3124';
const supportedYears = ['2021', '2022', '2023', '2024', '2025', '2026'];

async function api(pathname, token, expectedStatus = 200, method = 'GET', body) {
  const response = await fetch(`${base}/rest/v1/${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${pathname}: ${JSON.stringify(result)}`);
  return result;
}

async function loginToken(role) {
  return (await api('login', '', 200, 'POST', { username: `m305-${role}`, password: cfg.password })).token;
}

async function cleanup(db) {
  await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm505-%'");
  const batchIds = (await db.query("SELECT id FROM governance_batches WHERE id LIKE 'm505-%'")).rows.map(row => row.id);
  if (batchIds.length) {
    await db.query('DELETE FROM governance_batch_events WHERE batch_id=ANY($1::text[])', [batchIds]);
    await db.query('DELETE FROM governance_batch_items WHERE batch_id=ANY($1::text[])', [batchIds]);
    await db.query('DELETE FROM governance_batches WHERE id=ANY($1::text[])', [batchIds]);
  }
  await db.query("DELETE FROM record_business_links WHERE source_id LIKE 'm505-%'; DELETE FROM expense WHERE id LIKE 'm505-%'; DELETE FROM revenue WHERE id LIKE 'm505-%'; DELETE FROM creative_products WHERE id LIKE 'm505-%'");
}

function source(rows, limit = 500) {
  return { rows, failed: false, truncated: rows.length >= limit };
}

async function selectPeriod(page, year, month) {
  await page.locator('#operations-year').selectOption(year);
  await page.locator('#operations-month').selectOption(month);
  await page.locator('#operations-refresh-status').filter({ hasText: `已更新 · ${year}年${Number(month)}月` }).waitFor();
}

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres', password: cfg.password });
  let browser;
  await db.connect();
  try {
    await cleanup(db);
    const editorToken = await loginToken('editor');
    const [existingBaseline, existingBatches] = await Promise.all([
      api('data_governance_baseline_v2?order=period_month.asc&limit=5000', editorToken),
      api('governance_batch_summary_v2?order=created_at.asc&limit=5000', editorToken)
    ]);
    const occupiedYears = new Set([
      ...existingBaseline.map(row => String(row.periodMonth || '').slice(0, 4)),
      ...existingBatches.map(row => String(row.createdAt || '').slice(0, 4))
    ]);
    const dataYear = supportedYears.find(year => !occupiedYears.has(year));
    const emptyYear = supportedYears.find(year => year !== dataYear && !occupiedYears.has(year));
    assert.ok(dataYear && emptyYear, 'Expected two unused supported years in isolated database');
    const period = `${dataYear}-03`;
    const date = `${period}-15`;

    await api('creative_products', editorToken, 201, 'POST', {
      id: 'm505-product', name: 'M505待治理商品', standardName: '', businessTypeCode: '', packageSpec: '',
      costPrice: 0, retailPrice: 40, stock: 10, isActive: true
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm505-retail', date, retailAmount: 80, status: '正常', paymentMethod: '扫码支付',
      retailItems: [{ productId: 'm505-product', productName: 'M505待治理商品', qty: 2, unitPrice: 40, amount: 80 }]
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm505-other', date, otherAmount: 25, otherDesc: 'M505待归类收入', status: '正常'
    });
    await api('expense', editorToken, 201, 'POST', {
      id: 'm505-expense', date, type: '运营支出', project: 'M505待归类支出', category: '其他',
      amount: 20, description: 'M505无归属成本', handler: 'M505测试'
    });
    await db.query(`INSERT INTO governance_batches(id,name,description,status,created_by,created_at,updated_at)
      VALUES
      ('m505-batch-draft','M505三月治理草稿','M5-05只读状态验收','draft','m305-editor',$1,$1),
      ('m505-batch-review','M505三月待审核','M5-05 editor 权限验收','pending_review','m305-editor',$1,$1),
      ('m505-batch-approved','M505三月已批准','M5-05 admin 权限验收','approved','m305-editor',$1,$1),
      ('m505-batch-applied','M505三月已应用','M5-05 admin 撤销权限验收','applied','m305-editor',$1,$1)`, [`${date}T04:00:00.000Z`]);

    const range = `business_date=gte.${period}-01&business_date=lte.${period}-31`;
    const [baseline, aliases, products, revenue, cost, gallery, workshop, space, batches] = await Promise.all([
      api(`data_governance_baseline_v2?period_month=eq.${period}&order=priority.asc&limit=200`, editorToken),
      api('product_alias_candidates_v2?order=affected_amount.desc&limit=500', editorToken),
      api('product_master_governance_v2?order=review_priority.asc&limit=500', editorToken),
      api(`revenue_attribution_candidates_v2?${range}&order=business_date.desc&limit=500`, editorToken),
      api(`cost_attribution_candidates_v2?${range}&order=business_date.desc&limit=500`, editorToken),
      api(`gallery_link_candidates_v2?${range}&order=business_date.desc&limit=500`, editorToken),
      api(`workshop_link_candidates_v2?${range}&order=business_date.desc&limit=500`, editorToken),
      api(`space_classification_candidates_v2?${range}&order=business_date.desc&limit=500`, editorToken),
      api(`governance_batch_summary_v2?created_at=gte.${period}-01&created_at=lte.${period}-31T23:59:59.999Z&order=created_at.desc&limit=200`, editorToken)
    ]);
    const model = dashboard._buildGovernanceModel(period, baseline, {
      baseline: source(baseline, 200), aliases: source(aliases), products: source(products), revenue: source(revenue),
      cost: source(cost), gallery: source(gallery), workshop: source(workshop), space: source(space), batches: source(batches, 200)
    });
    assert.ok(model.issueTotals.count >= 3, 'Expected revenue, cost, or missing-cost governance issues');
    assert.ok(model.candidateTotals.count >= 3, 'Expected product, revenue, and cost governance candidates');
    assert.equal(model.openBatchCount, 3);

    const viewerToken = await loginToken('viewer');
    const adminToken = await loginToken('admin');
    await api(`data_governance_baseline_v2?period_month=eq.${period}`, viewerToken, 403);
    await api('governance_batch_summary_v2', adminToken, 405, 'POST', {});
    await api('governance-batches?id=m505-batch-review&action=approve', editorToken, 403, 'POST', { note: 'editor 不得审批' });

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [];
    const requestUrls = [];
    let intentionalFailure = false;
    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-05-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-05-mobile.png');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !intentionalFailure) errors.push(`console: ${message.text()}`); });
    page.on('request', request => { if (/governance|candidate/.test(request.url())) requestUrls.push(request.url()); });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    await selectPeriod(page, dataYear, '03');

    const governance = page.locator('#operations-governance-content');
    assert.equal(await governance.locator('[data-governance-metric="issues"] > strong').innerText(), String(model.issueTotals.count));
    assert.equal(await governance.locator('[data-governance-metric="p1"] > strong').innerText(), String(model.issuePriority.P1 + model.candidatePriority.P1));
    assert.equal(await governance.locator('[data-governance-metric="candidates"] > strong').innerText(), String(model.candidateTotals.count));
    assert.equal(await governance.locator('[data-governance-metric="affected"] > strong').innerText(), dashboard._money(model.issueTotals.amount));
    assert.equal(await governance.locator('[data-governance-metric="batches"] > strong').innerText(), '3');
    assert.equal(await governance.locator('[data-candidate-domain]').count(), 6);
    assert.equal(await governance.locator('[data-batch-status="draft"] > strong').innerText(), '1');
    assert.match(await governance.innerText(), /M505三月治理草稿/);
    for (const type of ['unclassified_revenue', 'unclassified_cost', 'missing_product_cost']) {
      assert.equal(await governance.locator(`[data-issue-type="${type}"]`).count(), 1);
    }
    assert.ok(requestUrls.some(url => url.includes(`period_month=eq.${period}`)));
    assert.ok(requestUrls.some(url => url.includes(`business_date=gte.${period}-01`) && url.includes(`business_date=lte.${period}-31`)));
    assert.ok(requestUrls.some(url => url.includes(`created_at=gte.${period}-01`)));
    await page.locator('#operations-governance').screenshot({ path: desktopPath });

    await selectPeriod(page, emptyYear, '03');
    await page.locator('#operations-governance-state').filter({ hasText: '空期间' }).waitFor();
    assert.match(await governance.innerText(), new RegExp(`${emptyYear}-03 暂无期间治理问题或候选`));

    intentionalFailure = true;
    await page.route('**/rest/v1/space_classification_candidates_v2?**', route => route.abort());
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-governance-state').filter({ hasText: '部分数据失败' }).waitFor();
    await page.locator('#operations-refresh-status').filter({ hasText: '部分数据加载失败' }).waitFor();
    assert.match(await governance.innerText(), /空间合作加载失败/);
    assert.notEqual(await page.locator('#operations-overview-state').innerText(), '加载失败');
    assert.notEqual(await page.locator('#operations-trend-state').innerText(), '加载失败');
    await page.unroute('**/rest/v1/space_classification_candidates_v2?**');
    intentionalFailure = false;

    await selectPeriod(page, dataYear, '03');
    await governance.getByRole('button', { name: '进入受控批次' }).click();
    await page.locator('#governance-batches-card').getByText('治理变更批次').waitFor();
    assert.match(await page.locator('#governance-batches-card').innerText(), /M505三月治理草稿/);
    for (const name of ['批准', '拒绝', '应用批次', '撤销批次']) {
      assert.equal(await page.locator('#governance-batches-card').getByRole('button', { name, exact: true }).count(), 0);
    }

    const admin = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    admin.on('pageerror', error => errors.push(`admin: ${error.message}`));
    await admin.goto(`${base}/index.html`);
    await admin.locator('#login-username').fill('m305-admin');
    await admin.locator('#login-password').fill(cfg.password);
    await admin.locator('#login-form button').click();
    await admin.locator('[data-tab="manage"]').click();
    await admin.locator('#governance-batches-card').getByText('治理变更批次').waitFor();
    await admin.locator('#governance-batches-card').getByText('M505三月已应用').waitFor();
    for (const name of ['批准', '拒绝', '应用批次', '撤销批次']) {
      assert.ok(await admin.locator('#governance-batches-card').getByRole('button', { name, exact: true }).count() > 0, `admin should see ${name}`);
    }
    await admin.close();

    await page.locator('[data-tab="operations"]').click();
    await page.locator('#operations-governance-state').filter({ hasText: '数据已就绪' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#operations-governance').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(200);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await governance.locator('.operations-candidate-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);

    const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    viewer.on('pageerror', error => errors.push(`viewer: ${error.message}`));
    await viewer.goto(`${base}/index.html`);
    await viewer.locator('#login-username').fill('m305-viewer');
    await viewer.locator('#login-password').fill(cfg.password);
    await viewer.locator('#login-form button').click();
    assert.equal(await viewer.locator('[data-tab="operations"]').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS M5-05 browser: exact governance baseline, P1-P4 queue, six candidate domains, batch status, partial failure, permissions and desktop/mobile');
    console.log(JSON.stringify({ dataYear, period, issues: model.issueTotals.count, candidates: model.candidateTotals.count, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
    await cleanup(db);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
