const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3122';
const supportedPeriods = Array.from({ length: 6 * 12 }, (_, index) => {
  const year = 2021 + Math.floor(index / 12);
  const month = String(index % 12 + 1).padStart(2, '0');
  return `${year}-${month}`;
});

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

const money = value => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function selectPeriod(page, period) {
  const [year, month] = period.split('-');
  await page.locator('#operations-year').selectOption(year);
  await page.locator('#operations-month').selectOption(month);
  await page.locator('#operations-refresh-status').filter({ hasText: `已更新 · ${year}年${Number(month)}月` }).waitFor();
}

async function cleanup(db) {
  await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm503-%'; DELETE FROM record_business_links WHERE source_id LIKE 'm503-%'; DELETE FROM expense WHERE id LIKE 'm503-%'; DELETE FROM revenue WHERE id LIKE 'm503-%'");
}

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres', password: cfg.password });
  let browser;
  await db.connect();
  try {
    await cleanup(db);
    const editorToken = await loginToken('editor');
    const beforeRows = await api('business_layer_summary_v2?order=period_month.desc&limit=5000', editorToken);
    const occupiedBefore = new Set(beforeRows.map(row => row.periodMonth));
    const dataPeriod = supportedPeriods.find(period => !occupiedBefore.has(period));
    assert.ok(dataPeriod, 'Expected an unused supported test period');
    const businessDate = `${dataPeriod}-15`;

    await api('revenue', editorToken, 201, 'POST', {
      id: 'm503-ticket', date: businessDate, ticketQty: 12, ticketAmount: 120,
      status: '正常', paymentMethod: '扫码支付'
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm503-retail', date: businessDate, retailAmount: 80, status: '正常',
      retailItems: [{ productName: 'M503经营商品', standardName: 'M503经营商品', productId: 'm503-product', businessTypeCode: 'creative_retail', qty: 2, unitPrice: 40, amount: 80, costPriceSnapshot: 15, snapshotVersion: 1 }]
    });
    await api('revenue', editorToken, 201, 'POST', {
      id: 'm503-unclassified', date: businessDate, otherAmount: 25,
      otherDesc: 'M503待归类收入', status: '正常'
    });
    await api('expense-entry', editorToken, 201, 'POST', {
      expense: { id: 'm503-expense', date: businessDate, project: 'M503参观支持', category: '办公行政', amount: 20, description: 'M503期间成本' },
      classification: { mode: 'manual', businessLayerCode: 'visit', businessTypeCode: '', costTypeCode: 'admin_finance', capabilityAxisCode: '', overrideReason: 'M5-03隔离验收' }
    });

    const expectedRows = await api(`business_layer_summary_v2?period_month=eq.${dataPeriod}&order=sort_order.asc&limit=4`, editorToken);
    const baselineRows = await api(`data_governance_baseline_v2?period_month=eq.${dataPeriod}&order=priority.asc&limit=500`, editorToken);
    assert.equal(expectedRows.length, 4);
    const expected = expectedRows.reduce((total, row) => ({
      revenue: total.revenue + Number(row.revenueAmount || 0),
      salesCost: total.salesCost + Number(row.salesCostAmount || 0),
      periodCost: total.periodCost + Number(row.periodCostAmount || 0),
      grossProfit: total.grossProfit + Number(row.grossProfit || 0),
      contribution: total.contribution + Number(row.operatingContribution || 0)
    }), { revenue: 0, salesCost: 0, periodCost: 0, grossProfit: 0, contribution: 0 });
    expected.pendingImpact = baselineRows.filter(row => ['unclassified_revenue', 'unclassified_cost'].includes(row.issueType))
      .reduce((sum, row) => sum + Number(row.affectedAmount || 0), 0);
    assert.deepEqual(expected, { revenue: 200, salesCost: 30, periodCost: 20, grossProfit: 170, contribution: 150, pendingImpact: 25 });

    const emptyPeriod = supportedPeriods.find(period => period !== dataPeriod && !occupiedBefore.has(period));
    assert.ok(emptyPeriod, 'Expected a second unused supported test period');
    const viewerToken = await loginToken('viewer');
    const adminToken = await loginToken('admin');
    await api(`business_layer_summary_v2?period_month=eq.${dataPeriod}`, viewerToken, 403);
    await api('business_layer_summary_v2', adminToken, 405, 'POST', {});

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [];
    const requests = [];
    let intentionalFailure = false;
    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-03-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-03-mobile.png');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !intentionalFailure) errors.push(`console: ${message.text()}`); });
    page.on('request', request => { if (request.url().includes('/business_layer_summary_v2?')) requests.push(request.url()); });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    await selectPeriod(page, dataPeriod);

    const overview = page.locator('#operations-overview-content');
    const metricValue = async key => overview.locator(`[data-metric="${key}"] > strong`).innerText();
    assert.equal(await metricValue('revenue'), money(expected.revenue));
    assert.equal(await metricValue('sales-cost'), money(expected.salesCost));
    assert.equal(await metricValue('period-cost'), money(expected.periodCost));
    assert.equal(await metricValue('gross-profit'), money(expected.grossProfit));
    assert.equal(await metricValue('contribution'), money(expected.contribution));
    assert.equal(await metricValue('pending-impact'), money(expected.pendingImpact));
    assert.match(await overview.innerText(), /销售毛利.*净收入.*销售成本.*经营贡献.*期间成本/s);
    assert.equal(await page.locator('.operations-layer-table tbody tr').count(), 4);
    for (const row of expectedRows) {
      const rendered = page.locator(`[data-layer="${row.businessLayerCode}"]`);
      const text = await rendered.innerText();
      assert.ok(text.includes(money(row.revenueAmount)));
      assert.ok(text.includes(money(row.operatingContribution)));
      if (Number(row.revenueAmount) === 0) assert.equal(await rendered.locator('td[data-label="毛利率"]').innerText(), '—');
    }
    assert.ok(requests.some(url => url.includes(`period_month=eq.${dataPeriod}`)), 'Overview request must filter selected period on the server');
    await page.screenshot({ path: desktopPath, fullPage: true });

    await selectPeriod(page, emptyPeriod);
    await page.locator('#operations-overview-state').filter({ hasText: '空期间' }).waitFor();
    assert.match(await overview.innerText(), /本期间暂无经营事实/);
    assert.equal(await page.locator('.operations-layer-table tbody tr').count(), 4);
    assert.equal(await page.locator('.operations-layer-table tbody td').filter({ hasText: '—' }).count(), 4);

    const failedPattern = '**/rest/v1/business_layer_summary_v2?**';
    intentionalFailure = true;
    await page.route(failedPattern, route => route.abort());
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-overview-state').filter({ hasText: '加载失败' }).waitFor();
    assert.match(await overview.innerText(), /经营总览加载失败/);
    assert.equal(await page.locator('#operations-trend').isVisible(), true);
    await page.unroute(failedPattern);
    intentionalFailure = false;

    await selectPeriod(page, dataPeriod);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#operations-layers').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(200);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await page.locator('.operations-layer-table tbody tr').count(), 4);
    assert.deepEqual(errors, []);
    console.log('PASS M5-03 browser: exact summary values, filtered period, four layers, zero/null, empty/error states, permissions and desktop/mobile');
    console.log(JSON.stringify({ dataPeriod, emptyPeriod, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
    await cleanup(db);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
