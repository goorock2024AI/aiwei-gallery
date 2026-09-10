const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3126';
const periods = Array.from({ length: 72 }, (_, index) => `${2021 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`);

async function raw(pathname, token) {
  return fetch(`${base}/rest/v1/${pathname}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

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

async function token(role) {
  return (await api('login', '', 200, 'POST', { username: `m305-${role}`, password: cfg.password })).token;
}

async function cleanup(db) {
  await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm508-%'; DELETE FROM record_business_links WHERE source_id LIKE 'm508-%'; DELETE FROM revenue WHERE id LIKE 'm508-%'");
}

const countBy = (urls, pattern) => urls.filter(url => pattern.test(url)).length;

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres', password: cfg.password });
  let browser;
  await db.connect();
  try {
    await cleanup(db);
    const editorToken = await token('editor');
    const dimensionsNoCount = await raw('business_dimensions?limit=1&count=none', editorToken);
    assert.equal(dimensionsNoCount.status, 200);
    assert.equal(dimensionsNoCount.headers.has('content-range'), false);
    const dimensionsWithCount = await raw('business_dimensions?limit=1', editorToken);
    assert.equal(dimensionsWithCount.status, 200);
    assert.equal(dimensionsWithCount.headers.has('content-range'), true);

    const occupied = new Set((await api('business_revenue_facts_v2?order=business_date.asc&limit=5000&count=none', editorToken)).map(row => String(row.businessDate).slice(0, 7)));
    const period = periods.find(value => !occupied.has(value) && periods.some(other => other !== value && other.startsWith(value.slice(0, 4)) && !occupied.has(other)));
    assert.ok(period, 'Expected two unused months in one supported year');
    const siblingPeriod = periods.find(value => value !== period && value.startsWith(period.slice(0, 4)) && !occupied.has(value));
    await api('revenue', editorToken, 201, 'POST', { id: 'm508-ticket', date: `${period}-15`, ticketQty: 2, ticketAmount: 88, status: '正常', paymentMethod: '扫码支付' });

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const urls = [];
    const errors = [];
    let intentionalFailure = false;
    page.on('request', request => { if (request.url().includes('/rest/v1/') && request.method() === 'GET') urls.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !intentionalFailure && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    const [year, month] = period.split('-');
    await page.locator('#operations-year').selectOption(year);
    await page.locator('#operations-month').selectOption(month);
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    await page.locator('#operations-model-state').filter({ hasText: /数据已就绪/ }).waitFor();
    await page.locator('#operations-refresh-status').filter({ hasText: new RegExp(`${year}年${Number(month)}月.*ms`) }).waitFor();
    assert.equal(await page.locator('.operations-detail-row').count(), 1);
    const operationalGets = urls.filter(url => !url.includes('/app_config'));
    assert.ok(operationalGets.filter(url => /business_|revenue_facts|governance|candidate/.test(url)).every(url => url.includes('count=none')), 'Every M5 bounded GET should skip total counts');

    const before = {
      dimension: countBy(urls, /business_dimensions\?/),
      trend: countBy(urls, /business_layer_summary_v2\?.*period_month=gte/),
      legacy: countBy(urls, /revenue_facts\?.*date=gte/),
      aliases: countBy(urls, /product_alias_candidates_v2\?/),
      products: countBy(urls, /product_master_governance_v2\?/)
    };
    const [, siblingMonth] = siblingPeriod.split('-');
    await page.locator('#operations-month').selectOption(siblingMonth);
    await page.locator('#operations-refresh-status').filter({ hasText: new RegExp(`${year}年${Number(siblingMonth)}月.*ms`) }).waitFor();
    assert.equal(countBy(urls, /business_dimensions\?/), before.dimension);
    assert.equal(countBy(urls, /business_layer_summary_v2\?.*period_month=gte/), before.trend);
    assert.equal(countBy(urls, /revenue_facts\?.*date=gte/), before.legacy);
    assert.equal(countBy(urls, /product_alias_candidates_v2\?/), before.aliases);
    assert.equal(countBy(urls, /product_master_governance_v2\?/), before.products);
    assert.match(await page.locator('#operations-trend-state').innerText(), /缓存/);
    assert.match(await page.locator('#operations-model-state').innerText(), /缓存/);

    await page.locator('#operations-month').selectOption(month);
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    const detail = page.locator('#operations-detail-content');
    const preservedRows = await detail.locator('.operations-detail-row').count();
    intentionalFailure = true;
    await page.route('**/rest/v1/business_revenue_facts_v2?**', route => route.abort());
    await page.locator('#operations-refresh').click();
    assert.equal(await page.locator('.operations-shell').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#operations-refresh').isDisabled(), true);
    await page.locator('#operations-detail-state').filter({ hasText: '加载失败' }).waitFor();
    assert.match(await detail.innerText(), /刷新失败，已保留上次成功数据/);
    assert.equal(await detail.locator('.operations-detail-row').count(), preservedRows);
    await page.locator('#operations-refresh-status').filter({ hasText: /部分数据加载失败.*ms/ }).waitFor();
    assert.equal(await page.locator('.operations-shell').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#operations-refresh').isDisabled(), false);
    await page.unroute('**/rest/v1/business_revenue_facts_v2?**');
    intentionalFailure = false;
    await page.evaluate(() => OperationsDashboard._loadDetail());
    await page.locator('#operations-detail-state').filter({ hasText: '数据已就绪' }).waitFor();
    assert.equal(await detail.locator('.operations-stale-notice').count(), 0);

    const forcedBefore = countBy(urls, /business_dimensions\?/);
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-refresh-status').filter({ hasText: new RegExp(`${year}年${Number(month)}月.*ms`) }).waitFor();
    assert.ok(countBy(urls, /business_dimensions\?/) > forcedBefore, 'Manual refresh must bypass the dimension cache');

    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-08-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-08-mobile.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#operations-detail').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(150);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await page.locator('#operations-detail').getAttribute('aria-busy'), 'false');
    assert.deepEqual(errors, []);
    console.log('PASS M5-08 browser: count suppression, request cancellation, year/global caches, forced refresh, stale-data fallback, busy states and responsive reduced motion');
    console.log(JSON.stringify({ period, siblingPeriod, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
    await cleanup(db);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
