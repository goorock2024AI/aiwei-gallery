const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M6_BROWSER_BASE || 'http://127.0.0.1:3132';
const title = 'M606 浏览器问题闭环';

async function clean(db) {
  await db.query('DELETE FROM trial_run_issue_events WHERE issue_id IN (SELECT id FROM trial_run_issues WHERE title=$1)', [title]);
  await db.query('DELETE FROM trial_run_issues WHERE title=$1', [title]);
}

async function login(browser, role, errors) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
  await page.goto(`${base}/index.html`);
  await page.locator('#login-username').fill(`m305-${role}`);
  await page.locator('#login-password').fill(cfg.password);
  await page.locator('#login-form button').click();
  await page.locator('#sidebar-user').waitFor();
  await page.locator('[data-tab="manage"]').click();
  await page.locator('#trial-observability-card').waitFor();
  await page.waitForFunction(() => !document.querySelector('#trial-runtime-summary')?.textContent.includes('正在读取'));
  return page;
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  await clean(db);
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    const admin = await login(browser, 'admin', errors);
    const card = admin.locator('#trial-observability-card');
    assert.match(await card.innerText(), /应用版本.*数据库.*迁移结构.*灰度状态.*API 错误.*P95 耗时/s);
    assert.match(await admin.locator('#trial-gate-tag').innerText(), /G0/);
    await card.locator('.trial-issue-form summary').click();
    await admin.locator('#trial-issue-severity').selectOption('P2');
    await admin.locator('#trial-issue-title').fill(title);
    await admin.locator('#trial-issue-owner').fill('浏览器负责人');
    await admin.locator('#trial-issue-due').fill('2026-09-13');
    await admin.locator('#trial-issue-evidence').fill('Edge 自动化复现并保留本地结果');
    await admin.locator('#trial-issue-impact').fill('只影响观测卡交互，不影响原始业务数据');
    await admin.getByRole('button', { name: '登记问题' }).click();
    const row = admin.locator('#trial-issues-list tr', { hasText: title });
    await row.waitFor();
    assert.match(await row.innerText(), /P2.*待处理.*浏览器负责人/s);

    const answers = ['2.0.0-dev.m6-06.browser', '完成页面修正并运行浏览器复验'];
    admin.on('dialog', async dialog => dialog.accept(answers.shift() || '自动化复验输入'));
    await row.getByRole('button', { name: '提交修正' }).click();
    await admin.locator('#trial-issues-list tr', { hasText: title }).getByText('待复验').waitFor();
    await admin.locator('#trial-issues-list tr', { hasText: title }).getByRole('button', { name: '完成复验' }).click();
    await admin.locator('#trial-issues-list tr', { hasText: title }).getByText('已复验').waitFor();
    assert.match(await admin.locator('#trial-issues-list tr', { hasText: title }).innerText(), /2\.0\.0-dev\.m6-06\.browser.*复验/s);

    const editor = await login(browser, 'editor', errors);
    assert.equal(await editor.locator('#trial-observability-card').isVisible(), true);
    assert.equal(await editor.locator('#operations-rollout-card').count(), 0, 'Editor must not see the rollout control');
    assert.equal(await editor.getByRole('button', { name: '完成复验' }).count(), 0, 'Editor must not receive admin verification actions');
    assert.deepEqual(errors, []);

    const result = { passed: true, runtimeCards: 6, issueCreateFixVerify: true, editorReadAndReport: true, adminOnlyVerification: true, pageErrors: 0 };
    fs.writeFileSync('tmp/m6-06-observability-browser-result.json', JSON.stringify(result, null, 2));
    console.log('PASS M6-06 browser: runtime summary, G0 state, problem registration, fix/verify lifecycle and editor/admin boundary');
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    await clean(db).catch(() => {});
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
