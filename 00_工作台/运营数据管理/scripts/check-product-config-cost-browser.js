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
    await page.route('http://aiwei.test/product-config-cost', route => route.fulfill({
      contentType: 'text/html',
      body: '<main><div id="page-products"></div><div id="toast-container"></div></main>'
    }));
    await page.goto('http://aiwei.test/product-config-cost');
    await page.evaluate(() => {
      window.$ = selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : document.querySelector(selector);
      window.html = (element, content) => {
        if (typeof element === 'string') element = document.querySelector(element) || document.getElementById(element);
        if (element) element.innerHTML = content;
      };
      window.Auth = {
        hasModuleAccess: () => true,
        can: () => true,
        isAdmin: true,
        currentUser: { displayName: '测试管理员' }
      };
      window.Store = {};
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'app/js/models.js'), 'utf8') });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8')}\n;window.__productCostTest = { UI, Auth, Store, MODELS };` });
    if (!await page.evaluate(() => Boolean(window.__productCostTest))) {
      throw new Error(`Failed to initialize product cost test page: ${errors.join(' | ') || 'unknown script error'}`);
    }

    await page.evaluate(async () => {
      const { UI, Store, MODELS } = window.__productCostTest;
      MODELS.ticketProducts = [
        { name: '普通票', price: 10 },
        { name: '套票', costPrice: 6.5, price: 25 }
      ];
      MODELS.coffeeProducts = [{ name: '手冲咖啡', costPrice: 4.2, price: 15 }];
      Store.loadAppConfig = async () => true;
      Store.getAll = async () => [];
      Store.saveConfig = async (key, value) => {
        window.__savedConfig = { key, value };
        return true;
      };
      UI._loadCreativeProducts = async () => { UI._creativeProducts = []; };
      UI._loadArtworks = async () => { UI._artworks = []; };
      UI._productTab = 'ticket';
      await UI.renderProductPage();
    });

    const ticketHeaders = await page.locator('#product-tab-content th').allTextContents();
    assert.deepEqual(ticketHeaders.slice(0, 3), ['名称', '成本价', '售价']);
    assert.match(await page.locator('#product-tab-content').innerText(), /套票\s+¥6\.50\s+¥25\.00/);
    assert.match(await page.locator('#product-tab-content').innerText(), /普通票\s+¥0\.00\s+¥10\.00/);

    await page.getByRole('button', { name: '编辑' }).nth(1).click();
    assert.equal(await page.locator('#cfg-cost').inputValue(), '6.5');
    await page.locator('#cfg-cost').fill('7.25');
    await page.locator('#cfg-save-btn').click();
    const savedTicket = await page.evaluate(() => window.__savedConfig);
    assert.equal(savedTicket.key, 'ticket_products');
    assert.deepEqual(savedTicket.value[1], { name: '套票', costPrice: 7.25, price: 25 });

    await page.evaluate(() => {
      const { UI } = window.__productCostTest;
      UI._productTab = 'coffee';
      UI._refreshCurrentProductTab();
    });
    assert.deepEqual((await page.locator('#product-tab-content th').allTextContents()).slice(0, 3), ['名称', '成本价', '售价']);
    await page.getByRole('button', { name: '编辑' }).click();
    assert.equal(await page.locator('#cfg-cost').inputValue(), '4.2');
    await page.locator('#cfg-cost').fill('5');
    await page.locator('#cfg-save-btn').click();
    const savedCoffee = await page.evaluate(() => window.__savedConfig);
    assert.equal(savedCoffee.key, 'coffee_products');
    assert.deepEqual(savedCoffee.value[0], { name: '手冲咖啡', costPrice: 5, price: 15 });

    await page.evaluate(() => {
      const { UI } = window.__productCostTest;
      UI._productTab = 'workshop';
      UI._refreshCurrentProductTab();
    });
    assert.deepEqual((await page.locator('#product-tab-content th').allTextContents()).slice(0, 3), ['名称', '成本价', '售价']);
    await page.getByRole('button', { name: '编辑' }).first().click();
    assert.equal(await page.locator('#cfg-cost').inputValue(), '0');
    await page.locator('#cfg-cost').fill('18.5');
    await page.locator('#cfg-save-btn').click();
    const savedWorkshop = await page.evaluate(() => window.__savedConfig);
    assert.equal(savedWorkshop.key, 'workshop_products');
    assert.deepEqual(savedWorkshop.value[0], { name: '果壳风铃', costPrice: 18.5, price: 128 });

    assert.deepEqual(errors, []);
    console.log('PASS product config cost browser: ticket/coffee/workshop columns, legacy zero fallback, edit persistence');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
