const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M6_BROWSER_BASE || 'http://127.0.0.1:3131';
const reason = 'M6-05浏览器自动化验证';

async function setMode(db, mode) {
  await db.query(`INSERT INTO app_config(key,value,updated_at) VALUES('operations_rollout',$1,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, [JSON.stringify({ mode })]);
}

async function login(browser, role, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
  await page.goto(`${base}/index.html`);
  await page.locator('#login-username').fill(`m305-${role}`);
  await page.locator('#login-password').fill(cfg.password);
  const rolloutResponse = page.waitForResponse(response => response.url().includes('/rest/v1/operations-rollout') && response.request().method() === 'GET');
  await page.locator('#login-form button').click();
  await rolloutResponse;
  await page.locator('#sidebar-user').waitFor();
  return page;
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  const original = (await db.query("SELECT value,updated_at FROM app_config WHERE key='operations_rollout'")).rows[0] || null;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    await setMode(db, 'off');
    const offAdmin = await login(browser, 'admin', errors);
    const offNav = offAdmin.locator('[data-tab="operations"]');
    assert.equal(await offNav.isVisible(), false, 'Off mode must hide the admin entry');
    await offAdmin.evaluate(async () => {
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      document.querySelector('#page-operations').classList.add('active');
      await OperationsDashboard.render();
    });
    assert.equal(await offAdmin.locator('#page-operations .operations-shell').count(), 0);
    assert.match(await offAdmin.locator('#page-operations').innerText(), /未对该账号开放/);

    await setMode(db, 'admin');
    const admin = await login(browser, 'admin', errors);
    const adminNav = admin.locator('[data-tab="operations"]');
    assert.equal(await adminNav.isVisible(), true);
    assert.match(await adminNav.innerText(), /管理员试运行/);
    const adminEditor = await login(browser, 'editor', errors);
    assert.equal(await adminEditor.locator('[data-tab="operations"]').isVisible(), false);
    const adminViewer = await login(browser, 'viewer', errors);
    assert.equal(await adminViewer.locator('[data-tab="operations"]').isVisible(), false);

    await setMode(db, 'staff');
    const staffEditor = await login(browser, 'editor', errors);
    const editorNav = staffEditor.locator('[data-tab="operations"]');
    assert.equal(await editorNav.isVisible(), true);
    assert.match(await editorNav.innerText(), /内部试运行/);
    await editorNav.click();
    await staffEditor.locator('.operations-shell').waitFor();
    assert.match(await staffEditor.locator('.operations-trial-badge').innerText(), /内部试运行/);
    const staffViewer = await login(browser, 'viewer', errors);
    assert.equal(await staffViewer.locator('[data-tab="operations"]').isVisible(), false);

    await setMode(db, 'admin');
    const manageAdmin = await login(browser, 'admin', errors);
    await manageAdmin.locator('[data-tab="manage"]').click();
    await manageAdmin.locator('#operations-rollout-card').waitFor();
    await manageAdmin.locator('#operations-rollout-mode').selectOption('off');
    await manageAdmin.locator('#operations-rollout-reason').fill(reason);
    await manageAdmin.getByRole('button', { name: '保存灰度范围' }).click();
    await manageAdmin.locator('#operations-rollout-card').getByText('当前范围：已关闭').waitFor();
    assert.equal(await manageAdmin.locator('[data-tab="operations"]').isVisible(), false);
    assert.equal(await manageAdmin.locator('[data-tab="revenue"]').isVisible(), true, '1.0 entry must remain visible');
    assert.deepEqual(errors, []);

    const result = {
      passed: true,
      offDirectAccessBlocked: true,
      adminRoleMatrix: true,
      staffRoleMatrix: true,
      trialBadges: true,
      adminControl: true,
      legacyEntryUnaffected: true,
      pageErrors: 0
    };
    fs.writeFileSync('tmp/m6-05-rollout-browser-result.json', JSON.stringify(result, null, 2));
    console.log('PASS M6-05 browser: hidden entry, direct-page guard, admin/staff role matrix, trial badges and admin switch');
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    await db.query("DELETE FROM operation_logs WHERE action='operations_rollout_change' AND details->>'reason'=$1", [reason]).catch(() => {});
    if (original) {
      await db.query(`INSERT INTO app_config(key,value,updated_at) VALUES('operations_rollout',$1,$2)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, [original.value, original.updated_at]);
    } else {
      await db.query("DELETE FROM app_config WHERE key='operations_rollout'").catch(() => {});
    }
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
