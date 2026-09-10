const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;
const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3124';

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

(async () => {
  const editorToken = await loginToken('editor');
  const adminToken = await loginToken('admin');
  const viewerToken = await loginToken('viewer');
  const rows = await api('business_dimensions?order=sort_order.asc&limit=500', editorToken);
  const model = dashboard._buildBusinessModel(rows);
  assert.equal(model.groups.length, 4);
  assert.deepEqual(model.groups[0].items.filter(item => item.active).map(item => item.code), ['visit', 'onsite_consumption', 'experience_activity', 'art_transaction_cooperation']);
  await api('business_dimensions?limit=1', adminToken, 200);
  await api('business_dimensions?limit=1', viewerToken, 200);
  await api('business_dimensions?limit=1', '', 401);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [];
    const requests = [];
    let intentionalFailure = false;
    const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-06-desktop.png');
    const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-06-mobile.png');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !intentionalFailure && !message.text().startsWith('Failed to load resource:')) errors.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
      if (response.status() >= 500 && response.url().includes('/business_dimensions?') && !intentionalFailure) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('request', request => { if (request.url().includes('/business_dimensions?')) requests.push(request.url()); });
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="operations"]').click();
    await page.locator('#operations-model-state').filter({ hasText: model.hasRows ? '数据已就绪' : '字典为空' }).waitFor();
    const section = page.locator('#operations-model-content');
    assert.equal(await section.locator('[data-dimension-type]').count(), 4);
    assert.equal(await section.locator('[data-model-metric]').count(), 9);
    assert.equal(await section.locator('[data-dimension-type="business_layer"] [data-dimension-code]').count(), model.groups[0].items.length);
    for (const layer of model.groups[0].items.filter(item => item.active)) {
      assert.equal(await section.locator(`[data-dimension-type="business_layer"] [data-dimension-code="${layer.code}"]`).count(), 1);
    }
    assert.match(await section.innerText(), /经营事实链/);
    assert.match(await section.innerText(), /全局模型说明，不随当前年月筛选变化/);
    assert.ok(requests.some(url => url.includes('order=sort_order.asc') && url.includes('limit=500')));
    await page.locator('#operations-model').screenshot({ path: desktopPath });

    const originalCount = requests.length;
    await page.locator('#operations-month').selectOption('02');
    await page.locator('#operations-refresh-status').filter({ hasText: /已更新|部分数据加载失败/ }).waitFor();
    assert.equal(requests.length, originalCount, 'Period changes should reuse the global dictionary cache');

    intentionalFailure = true;
    await page.route('**/rest/v1/business_dimensions?**', route => route.abort());
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-model-state').filter({ hasText: '加载失败' }).waitFor();
    assert.match(await section.innerText(), /业务维度字典加载失败/);
    assert.match(await section.innerText(), /经营事实链/);
    assert.notEqual(await page.locator('#operations-overview-state').innerText(), '加载失败');
    assert.notEqual(await page.locator('#operations-trend-state').innerText(), '加载失败');
    await page.unroute('**/rest/v1/business_dimensions?**');
    intentionalFailure = false;
    await page.locator('#operations-refresh').click();
    await page.locator('#operations-model-state').filter({ hasText: model.hasRows ? '数据已就绪' : '字典为空' }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#operations-model').evaluate(element => window.scrollTo(0, element.offsetTop - 64));
    await page.waitForTimeout(200);
    await page.screenshot({ path: mobilePath, fullPage: false });
    assert.equal(await section.locator('.operations-dimension-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await section.locator('.operations-fact-chain').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);

    const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await viewer.goto(`${base}/index.html`);
    await viewer.locator('#login-username').fill('m305-viewer');
    await viewer.locator('#login-password').fill(cfg.password);
    await viewer.locator('#login-form button').click();
    assert.equal(await viewer.locator('[data-tab="operations"]').isVisible(), false);
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log('PASS M5-06 browser: exact dictionary mapping, bounded global query, isolated failure, permissions and desktop/mobile');
    console.log(JSON.stringify({ dimensions: model.totalCount, active: model.activeCount, desktopPath, mobilePath }));
  } finally {
    if (browser) await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
