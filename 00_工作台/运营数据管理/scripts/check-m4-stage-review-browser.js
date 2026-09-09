// Requires the isolated M4 API, Edge, and the bundled Playwright runtime.
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M4_BROWSER_BASE || 'http://127.0.0.1:3119';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/index.html`);
    await page.locator('#login-username').fill('m305-admin');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('#sidebar-version').filter({ hasText: 'v2.0.0-dev.m4-10.1' }).waitFor();

    await page.locator('[data-tab="reports"]').click();
    for (const id of [
      '#v2-governance-card', '#v2-alias-candidates-card', '#v2-product-governance-card',
      '#v2-revenue-attribution-card', '#v2-cost-attribution-card', '#v2-gallery-links-card',
      '#v2-workshop-links-card', '#v2-space-classification-card'
    ]) {
      await page.locator(id).waitFor();
    }
    const reportText = await page.locator('#page-reports').innerText();
    assert.match(reportText, /只读候选/);
    assert.match(reportText, /人工/);
    await page.screenshot({ path: 'tmp/m4-10-desktop.png', fullPage: true });

    await page.locator('[data-tab="manage"]').click();
    const batches = page.locator('#governance-batches-card');
    await batches.getByText('治理变更批次').waitFor();
    await page.waitForFunction(() => !document.querySelector('#governance-batches-list')?.textContent.includes('正在加载'));
    assert.match(await batches.innerText(), /可预览.*可审计.*可撤销.*应用只写解释层/s);
    await page.setViewportSize({ width: 390, height: 844 });
    await batches.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/m4-10-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS M4-10 browser: version, eight governance surfaces, human-review guidance, batch workflow, desktop/mobile and zero page errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
