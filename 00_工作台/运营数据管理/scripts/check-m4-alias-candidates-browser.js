// Requires isolated M4 API localhost:3113, Edge and Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const assert = require('assert/strict');

(async () => {
  const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3113/index.html');
    await page.locator('#login-username').fill('m305-editor');
    await page.locator('#login-password').fill(cfg.password);
    await page.locator('#login-form button').click();
    await page.locator('[data-tab="reports"]').click();
    const card = page.locator('#v2-alias-candidates-card');
    await card.filter({hasText:'历史商品别名候选'}).waitFor();
    await card.filter({hasText:'M403历史水'}).waitFor();
    assert.match(await card.innerText(), /已精确匹配.*唯一候选.*存在歧义.*无候选/s);
    assert.match(await card.locator('code').first().innerText(), /^aliascand_[0-9a-f]{20}$/);
    await card.locator('#alias-candidate-status').selectOption('ambiguous');
    await card.filter({hasText:'M403歧义商品'}).waitFor();
    assert.equal(await card.locator('tbody tr').count(), 1);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('button',{name:'导出候选清单'}).click()
    ]);
    assert.equal(download.suggestedFilename(), '历史商品别名候选-ambiguous.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.match(csv, /候选ID.*匹配依据.*复核说明/s);
    assert.match(csv, /M403歧义商品/);
    await page.screenshot({path:'tmp/m4-03-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({path:'tmp/m4-03-mobile.png'});
    assert.deepEqual(errors, []);
    console.log('PASS M4-03 browser: four-state summary, status filter, stable ID, CSV export, desktop/mobile and zero page errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
