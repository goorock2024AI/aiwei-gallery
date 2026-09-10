const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3123';
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
  const result = await api('login', '', 200, 'POST', { username: `m305-${role}`, password: cfg.password });
  return result.token;
}

async function cleanup(db) {
  await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm504-%'; DELETE FROM record_business_links WHERE source_id LIKE 'm504-%'; DELETE FROM expense WHERE id LIKE 'm504-%'; DELETE FROM revenue WHERE id LIKE 'm504-%'");
}

const money = value => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    const [existingSummary, existingLegacy] = await Promise.all([
      api('business_layer_summary_v2?order=period_month.asc&limit=5000', editorToken),
      api('revenue_facts?order=date.asc&limit=5000', editorToken)
    ]);
    const occupiedYears = new Set([
      ...existingSummary.map(row => String(row.periodMonth || '').slice(0, 4)),
      ...existingLegacy.map(row => String(row.date || '').slice(0, 4))
    ]);
    const dataYear = supportedYears.find(year => !occupiedYears.has(year));
    const emptyYear = supportedYears.find(year => year !== dataYear && !occupiedYears.has(year));
    assert.ok(dataYear && emptyYear, 'Expected two unused supported years in isolated database');

    await api('revenue', editorToken, 201, 'POST', {
      id: 'm504-jan-ticket', date: `${dataYear}-01-15`, ticketQty: 12, ticketAmount: 120,
      status: '正常', paymentMethod: '扫码支付'
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm504-jan-retail', date: `${dataYear}-01-15`, retailAmount: 80, status: '正常',
      retailItems: [{ productName: 'M504趋势商品', standardName: 'M504趋势商品', productId: 'm504-product', businessTypeCode: 'creative_retail', qty: 2, unitPrice: 40, amount: 80, costPriceSnapshot: 15, snapshotVersion: 1 }]
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm504-jan-unclassified', date: `${dataYear}-01-15`, otherAmount: 25,
      otherDesc: 'M504待归类收入', status: '正常'
    });
    await api('expense-entry', editorToken, 201, 'POST', {
      expense: { id: 'm504-jan-expense', date: `${dataYear}-01-15`, project: 'M504参观支持', category: '办公行政', amount: 20, description: 'M504期间成本' },
      classification: { mode: 'manual', businessLayerCode: 'visit', businessTypeCode: '', costTypeCode: 'admin_finance', capabilityAxisCode: '', overrideReason: 'M5-04隔离验收' }
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm504-feb-ticket', date: `${dataYear}-02-15`, ticketQty: 10, ticketAmount: 100,
      status: '正常', paymentMethod: '扫码支付'
    });

    const [summaryRows, legacyRows] = await Promise.all([
      api(`business_layer_summary_v2?period_month=gte.${dataYear}-01&period_month=lte.${dataYear}-12&order=period_month.asc&limit=48`, editorToken),
      api(`revenue_facts?date=gte.${dataYear}-01-01&date=lte.${dataYear}-12-31&order=date.asc&limit=5000`, editorToken)
    ]);
    assert.equal(summaryRows.length, 8);
    assert.equal(legacyRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0), 325);

    const viewerToken = await loginToken('viewer');
    const adminToken = await loginToken('admin');
    await api(`business_layer_summary_v2?period_month=gte.${dataYear}-01`, viewerToken, 403);
    await api('business_layer_summary_v2', adminToken, 405, 'POST', {});

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [];
    const requestUrls = [];
    let intentionalFailure = false;
    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-04-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-04-mobile.png');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !intentionalFailure) errors.push(`console: ${message.text()}`); });
    page.on('request', request => {
      if (request.url().includes('/business_layer_summary_v2?') || request.url().includes('/revenue_facts?')) requestUrls.push(request.url());
    });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    await selectPeriod(page, dataYear, '01');

    const trend = page.locator('#operations-trend-content');
    const yearMetric = key => trend.locator(`[data-year-metric="${key}"] > strong`);
    assert.equal(await yearMetric('revenue').innerText(), money(300));
    assert.equal(await yearMetric('total-cost').innerText(), money(50));
    assert.equal(await yearMetric('gross-profit').innerText(), money(270));
    assert.equal(await yearMetric('contribution').innerText(), money(250));
    assert.equal(await yearMetric('difference').innerText(), '−¥25.00');
    assert.equal(await trend.locator('[data-compare="legacy"] > strong').innerText(), money(225));
    assert.equal(await trend.locator('[data-compare="v2"] > strong').innerText(), money(200));
    assert.equal(await trend.locator('[data-compare="difference"] > strong').innerText(), '−¥25.00');
    assert.equal(await trend.locator('.operations-trend-table tbody tr').count(), 12);
    assert.match(await trend.locator(`[data-trend-period="${dataYear}-01"]`).getAttribute('class'), /selected/);
    assert.equal(await page.evaluate(() => OperationsDashboard._trendCharts.length), 2);
    assert.equal(await trend.locator('canvas').count(), 2);
    assert.ok(requestUrls.some(url => url.includes(`period_month=gte.${dataYear}-01`) && url.includes(`period_month=lte.${dataYear}-12`)));
    assert.ok(requestUrls.some(url => url.includes(`date=gte.${dataYear}-01-01`) && url.includes(`date=lte.${dataYear}-12-31`)));

    await selectPeriod(page, dataYear, '02');
    assert.equal(await trend.locator('.operations-period-compare').getAttribute('data-period'), `${dataYear}-02`);
    assert.equal(await trend.locator('[data-compare="legacy"] > strong').innerText(), money(100));
    assert.equal(await trend.locator('[data-compare="v2"] > strong').innerText(), money(100));
    assert.equal(await trend.locator('[data-compare="difference"] > strong').innerText(), money(0));
    await page.locator('#operations-trend').screenshot({ path: desktopPath });

    await selectPeriod(page, emptyYear, '01');
    await page.locator('#operations-trend-state').filter({ hasText: '空年度' }).waitFor();
    assert.match(await trend.innerText(), new RegExp(`${emptyYear} 年暂无经营数据`));
    assert.equal(await trend.locator('.operations-trend-table tbody tr').count(), 12);

    const failedPattern = '**/rest/v1/revenue_facts?**';
    intentionalFailure = true;
    await page.route(failedPattern, route => route.abort());
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-trend-state').filter({ hasText: '加载失败' }).waitFor();
    await page.locator('#operations-refresh-status').filter({ hasText: '部分数据加载失败' }).waitFor();
    assert.match(await trend.innerText(), /月度趋势加载失败/);
    assert.notEqual(await page.locator('#operations-overview-state').innerText(), '加载失败');
    await page.unroute(failedPattern);
    intentionalFailure = false;

    await selectPeriod(page, dataYear, '02');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#operations-trend').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(200);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await trend.locator('.operations-chart-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);

    const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    viewer.on('pageerror', error => errors.push(`viewer: ${error.message}`));
    await viewer.goto(`${base}/index.html`);
    await viewer.locator('#login-username').fill('m305-viewer');
    await viewer.locator('#login-password').fill(cfg.password);
    await viewer.locator('#login-form button').click();
    assert.equal(await viewer.locator('[data-tab="operations"]').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS M5-04 browser: exact annual/monthly trends, two charts, 1.0/2.0 differences, empty/error isolation, permissions and desktop/mobile');
    console.log(JSON.stringify({ dataYear, emptyYear, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
    await cleanup(db);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
