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
    await page.route('http://aiwei.test/pos-autocomplete', route => route.fulfill({
      contentType: 'text/html',
      body: '<main><div id="page-revenue"></div><div id="toast-container"></div></main>'
    }));
    await page.goto('http://aiwei.test/pos-autocomplete');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app/css/style.css'), 'utf8') });
    await page.evaluate(() => {
      window.$ = selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : document.querySelector(selector);
      window.html = (element, content) => {
        if (typeof element === 'string') element = document.querySelector(element) || document.getElementById(element);
        if (element) element.innerHTML = content;
      };
      window.Auth = { hasModuleAccess: () => true, can: () => true, isAdmin: true };
      window.Store = {};
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'app/js/models.js'), 'utf8') });
    await page.addScriptTag({ content: `${fs.readFileSync(path.join(root, 'app/js/ui.js'), 'utf8')}\n;window.__posAutocompleteTest = { UI, Auth, Store };` });
    if (!await page.evaluate(() => Boolean(window.__posAutocompleteTest))) {
      throw new Error(`Failed to initialize POS test page: ${errors.join(' | ') || 'unknown script error'}`);
    }
    await page.evaluate(async () => {
      const { UI, Auth, Store } = window.__posAutocompleteTest;
      const products = [
        { id: 'cola', name: '可口可乐', standardName: '可口可乐经典', retailPrice: 3.5, stock: 12, unit: '瓶', approvalStatus: '已上架', isActive: true },
        { id: 'coffee', name: '美式咖啡', retailPrice: 18, stock: 8, unit: '杯', approvalStatus: '已上架', isActive: true },
        { id: 'bag', name: '艾维托特包', retailPrice: 28, stock: 5, unit: '个', approvalStatus: '已上架', isActive: true }
      ];
      Auth.hasModuleAccess = () => true;
      Auth.can = () => true;
      Auth.isAdmin = true;
      Store.getAll = async table => table === 'creativeProducts' ? products : [];
      Store._request = async (method, path) => path.includes('product_aliases')
        ? [{ standardProductId: 'bag', aliasName: '环保袋' }]
        : [];
      UI._loadSpaceRentReminder = async () => {};
      UI._loadTodayStats = async () => {};
      UI._loadCounterCashPanel = async () => {};
      UI._renderRevenueList = async () => {};
      UI._renderWorkshopProjects = async () => {};
      await UI.renderRevenuePage();
    });

    const name = page.locator('#rt-name');
    const suggestions = page.locator('#rt-product-suggestions');
    await name.fill('可乐');
    const cola = suggestions.getByRole('option', { name: /可口可乐/ });
    await cola.waitFor();
    assert.equal(await suggestions.getByRole('option').count(), 1);
    await name.press('Enter');
    assert.equal(await name.inputValue(), '可口可乐');
    assert.equal(await page.locator('#rt-price').inputValue(), '3.5');
    assert.equal(await name.getAttribute('aria-expanded'), 'false');

    await name.fill('环保袋');
    await suggestions.getByRole('option', { name: /艾维托特包/ }).waitFor();
    await suggestions.getByRole('option', { name: /艾维托特包/ }).click();
    assert.equal(await name.inputValue(), '艾维托特包');
    assert.equal(await page.locator('#rt-price').inputValue(), '28');

    await name.fill('不存在商品');
    await suggestions.getByText('没有匹配商品，可继续手动输入').waitFor();

    await page.getByTitle('从产品库选择').click();
    const modalSearch = page.locator('#cp-search-pos');
    await modalSearch.fill('可乐');
    await page.locator('#cp-select-list').getByRole('button', { name: /可口可乐/ }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.modal-overlay').evaluate(element => element.remove());
    await name.fill('可乐');
    await cola.waitFor();
    const box = await suggestions.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'mobile suggestions must stay inside viewport');
    assert.deepEqual(errors, []);
    console.log('PASS POS retail autocomplete browser: fuzzy query, alias, keyboard selection, price fill, no-match state, modal compatibility, mobile width');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
