const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('http://aiwei.test/pos-ticket-quantity', route => route.fulfill({
      contentType: 'text/html',
      body: '<main><div id="page-revenue"></div><div id="toast-container"></div></main>'
    }));
    await page.goto('http://aiwei.test/pos-ticket-quantity');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app/css/style.css'), 'utf8') });
    await page.evaluate(() => {
      window.$ = selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : document.querySelector(selector);
      window.html = (element, content) => {
        if (typeof element === 'string') element = document.querySelector(element) || document.getElementById(element);
        if (element) element.innerHTML = content;
      };
      window.Auth = { hasModuleAccess: () => true, can: () => true, isAdmin: true, currentUser: { displayName: '测试' } };
      window.Store = {};
    });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(root, 'app/js/models.js'), 'utf8')}\n;window.__models = MODELS;` });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8')}\n;window.__posTicketTest = { UI, Auth, Store };` });
    if (!await page.evaluate(() => Boolean(window.__posTicketTest))) {
      throw new Error(`Failed to initialize POS test page: ${errors.join(' | ') || 'unknown script error'}`);
    }
    await page.evaluate(async () => {
      const { UI, Store } = window.__posTicketTest;
      Store.getAll = async () => [];
      Store._request = async () => [];
      UI._loadSpaceRentReminder = async () => {};
      UI._loadTodayStats = async () => {};
      UI._loadCounterCashPanel = async () => {};
      UI._renderRevenueList = async () => {};
      UI._renderWorkshopProjects = async () => {};
      await UI.renderRevenuePage();
    });

    const ticket = page.locator('#tkt-0');
    const combo = page.locator('#tkt-1');
    assert.equal(await ticket.getAttribute('type'), 'number');
    assert.equal(await combo.getAttribute('type'), 'number');
    assert.equal(await page.locator('#cof-0').getAttribute('type'), 'hidden', 'coffee quantity interaction should remain unchanged');

    await ticket.fill('12');
    await combo.fill('2');
    const newSaleCosts = await page.evaluate(() => {
      window.__models.ticketProducts[0].costPrice = 3;
      window.__models.ticketProducts[1].costPrice = 7;
      return window.__posTicketTest.UI._getTicketItems().map(item => item.costPriceSnapshot);
    });
    assert.deepEqual(newSaleCosts, [3, 7], 'new ticket and combo sales should freeze current configured costs');
    assert.equal(await page.locator('#tkt-0-sub').innerText(), '¥120.00');
    assert.equal(await page.locator('#tkt-1-sub').innerText(), '¥50.00');
    assert.equal(await page.locator('#s-ticket').innerText(), '120.00');
    assert.equal(await page.locator('#s-combo').innerText(), '50.00');
    assert.equal(await page.locator('#pos-grand-total').innerText(), '¥170.00');

    await page.locator('#tkt-0').locator('xpath=..').getByRole('button', { name: '+' }).click();
    assert.equal(await ticket.inputValue(), '13');
    assert.equal(await page.locator('#tkt-0-sub').innerText(), '¥130.00');

    await ticket.fill('-2');
    assert.equal(await ticket.inputValue(), '0');
    await ticket.fill('2.8');
    assert.equal(await ticket.inputValue(), '2');

    await page.evaluate(async () => {
      const { UI, Store } = window.__posTicketTest;
      UI._editingId = 'existing-record';
      Store.getById = async () => ({
        date: '2026-09-14',
        ticketItems: [
          { name: '普通票', qty: 5, price: 10, costPriceSnapshot: 2.5, snapshotVersion: 1, snapshotAt: '2026-09-14T00:00:00.000Z' },
          { name: '套票', qty: 3, price: 25 }
        ],
        coffeeItems: [],
        workshopItems: [],
        retailItems: [],
        paymentMethod: '扫码支付'
      });
      await UI._fillPOSEdit('existing-record');
    });
    assert.equal(await ticket.inputValue(), '5');
    assert.equal(await combo.inputValue(), '3');
    assert.equal(await page.locator('#tkt-0-sub').innerText(), '¥50.00');
    assert.equal(await page.locator('#tkt-1-sub').innerText(), '¥75.00');
    assert.equal(await page.locator('#pos-grand-total').innerText(), '¥125.00');
    const editCosts = await page.evaluate(() => window.__posTicketTest.UI._getTicketItems().map(item => item.costPriceSnapshot));
    assert.deepEqual(editCosts, [2.5, 0], 'editing must preserve prior cost and must not backfill a legacy line');

    await page.setViewportSize({ width: 390, height: 844 });
    const box = await ticket.boundingBox();
    assert.ok(box && box.width >= 44, 'direct quantity input should remain touch friendly');
    assert.deepEqual(errors, []);
    console.log('PASS POS ticket quantity browser: quantities, cost snapshots, historical preservation, coffee isolation and mobile width');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
