// Requires isolated M4 API localhost:3112, Edge and Playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('fs'),assert=require('assert/strict');
(async()=>{const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3112/index.html');await page.locator('#login-username').fill('m305-editor');await page.locator('#login-password').fill(cfg.password);await page.locator('#login-form button').click();
  await page.locator('[data-tab="reports"]').click();await page.locator('#rpt-year').selectOption('2026');await page.locator('#rpt-month').selectOption('11');
  const summary=page.locator('#v2-management-summary');await summary.filter({hasText:'数据治理基线'}).waitFor();await summary.filter({hasText:'M309缺成本商品'}).waitFor();await summary.locator('code').first().waitFor();
  assert.match(await summary.locator('code').first().innerText(),/^gov_[0-9a-f]{20}$/);assert.match(await summary.innerText(),/影响金额.*问题 ID.*优先级/s);
  const [download]=await Promise.all([page.waitForEvent('download'),summary.getByRole('button',{name:'导出治理清单'}).click()]);
  assert.equal(download.suggestedFilename(),'数据治理基线-2026-11.csv');const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/问题ID.*稳定问题键/s);assert.match(csv,/gov_[0-9a-f]{20}/);
  await page.screenshot({path:'tmp/m4-02-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await summary.scrollIntoViewIfNeeded();await page.screenshot({path:'tmp/m4-02-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS M4-02 browser: baseline amounts, stable IDs, CSV export, desktop/mobile and zero page errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
