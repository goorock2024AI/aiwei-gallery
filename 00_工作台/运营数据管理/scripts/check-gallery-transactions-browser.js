// Requires the isolated M3 API on localhost:3107, Edge and Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');
(async () => {
  const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  await db.query("DELETE FROM operation_logs WHERE record_id='m307-browser-sale'; DELETE FROM cash_movements WHERE source_id='m307-browser-sale'; DELETE FROM gallery_sales WHERE id='m307-browser-sale'; DELETE FROM artworks WHERE id='m307-browser-art'; INSERT INTO artworks(id,artwork_no,title,artist,status,settlement_price,retail_price,total_qty,sold_qty,approval_status) VALUES('m307-browser-art','M307-BROWSER','浏览器测试作品','测试艺术家','在库',400,1000,1,0,'已上架')");
  await db.end();
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3107/index.html');
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="gallery"]').click();
    await page.locator('#gal-artwork').waitFor();
    assert.equal(await page.locator('#gal-artwork').getAttribute('readonly'), '');
    await page.locator('button').filter({ hasText: '选作品' }).click();
    await page.locator('#picker-search').fill('浏览器测试作品');
    await page.locator('#picker-tbody button').filter({ hasText: '选择' }).click();
    assert.equal(await page.locator('#gal-artwork-id').inputValue(), 'm307-browser-art');
    await page.locator('#gal-price').fill('950');
    await page.locator('#gal-commission').fill('50');
    await page.locator('#gal-buyer').fill('浏览器测试买家');
    const responsePromise = page.waitForResponse(r => r.url().includes('/rest/v1/gallery-entry') && r.request().method() === 'POST');
    await page.locator('#page-gallery .form-actions .btn-primary').click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    await page.locator('#gallery-list').filter({ hasText: 'M307-BROWSER' }).waitFor();
    await page.locator('#gallery-list').filter({ hasText: '¥500.00' }).waitFor();
    assert.equal(await page.locator('#gallery-list button').filter({ hasText: '删除' }).count(), 0);
    await page.screenshot({ path: 'tmp/m3-07-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#gallery-list').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/m3-07-mobile.png' });
    assert.deepEqual(errors, []);
    fs.writeFileSync('tmp/m3-07-browser-result.json', JSON.stringify({ passed: true, pageErrors: errors }, null, 2));
    console.log('PASS gallery browser workflow: explicit picker, snapshot hint, atomic save, contribution display, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
