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
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3125';
const periods = Array.from({ length: 72 }, (_, index) => `${2021 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`);

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
  await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm507-%'; DELETE FROM record_business_links WHERE source_id LIKE 'm507-%'; DELETE FROM expense WHERE id LIKE 'm507-%'; DELETE FROM revenue WHERE id LIKE 'm507-%'");
}

async function selectPeriod(page, period) {
  const [year, month] = period.split('-');
  await page.locator('#operations-year').selectOption(year);
  await page.locator('#operations-month').selectOption(month);
  await page.locator('#operations-detail-state').filter({ hasText: /数据已就绪|空期间/ }).waitFor();
}

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres', password: cfg.password });
  let browser;
  await db.connect();
  try {
    await cleanup(db);
    const editorToken = await loginToken('editor');
    const occupied = new Set((await api('business_revenue_facts_v2?order=business_date.asc&limit=5000', editorToken)).map(row => String(row.businessDate).slice(0, 7)));
    const period = periods.find(value => !occupied.has(value));
    assert.ok(period, 'Expected an unused period in isolated database');
    const date = `${period}-15`;
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm507-ticket', date, ticketQty: 2, ticketAmount: 100, status: '正常', paymentMethod: '扫码支付'
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm507-retail', date, retailAmount: 60, status: '正常', paymentMethod: '现金',
      retailItems: [{ productName: 'M507明信片,秋', standardName: 'M507明信片,秋', productId: 'm507-product', businessTypeCode: 'creative_retail', qty: 2, unitPrice: 30, amount: 60, costPriceSnapshot: 10, snapshotVersion: 1 }]
    });
    await api('expense-entry', editorToken, 201, 'POST', {
      expense: { id: 'm507-expense', date, project: 'M507参观支持', category: '办公行政', amount: 15, description: 'M507期间成本' },
      classification: { mode: 'manual', businessLayerCode: 'visit', businessTypeCode: '', costTypeCode: 'admin_finance', capabilityAxisCode: '', overrideReason: 'M5-07隔离验收' }
    });

    const range = `business_date=gte.${period}-01&business_date=lte.${period}-31`;
    const revenueRows = await api(`business_revenue_facts_v2?${range}&order=business_date.desc&limit=500`, editorToken);
    const costRows = await api(`business_cost_facts_v2?${range}&order=business_date.desc&limit=500`, editorToken);
    const profitRows = await api(`business_profit_facts_v2?${range}&order=business_date.desc&limit=500`, editorToken);
    assert.equal(revenueRows.length, 2);
    assert.equal(revenueRows.reduce((sum, row) => sum + row.netAmount, 0), 160);
    assert.ok(costRows.some(row => row.sourceId === 'm507-retail' && row.costAmount === 20));
    assert.ok(costRows.some(row => row.sourceId === 'm507-expense' && row.costAmount === 15));
    assert.equal(profitRows.reduce((sum, row) => sum + row.grossProfit, 0), 140);

    const viewerToken = await loginToken('viewer');
    const adminToken = await loginToken('admin');
    await api(`business_revenue_facts_v2?${range}`, viewerToken, 403);
    await api(`business_revenue_facts_v2?${range}`, '', 401);
    await api('business_revenue_facts_v2', adminToken, 405, 'POST', {});

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [];
    const detailRequests = [];
    let intentionalFailure = false;
    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-07-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-07-mobile.png');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !intentionalFailure && !message.text().startsWith('Failed to load resource:')) errors.push(`console: ${message.text()}`); });
    page.on('request', request => { if (/business_(revenue|cost|profit)_facts_v2\?/.test(request.url())) detailRequests.push(request.url()); });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    await selectPeriod(page, period);
    const detail = page.locator('#operations-detail-content');
    assert.equal(await detail.locator('.operations-detail-row').count(), 2);
    assert.equal(await detail.locator('.operations-detail-summary > div').nth(1).locator('strong').innerText(), dashboard._money(160));
    assert.ok(detailRequests.some(url => url.includes(`business_date=gte.${period}-01`) && url.includes(`business_date=lte.${period}-`)));

    const retailRow = detail.locator('.operations-detail-row').filter({ hasText: 'M507明信片,秋' });
    await retailRow.locator('.operations-detail-toggle').click();
    const expanded = detail.locator('.operations-detail-expansion').filter({ hasText: 'm507-retail' });
    await expanded.waitFor();
    assert.match(await expanded.innerText(), /来源表\s*revenue/);
    assert.match(await expanded.innerText(), /来源 ID\s*m507-retail/);
    assert.match(await expanded.innerText(), /明细键\s*retail:1/);

    await detail.locator('#operations-detail-keyword').fill('m507-ticket');
    assert.equal(await detail.locator('.operations-detail-row').count(), 1);
    const [download] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: '导出当前结果' }).click()]);
    assert.equal(download.suggestedFilename(), `运营管理-收入事实-${period}.csv`);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    assert.match(csv, /事实ID.*来源表.*来源ID.*明细键.*映射状态.*质量标记/s);
    assert.match(csv, /m507-ticket/);
    assert.doesNotMatch(csv, /m507-retail/);

    await detail.getByRole('button', { name: '重置明细筛选' }).click();
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    await detail.locator('#operations-detail-layer').selectOption('visit');
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    assert.ok(detailRequests.some(url => url.includes('business_layer_code=eq.visit')));
    assert.equal(await detail.locator('.operations-detail-row').count(), 1);

    await detail.locator('#operations-detail-type').selectOption('cost');
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    assert.match(await detail.innerText(), /M507参观支持/);
    await detail.locator('#operations-detail-layer').selectOption('all');
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    assert.equal(await detail.locator('.operations-detail-row').count(), costRows.length);

    await detail.locator('#operations-detail-type').selectOption('profit');
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    assert.equal(await detail.locator('.operations-detail-summary > div').nth(1).locator('strong').innerText(), dashboard._money(140));
    await page.locator('#operations-detail').screenshot({ path: desktopPath });

    intentionalFailure = true;
    await page.route('**/rest/v1/business_profit_facts_v2?**', route => route.abort());
    await detail.locator('#operations-detail-status-filter').selectOption('system_field');
    await page.locator('#operations-detail-state').filter({ hasText: '加载失败' }).waitFor();
    assert.match(await detail.innerText(), /经营明细加载失败/);
    assert.notEqual(await page.locator('#operations-overview-state').innerText(), '加载失败');
    assert.notEqual(await page.locator('#operations-model-state').innerText(), '加载失败');
    await page.unroute('**/rest/v1/business_profit_facts_v2?**');
    intentionalFailure = false;
    await page.evaluate(() => OperationsDashboard._loadDetail());
    await page.locator('#operations-detail-state').filter({ hasText: /数据已就绪|空期间/ }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#operations-detail').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(200);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await detail.locator('.operations-detail-filters').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);

    const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await viewer.goto(`${base}/index.html`);
    await viewer.locator('#login-username').fill('m305-viewer');
    await viewer.locator('#login-password').fill(cfg.password);
    await viewer.locator('#login-form button').click();
    assert.equal(await viewer.locator('[data-tab="operations"]').isVisible(), false);
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log('PASS M5-07 browser: unified period, server filters, revenue/cost/profit drilldown, source location, UTF-8 CSV, permissions and desktop/mobile');
    console.log(JSON.stringify({ period, revenue: revenueRows.length, cost: costRows.length, profit: profitRows.length, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
    await cleanup(db);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
