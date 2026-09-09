const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M5_BROWSER_BASE || 'http://127.0.0.1:3121';

async function login(page, role) {
  await page.goto(`${base}/index.html`);
  await page.locator('#login-username').fill(`m305-${role}`);
  await page.locator('#login-password').fill(cfg.password);
  await page.locator('#login-form button').click();
  await page.locator('#sidebar-user').waitFor();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  const desktopPath = path.join(os.tmpdir(), 'aiwei-m5-02-desktop.png');
  const mobilePath = path.join(os.tmpdir(), 'aiwei-m5-02-mobile.png');
  try {
    const admin = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    admin.on('pageerror', error => errors.push(`admin: ${error.message}`));
    admin.on('console', message => { if (message.type() === 'error') errors.push(`admin console: ${message.text()}`); });
    await login(admin, 'admin');
    const nav = admin.locator('[data-tab="operations"]');
    await nav.waitFor();
    assert.equal(await nav.isVisible(), true);
    await nav.click();
    const shell = admin.locator('.operations-shell');
    await shell.getByRole('heading', { name: '美术馆运营管理' }).waitFor();
    assert.equal(await shell.locator('.operations-section').count(), 6);
    assert.match(await shell.innerText(), /经营总览.*四层经营矩阵.*趋势与口径比较.*数据治理工作台.*业务模型对应.*明细与导出/s);
    await admin.locator('#operations-year').selectOption('2025');
    await admin.locator('#operations-month').selectOption('06');
    await admin.locator('#operations-period-label').filter({ hasText: '2025年6月' }).waitFor();
    assert.equal(await shell.getAttribute('data-period'), '2025-06');
    const governanceLink = admin.locator('[data-operations-target="operations-governance"]');
    await governanceLink.click();
    assert.match(await governanceLink.getAttribute('class'), /active/);
    assert.equal(await admin.locator('#operations-governance').evaluate(element => document.activeElement === element), true);
    await admin.locator('#operations-refresh').click();
    await admin.locator('#operations-refresh-status').filter({ hasText: '已更新 · 2025年6月' }).waitFor();
    await admin.screenshot({ path: desktopPath, fullPage: true });

    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.locator('#sidebar-toggle').click();
    await nav.waitFor({ state: 'visible' });
    await nav.click();
    await admin.waitForFunction(() => !document.getElementById('sidebar')?.classList.contains('open'));
    await admin.waitForTimeout(300);
    await admin.locator('.operations-hero').waitFor();
    await admin.screenshot({ path: mobilePath, fullPage: false });

    const editor = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    editor.on('pageerror', error => errors.push(`editor: ${error.message}`));
    await login(editor, 'editor');
    assert.equal(await editor.locator('[data-tab="operations"]').isVisible(), true);

    const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    viewer.on('pageerror', error => errors.push(`viewer: ${error.message}`));
    await login(viewer, 'viewer');
    assert.equal(await viewer.locator('[data-tab="operations"]').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(`PASS M5-02 browser: admin/editor entry, viewer hidden, six sections, period/section/refresh interactions, desktop/mobile and zero page errors`);
    console.log(JSON.stringify({ desktopPath, mobilePath }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
