const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'app/js/auth.js'), 'utf8');
const viewerReadTables = serverSource.match(/viewer:\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] || '';
const writeTables = serverSource.match(/const writeTables = \{([\s\S]*?)\n\s*\};/)?.[1] || '';
assert.match(viewerReadTables, /'cash_movements'/, 'viewer must have read-only access to cash movements for financial reconciliation');
assert.match(authSource, /viewer:\s*\{[\s\S]*?export:\s*\['daily-closing'\]/, 'viewer must have daily-closing export permission');
assert.doesNotMatch(writeTables, /viewer\s*:/, 'viewer must not gain write access to any table');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://aiwei.test/daily-closing-finance', route => route.fulfill({
      contentType: 'text/html',
      body: '<main><div id="page-daily-closing"></div><div id="toast-container"></div></main>'
    }));
    await page.goto('http://aiwei.test/daily-closing-finance');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app/css/style.css'), 'utf8') });
    await page.evaluate(() => {
      window.$ = selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : document.querySelector(selector);
      window.html = (element, content) => {
        if (typeof element === 'string') element = document.querySelector(element) || document.getElementById(element);
        if (element) element.innerHTML = content;
      };
      window.Auth = {
        hasModuleAccess: key => key === 'daily-closing',
        can: (action, scope) => action === 'export' && scope === 'daily-closing',
        isAdmin: false,
        currentUser: { role: 'viewer', displayName: '财务测试' }
      };
      const facts = [
        { date: '2026-08-15', category: '衍生品', paymentMethod: '现金', source: 'pos', amount: 200, netAmount: 200 },
        { date: '2026-09-24', category: '门票', paymentMethod: '现金', source: 'pos', amount: 100, netAmount: 100 }
      ];
      const closings = [{
        id: 'closing-1', date: '2026-09-24', status: '已复核', systemNetAmount: 100,
        confirmedAmount: 100, differenceAmount: 0, closerName: '前台', reviewerName: '财务'
      }, {
        id: 'closing-history', date: '2026-08-15', status: '已复核', systemNetAmount: 200,
        confirmedAmount: 200, differenceAmount: 0, closerName: '前台', reviewerName: '财务'
      }];
      const cash = [
        { date: '2026-08-14', type: 'cash_payment', amount: 20 },
        { date: '2026-08-15', type: 'cash_payment', amount: 200 },
        { date: '2026-08-15', type: 'cash_deposit', amount: -150 },
        { date: '2026-09-23', type: 'cash_payment', amount: 50 },
        { date: '2026-09-24', type: 'cash_payment', amount: 100 },
        { date: '2026-09-24', type: 'cash_deposit', amount: -80 }
      ];
      window.__rangeCalls = [];
      window.Store = {
        getByDateRange: async (type, start, end) => {
          window.__rangeCalls.push({ type, start, end });
          const rows = type === 'revenueFacts' ? facts : type === 'dailyClosings' ? closings : [];
          return rows.filter(row => row.date >= start && row.date <= end);
        },
        getAll: async type => type === 'cashMovements' ? cash : type === 'revenueFacts' ? facts : []
      };
      window.__xlsxCapture = {};
      window.XLSX = {
        utils: {
          json_to_sheet: rows => { window.__xlsxCapture.rows = rows; return {}; },
          book_new: () => ({}),
          book_append_sheet: (book, sheet, name) => { window.__xlsxCapture.sheetName = name; }
        },
        writeFile: (book, filename) => { window.__xlsxCapture.filename = filename; }
      };
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'app/js/models.js'), 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'app/js/import-export.js'), 'utf8') });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8')}\n;window.__dailyClosingTest = UI;` });
    await page.evaluate(async () => {
      window.__dailyClosingTest._dailyClosingDate = '2026-09-24';
      await window.__dailyClosingTest.renderDailyClosingPage();
    });

    assert.equal(await page.getByLabel('历史导出月份').inputValue(), '2026-09');
    assert.equal(await page.getByRole('button', { name: '导出所选月份' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '导出收入明细' }).count(), 1);
    const row = page.locator('#daily-closing-month-list tbody tr').filter({ hasText: '2026-09-24' });
    assert.match(await row.innerText(), /¥80\.00/);
    assert.equal(await page.locator('#daily-closing-detail-modal').count(), 0, 'detail should not occupy the page bottom');

    await row.getByRole('button', { name: '查看' }).click();
    const modal = page.locator('#daily-closing-detail-modal');
    await modal.waitFor();
    assert.match(await modal.innerText(), /2026-09-24 日结明细/);
    assert.match(await modal.innerText(), /存现金[\s\S]*¥80\.00/);

    await modal.getByRole('button', { name: '关闭日结明细' }).click();
    assert.equal(await modal.count(), 0);
    await page.getByLabel('历史导出月份').fill('2026-08');
    await page.getByRole('button', { name: '导出所选月份' }).click();
    const exported = await page.evaluate(() => window.__xlsxCapture);
    const exportedDay = exported.rows.find(item => item['日期'] === '2026-08-15');
    assert.ok(exportedDay);
    assert.equal(exportedDay['柜台现金期初'], 20);
    assert.equal(exportedDay['现金收款'], 200);
    assert.equal(exportedDay['存现金'], 150);
    assert.equal(exportedDay['柜台现金期末'], 70);
    assert.equal(exported.filename, '艾维美术馆_2026-08_日结报表.xlsx');
    assert.ok(!exported.rows.some(item => item['日期'] === '2026-09-24'), 'historical export must not include the viewed month');
    const rangeCalls = await page.evaluate(() => window.__rangeCalls);
    assert.ok(rangeCalls.some(call => call.start === '2026-08-01' && call.end === '2026-08-31'), 'historical month range must drive export queries');

    const revenueDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出收入明细' }).click();
    const revenueDownload = await revenueDownloadPromise;
    assert.equal(revenueDownload.suggestedFilename(), '艾维美术馆_收入_2026-08-01_2026-08-31.csv');
    const revenueCsv = fs.readFileSync(await revenueDownload.path(), 'utf8');
    assert.match(revenueCsv, /日期,来源,分类,收入金额,净收入,收款方式,项目\/关联,经手人,原记录ID,创建时间/);
    assert.match(revenueCsv, /2026-08-15,收银台,衍生品,200\.00,200\.00,现金/);
    assert.doesNotMatch(revenueCsv, /2026-09-24/, 'income detail export must follow the selected historical month');

    await page.setViewportSize({ width: 390, height: 844 });
    await row.getByRole('button', { name: '查看' }).click();
    const box = await page.locator('.daily-closing-detail-modal').boundingBox();
    assert.ok(box && box.width <= 390, 'daily closing modal should fit mobile viewport');
    assert.deepEqual(errors, []);
    console.log('PASS daily closing finance browser: deposit visibility, modal detail, monthly closing export, matching income detail CSV and mobile layout');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
