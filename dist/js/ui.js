// ui.js — UI 渲染函数（Supabase 异步版）
const UI = {
  _editingId: null,
  _editingExpenseId: null,
  _editingSpaceId: null,
  _editingGalleryId: null,
  _revenueFilterDate: '',
  _expenseFilterMonth: '',
  _spaceFilterMonth: '',
  _galleryFilterMonth: '',

  // === Toast 通知 ===
  toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 2500);
  },

  // === Loading 状态 ===
  _loading(containerId, text) {
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (el) {
      el.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>${text || '加载中...'}</span></div>`;
    }
  },

  _noAccess(page) {
    html(page, '<div class="card" style="text-align:center;padding:60px 20px"><p style="font-size:16px;color:var(--gray-500)">无权限访问此页面</p></div>');
  },

  // === 日期工具 ===
  _monthOptions() {
    const opts = [];
    const y = new Date().getFullYear();
    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      opts.push(`<option value="${y}-${ms}">${y}年${m}月</option>`);
    }
    return opts.join('');
  },

  _fmt(n) { return Number(n || 0).toFixed(2); },

  // UTC ISO 时间转北京时间 MM-DD HH:mm
  _fmtBeijingTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  },

  _todayBtn(inputId) {
    return `<button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('${inputId}').value='${todayStr()}'; this.blur()">今天</button>`;
  },

  _yearOptions() {
    const y = new Date().getFullYear();
    let opts = '';
    for (let yr = y; yr >= y - 5; yr--) {
      opts += `<option value="${yr}">${yr}年</option>`;
    }
    return opts;
  },

  // === 首页概览 ===
  async renderDashboard() {
    const page = $('#page-dashboard');
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);

    html(page, `
      <div class="stats-grid" id="dash-stats"><div class="stat-card" style="grid-column:1/-1;text-align:center;color:var(--gray-500)"><div class="spinner"></div><p style="margin-top:8px">加载数据中...</p></div></div>
      <div class="card"><div class="card-title">近7日收入趋势</div><canvas id="dashboard-trend" height="200"></canvas></div>
      <div class="card"><div class="card-title">近7日收入明细</div><div id="dashboard-recent-list"></div></div>
    `);

    const revenues = await Store.getByMonth('revenue', ym);
    const expenses = await Store.getByMonth('expense', ym);
    const spaces = await Store.getByMonth('space', ym);
    const galleries = await Store.getByMonth('gallery', ym);

    const spaceRentIncome = spaces.filter(s => s.rentalType === '付费').reduce((s, r) => s + (r.receivedAmount || 0), 0);

    const totalRevenue = revenues.reduce((s, r) => s + (r.ticketAmount||0) + (r.comboAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0), 0)
      + galleries.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0)
      + spaceRentIncome;
    const totalExpense = expenses.reduce((s, r) => s + (r.type === '备用金支出' ? (r.amount||0) : 0), 0);
    const totalBorrow = expenses.reduce((s, r) => s + (r.type === '备用金借入' ? (r.amount||0) : 0), 0);
    const balance = totalBorrow - totalExpense;
    const spaceCount = spaces.length;
    const galleryTotal = galleries.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0);
    const galleryCount = galleries.length;

    const statsEl = $('dash-stats') || document.querySelector('#dash-stats');
    if (statsEl) {
      statsEl.outerHTML = `<div class="stats-grid">
        <div class="stat-card"><div class="stat-label">当月收入</div><div class="stat-value">¥${this._fmt(totalRevenue)}</div><div class="stat-sub">${ym}</div></div>
        <div class="stat-card"><div class="stat-label">当月支出</div><div class="stat-value" style="color:var(--red)">¥${this._fmt(totalExpense)}</div><div class="stat-sub">${ym}</div></div>
        <div class="stat-card"><div class="stat-label">备用金余额</div><div class="stat-value" style="color:${balance >= 0 ? 'var(--green-700)' : 'var(--red)'}">¥${this._fmt(balance)}</div><div class="stat-sub">借入 ${this._fmt(totalBorrow)}</div></div>
        <div class="stat-card"><div class="stat-label">空间使用</div><div class="stat-value">${spaceCount}</div><div class="stat-sub">本月登记项目</div></div>
        <div class="stat-card"><div class="stat-label">画廊销售</div><div class="stat-value">¥${this._fmt(galleryTotal)}</div><div class="stat-sub">${galleryCount} 笔交易</div></div>
      </div>`;
    }

    this._renderRecentList();
    Charts.renderDashboardTrend();
  },

  async _renderRecentList() {
    const el = $('#dashboard-recent-list');
    const all = await Store.getAll('revenue');
    const list = all.slice(0, 10);
    if (!list.length) { html(el, '<div class="empty-state"><div class="icon">📋</div>暂无收入记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>门票</th><th>套票</th><th>咖啡</th><th>工坊</th><th>文创</th><th>其他</th><th>合计</th></tr></thead><tbody>';
    list.forEach(r => {
      const total = (r.ticketAmount||0) + (r.comboAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0);
      h += `<tr><td>${r.date}</td><td>${this._fmt(r.ticketAmount)}</td><td>${this._fmt(r.comboAmount)}</td><td>${this._fmt(r.coffeeAmount)}</td><td>${this._fmt(r.workshopAmount)}</td><td>${this._fmt(r.retailAmount || r.creativeAmount)}</td><td>${this._fmt(r.otherAmount)}</td><td><strong>${this._fmt(total)}</strong></td></tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  // === 收入录入（POS 收银模式） ===
  async renderRevenuePage() {
    const page = $('#page-revenue');
    if (!Auth.hasModuleAccess('revenue')) { this._noAccess(page); return; }
    // —— 编辑模式下也用 POS 布局，只是预填数据 ——
    const editing = this._editingId;

    html(page, `
      <div class="pos-page-wrapper">
        <div class="pos-scrollable">
          <div class="card" style="margin-bottom:12px">
            <!-- 顶部控制栏 -->
            <div class="pos-topbar">
              <div class="form-group" style="margin-bottom:0">
                <label>日期</label>
                <div style="display:flex;gap:6px">
                  <input type="date" id="rev-date" value="${todayStr()}" style="flex:1">
                  ${this._todayBtn('rev-date')}
                </div>
              </div>
              <div id="space-rent-reminder" class="space-rent-reminder"></div>
            </div>
            <div id="pos-today-stats" class="pos-today-stats"></div>

            <div class="pos-layout">
              <!-- 左列：门票 + 咖啡 + 工坊 -->
              <div>
                <div class="pos-section-title">🎫 票务</div>
                <div class="pos-ticket-area" id="pos-ticket-btns">
                  ${(MODELS.ticketProducts || []).map((p, i) =>
                    this._renderTicketBtn(p.name, p.price, 'tkt-' + i)
                  ).join('')}
                </div>

                <div style="margin-top:10px">
                  <div class="pos-section-title">☕ 咖啡</div>
                  <div class="pos-ticket-area" id="pos-coffee-btns">
                    ${(MODELS.coffeeProducts || []).map((p, i) =>
                      this._renderTicketBtn(p.name, p.price, 'cof-' + i)
                    ).join('')}
                  </div>
                </div>

                <div style="margin-top:14px">
                  <div class="pos-section-title">📝 其他</div>
                  <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
                    <div class="form-group" style="margin-bottom:0"><label>其他金额</label><input type="number" id="rev-other" min="0" step="0.01" placeholder="0.00" value="0" style="width:90px" oninput="UI._updatePOS()"></div>
                    <div class="form-group" style="margin-bottom:0;flex:1;min-width:100px"><label>说明</label><input type="text" id="rev-other-desc" placeholder="其他收入说明"></div>
                    <div class="form-group" style="margin-bottom:0"><label>备注</label><input type="text" id="rev-notes" placeholder="备注"></div>
                  </div>
                </div>
              </div>

              <!-- 右列：文创零售 + 工坊 -->
              <div>
                <div class="pos-section-title">🛒 文创零售</div>
                <div class="pos-retail-area">
                  <div class="pos-input-row">
                    <div class="form-group"><label>单价</label><input type="number" id="rt-price" min="0" step="0.01" placeholder="0.00" style="width:80px"></div>
                    <div class="form-group"><label>数量</label><input type="number" id="rt-qty" min="1" value="1" style="width:60px"></div>
                    <div class="form-group"><label>产品名</label><input type="text" id="rt-name" placeholder="产品名称" style="width:120px"></div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="UI._selectCreativeFromPOS()" title="从产品库选择" style="margin-bottom:1px;font-size:16px">📋</button>
                    <button type="button" class="btn btn-sm btn-primary" onclick="UI._addRetailItem()" style="margin-bottom:1px">+ 添加</button>
                  </div>
                  <div id="rt-list" class="pos-item-list"></div>
                  <div id="rt-total" class="pos-section-total">文创小计: ¥0.00</div>
                </div>

                <div style="margin-top:14px">
                  <div class="pos-section-title">🔧 工坊</div>
                  <div class="pos-workshop-area">
                    <div class="pos-input-row">
                      <div class="form-group"><label>项目</label>
                        <select id="ws-product-select">
                          <option value="">选择</option>
                          ${MODELS.WORKSHOP_PRODUCTS.map(p => `<option value="${p.name}:${p.price}">${p.name} ¥${p.price}</option>`).join('')}
                        </select>
                      </div>
                      <div class="form-group"><label>次数</label><input type="number" id="ws-qty" min="1" value="1" style="width:60px"></div>
                      <div class="form-group"><label>优惠额</label><input type="number" id="ws-discount" min="0" value="0" step="0.01" style="width:80px"></div>
                      <button type="button" class="btn btn-sm btn-primary" onclick="UI._addWorkshopItem()" style="margin-bottom:1px">+ 添加</button>
                    </div>
                    <div id="ws-preview" style="font-size:12px;color:var(--gray-500);min-height:20px"></div>
                    <div id="ws-list" class="pos-item-list"></div>
                    <div id="ws-total" class="pos-section-total">工坊小计: ¥0.00</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 收入记录列表 -->
          <div class="card">
            <div class="card-title">收入记录</div>
            <div class="filter-bar">
              <div class="form-group"><label>筛选日期</label><input type="date" id="rev-filter-date" value="${this._revenueFilterDate || todayStr()}" onchange="UI._filterRevenue()"></div>
              <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('rev-filter-date').value='${todayStr()}'; UI._filterRevenue()">今天</button>
              <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="rev-count"></span>
            </div>
            <div id="revenue-list"><div class="loading-state"><div class="spinner"></div></div></div>
          </div>
        </div>

        <!-- 固定底部结算栏 -->
        <div class="pos-fixed-bottom">
          <div class="pos-payment-group">
            <button type="button" class="pos-payment-btn" data-payment="现金" onclick="UI._selectPayment(this)">💰 现金</button>
            <button type="button" class="pos-payment-btn active" data-payment="扫码支付" onclick="UI._selectPayment(this)">📱 扫码支付</button>
            <button type="button" class="pos-payment-btn" data-payment="对公转账" onclick="UI._selectPayment(this)">🏦 对公转账</button>
          </div>
          <div class="pos-summary" id="pos-summary" style="margin-bottom:6px">
            <span class="pos-summary-item">门票: ¥<span id="s-ticket">0.00</span></span>
            <span class="pos-summary-item">套票: ¥<span id="s-combo">0.00</span></span>
            <span class="pos-summary-item">咖啡: ¥<span id="s-coffee">0.00</span></span>
            <span class="pos-summary-item">工坊: ¥<span id="s-workshop">0.00</span></span>
            <span class="pos-summary-item">文创: ¥<span id="s-retail">0.00</span></span>
            <span class="pos-summary-item">其他: ¥<span id="s-other">0.00</span></span>
          </div>
          <div class="pos-total-row" style="margin-bottom:8px">
            <span>合计</span>
            <span class="pos-grand-total" id="pos-grand-total">¥0.00</span>
          </div>
          <div class="pos-actions">
            <button type="button" class="pos-confirm-btn" id="pos-confirm-btn" onclick="UI._confirmPOSPayment()">
              ${editing ? '✅ 保存修改' : '✅ 确认收款'}
            </button>
            ${editing ? `<button type="button" class="pos-reset-btn" onclick="UI._cancelEditRevenue()">取消编辑</button>` : `<button type="button" class="pos-reset-btn" onclick="UI._resetPOS()">↺ 清空</button>`}
          </div>
        </div>
      </div>`);

    const dateInput = document.getElementById('rev-filter-date');
    if (dateInput && this._revenueFilterDate) dateInput.value = this._revenueFilterDate;

    // 编辑模式：预填数据
    if (editing) {
      setTimeout(() => this._fillPOSEdit(editing), 50);
    }

    this._updatePOS();
    this._loadSpaceRentReminder();
    this._loadTodayStats();
    await this._renderRevenueList();
  },

  // —— 票务按钮辅助渲染 ——
  _renderTicketBtn(name, price, id) {
    return `
      <div class="pos-ticket-btn">
        <div class="pos-ticket-name">${name}</div>
        <div class="pos-ticket-price">¥${price}</div>
        <div class="pos-ticket-qty-row">
          <button type="button" class="pos-qty-btn" onclick="UI._adjustTicket('${id}', ${price}, -1)">−</button>
          <span class="pos-qty-num" id="${id}-display">0</span>
          <button type="button" class="pos-qty-btn" onclick="UI._adjustTicket('${id}', ${price}, 1)">+</button>
        </div>
        <input type="hidden" id="${id}" value="0">
        <div class="pos-ticket-subtotal" id="${id}-sub">¥0.00</div>
      </div>`;
  },

  // —— 票务/咖啡 加减 ——
  _adjustTicket(id, price, delta) {
    const input = document.getElementById(id);
    if (!input) return;
    let qty = +input.value + delta;
    if (qty < 0) qty = 0;
    input.value = qty;
    const display = document.getElementById(id + '-display');
    if (display) display.textContent = qty;
    const sub = document.getElementById(id + '-sub');
    if (sub) sub.textContent = '¥' + (qty * price).toFixed(2);
    this._updatePOS();
  },

  // —— 收款方式选择 ——
  _selectPayment(btn) {
    document.querySelectorAll('.pos-payment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  },

  // —— 添加工坊项目 ——
  _workshopItems: [],
  _addWorkshopItem() {
    const sel = document.getElementById('ws-product-select');
    const qtyInput = document.getElementById('ws-qty');
    const discInput = document.getElementById('ws-discount');
    if (!sel || !sel.value) { this.toast('请选择工坊项目', 'error'); return; }
    const [name, priceStr] = sel.value.split(':');
    const price = +priceStr;
    const qty = +qtyInput.value || 1;
    const discount = +discInput.value || 0;
    const amount = Math.max(0, qty * price - discount);

    this._workshopItems.push({ name, qty, unitPrice: price, discount, amount });
    this._renderWorkshopList();
    qtyInput.value = 1;
    discInput.value = 0;
    sel.value = '';
    document.getElementById('ws-preview').textContent = '';
    this._updatePOS();
  },

  _renderWorkshopList() {
    const el = document.getElementById('ws-list');
    if (!el) return;
    if (!this._workshopItems.length) { el.innerHTML = ''; document.getElementById('ws-total').textContent = '工坊小计: ¥0.00'; return; }
    let h = '';
    let total = 0;
    this._workshopItems.forEach((item, idx) => {
      total += item.amount;
      const discText = item.discount > 0 ? ` (优惠¥${item.discount})` : '';
      h += `<div class="pos-item-row">
        <span class="pos-item-name">${item.name} × ${item.qty}${discText}</span>
        <span class="pos-item-amount">¥${item.amount.toFixed(2)}</span>
        <button type="button" class="pos-item-del" onclick="UI._removeWorkshopItem(${idx})">✕</button>
      </div>`;
    });
    el.innerHTML = h;
    document.getElementById('ws-total').textContent = '工坊小计: ¥' + total.toFixed(2);
  },

  _removeWorkshopItem(idx) {
    this._workshopItems.splice(idx, 1);
    this._renderWorkshopList();
    this._updatePOS();
  },

  // —— 从文创产品库选择 ——
  async _selectCreativeFromPOS() {
    const products = await Store.getAll('creativeProducts') || [];
    if (!products.length) { this.toast('请先在产品管理中录入文创产品', 'error'); return; }
    // 过滤有库存且零售价 > 0 的产品
    const available = products.filter(p => (p.stock || 0) > 0 && (p.retailPrice || 0) > 0);
    if (!available.length) { this.toast('没有库存充足的产品可选', 'error'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    let listHtml = available.map(p => `
      <div class="cp-select-item" onclick="UI._fillCreativeFromPOS('${p.id}')" style="cursor:pointer;padding:8px 12px;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:center">
        <span><strong>${p.name}</strong> <span style="color:var(--gray-500);font-size:12px">${p.sku || ''}</span></span>
        <span style="color:var(--green-700)">¥${(+p.retailPrice||0).toFixed(2)} <span style="color:var(--gray-500);font-size:12px">库存:${p.stock||0}${p.unit||'个'}</span></span>
      </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--gray-500)">无可用产品</div>';
    overlay.innerHTML = `
      <div class="modal-card" style="min-width:400px;max-height:80vh;overflow-y:auto">
        <div class="modal-title">📦 选择文创产品</div>
        <div style="margin-bottom:10px"><input type="text" id="cp-search-pos" placeholder="搜索产品..." style="width:100%;padding:6px 10px" oninput="UI._filterCPSearch(this.value)"></div>
        <div id="cp-select-list">${listHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>
      </div>`;
    // 存储供搜索过滤
    overlay._cpList = available;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _filterCPSearch(val) {
    const list = document.getElementById('cp-select-list');
    const items = document.querySelectorAll('.cp-select-item');
    const q = val.toLowerCase().trim();
    items.forEach(el => {
      el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  },

  _fillCreativeFromPOS(id) {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay && overlay._cpList) {
      const p = overlay._cpList.find(x => x.id === id);
      if (p) {
        document.getElementById('rt-name').value = p.name;
        document.getElementById('rt-price').value = +p.retailPrice || 0;
        document.getElementById('rt-qty').value = 1;
      }
      overlay.remove();
    }
  },

  // —— 添加文创产品 ——
  _retailItems: [],
  _addRetailItem() {
    const priceInput = document.getElementById('rt-price');
    const qtyInput = document.getElementById('rt-qty');
    const nameInput = document.getElementById('rt-name');
    if (!priceInput || !priceInput.value || +priceInput.value <= 0) { this.toast('请输入有效单价', 'error'); return; }
    if (!nameInput || !nameInput.value.trim()) { this.toast('请输入产品名称', 'error'); return; }
    const price = +priceInput.value;
    const qty = +qtyInput.value || 1;
    const name = nameInput.value.trim();
    const amount = qty * price;

    this._retailItems.push({ productName: name, qty, unitPrice: price, amount });
    this._renderRetailList();
    priceInput.value = '';
    qtyInput.value = 1;
    nameInput.value = '';
    this._updatePOS();
  },

  _renderRetailList() {
    const el = document.getElementById('rt-list');
    if (!el) return;
    if (!this._retailItems.length) { el.innerHTML = ''; document.getElementById('rt-total').textContent = '文创小计: ¥0.00'; return; }
    let h = '';
    let total = 0;
    this._retailItems.forEach((item, idx) => {
      total += item.amount;
      h += `<div class="pos-item-row">
        <span class="pos-item-name">${item.productName} × ${item.qty}</span>
        <span class="pos-item-amount">¥${item.amount.toFixed(2)}</span>
        <button type="button" class="pos-item-del" onclick="UI._removeRetailItem(${idx})">✕</button>
      </div>`;
    });
    el.innerHTML = h;
    document.getElementById('rt-total').textContent = '文创小计: ¥' + total.toFixed(2);
  },

  _removeRetailItem(idx) {
    this._retailItems.splice(idx, 1);
    this._renderRetailList();
    this._updatePOS();
  },

  // —— POS 实时汇总 ——
  _getTicketItems() {
    const items = [];
    (MODELS.ticketProducts || []).forEach((p, i) => {
      const qty = +(document.getElementById('tkt-' + i)?.value || 0);
      if (qty > 0) items.push({ name: p.name, qty, price: p.price, amount: qty * p.price });
    });
    return items;
  },
  _getCoffeeItems() {
    const items = [];
    (MODELS.coffeeProducts || []).forEach((p, i) => {
      const qty = +(document.getElementById('cof-' + i)?.value || 0);
      if (qty > 0) items.push({ name: p.name, qty, price: p.price, amount: qty * p.price });
    });
    return items;
  },

  _updatePOS() {
    const tItems = this._getTicketItems();
    const cItems = this._getCoffeeItems();
    // 分离套票与普通票
    const regularTicketAmount = tItems.filter(i => i.name !== '套票').reduce((s, i) => s + i.amount, 0);
    const comboAmount = tItems.filter(i => i.name === '套票').reduce((s, i) => s + i.amount, 0);
    const coffeeAmount = cItems.reduce((s, i) => s + i.amount, 0);
    const oth = +($('#rev-other')?.value || 0);

    const workshopAmount = this._workshopItems.reduce((s, i) => s + i.amount, 0);
    const retailAmount = this._retailItems.reduce((s, i) => s + i.amount, 0);
    const total = regularTicketAmount + comboAmount + coffeeAmount + workshopAmount + retailAmount + oth;

    const s = id => document.getElementById(id);
    if (s('s-ticket')) s('s-ticket').textContent = regularTicketAmount.toFixed(2);
    if (s('s-combo')) s('s-combo').textContent = comboAmount.toFixed(2);
    if (s('s-coffee')) s('s-coffee').textContent = coffeeAmount.toFixed(2);
    if (s('s-workshop')) s('s-workshop').textContent = workshopAmount.toFixed(2);
    if (s('s-retail')) s('s-retail').textContent = retailAmount.toFixed(2);
    if (s('s-other')) s('s-other').textContent = oth.toFixed(2);
    if (s('pos-grand-total')) s('pos-grand-total').textContent = '¥' + total.toFixed(2);
    const confirmBtn = s('pos-confirm-btn');
    if (confirmBtn) {
      confirmBtn.textContent = total > 0
        ? (this._editingId ? '✅ 保存修改' : '✅ 确认收款 ¥' + total.toFixed(2))
        : (this._editingId ? '✅ 保存修改' : '✅ 确认收款');
      confirmBtn.disabled = total <= 0 && !this._editingId;
    }

    // 工坊预览
    const preview = document.getElementById('ws-preview');
    if (preview) {
      const sel = document.getElementById('ws-product-select');
      const qtyIpt = document.getElementById('ws-qty');
      const discIpt = document.getElementById('ws-discount');
      if (sel && sel.value && qtyIpt) {
        const [, ps] = sel.value.split(':');
        const p = +ps, q = +qtyIpt.value || 0, d = +(discIpt?.value || 0);
        preview.textContent = q > 0 ? `¥${p} × ${q} ${d > 0 ? `(优惠¥${d}) ` : ''}= ¥${(q * p - d).toFixed(2)}` : '';
      } else {
        preview.textContent = '';
      }
    }
  },

  // —— POS 确认收款/保存 ——
  _submittingPayment: false,

  async _confirmPOSPayment() {
    if (this._submittingPayment) return;
    const total = this._getPOSTotal();
    if (total <= 0 && !this._editingId) { this.toast('请添加收入项目', 'error'); return; }

    this._submittingPayment = true;
    const btn = document.getElementById('pos-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    const paymentMethodEl = document.querySelector('.pos-payment-btn.active');
    const paymentMethod = paymentMethodEl ? paymentMethodEl.dataset.payment : '扫码支付';

    const tItems = this._getTicketItems();
    const cItems = this._getCoffeeItems();
    // 分离套票与普通票，套票独立计入 combo 字段
    const regularTicketItems = tItems.filter(i => i.name !== '套票');
    const comboItems = tItems.filter(i => i.name === '套票');

    const baseRecord = {
      date: document.getElementById('rev-date').value,
      paymentMethod,
      projectName: '',
      handler: Auth.currentUser?.displayName || '',
      notes: $('#rev-notes')?.value || '',
    };

    // 主记录：门票 + 咖啡 + 其他
    const mainRecord = {
      ...baseRecord,
      ticketItems: tItems,  // 合入套票一起存 ticket_items（combo 明细不入独立列）
      ticketQty: regularTicketItems.reduce((s, i) => s + i.qty, 0),
      ticketAmount: regularTicketItems.reduce((s, i) => s + i.amount, 0),
      comboQty: comboItems.reduce((s, i) => s + i.qty, 0),
      comboAmount: comboItems.reduce((s, i) => s + i.amount, 0),
      coffeeItems: cItems,
      coffeeQty: cItems.reduce((s, i) => s + i.qty, 0),
      coffeeAmount: cItems.reduce((s, i) => s + i.amount, 0),
      workshopItems: [],
      workshopAmount: 0,
      retailItems: [],
      retailAmount: 0,
      otherAmount: +($('#rev-other')?.value || 0),
      otherDesc: $('#rev-other-desc')?.value || '',
    };
    // 主记录金额（不含工坊/文创）
    const mainTotal = (mainRecord.ticketAmount||0) + (mainRecord.comboAmount||0) + (mainRecord.coffeeAmount||0) + (mainRecord.otherAmount||0);
    const isCash = paymentMethod !== '扫码支付' && paymentMethod !== '对公转账';
    mainRecord.cashAmount = isCash ? mainTotal : 0;
    mainRecord.accountAmount = isCash ? 0 : mainTotal;

    try {
      if (this._editingId) {
        // 编辑模式：保存完整数据（含工坊/文创，不拆分）
        const editData = {
          ...baseRecord,
          ticketItems: tItems,  // 合入套票，不单独传 comboItems
          ticketQty: regularTicketItems.reduce((s, i) => s + i.qty, 0),
          ticketAmount: regularTicketItems.reduce((s, i) => s + i.amount, 0),
          comboQty: comboItems.reduce((s, i) => s + i.qty, 0),
          comboAmount: comboItems.reduce((s, i) => s + i.amount, 0),
          coffeeItems: cItems,
          coffeeQty: cItems.reduce((s, i) => s + i.qty, 0),
          coffeeAmount: cItems.reduce((s, i) => s + i.amount, 0),
          workshopItems: this._workshopItems.map(i => ({ ...i })),
          workshopAmount: this._workshopItems.reduce((s, i) => s + i.amount, 0),
          retailItems: this._retailItems.map(i => ({ productName: i.productName, qty: i.qty, unitPrice: i.unitPrice, amount: i.amount })),
          retailAmount: this._retailItems.reduce((s, i) => s + i.amount, 0),
          otherAmount: +($('#rev-other')?.value || 0),
          otherDesc: $('#rev-other-desc')?.value || '',
          cashAmount: isCash ? total : 0,
          accountAmount: isCash ? 0 : total,
        };
        await Store.update('revenue', this._editingId, editData);
        this.toast('收入记录已更新');
        this._editingId = null;
      } else {
        // 先保存主记录
        if (mainTotal > 0) {
          await Store.add('revenue', createRevenue(mainRecord));
        }
        // 每个工坊商品拆为独立记录
        for (const item of this._workshopItems) {
          await Store.add('revenue', createRevenue({
            ...baseRecord,
            workshopItems: [{ ...item }],
            workshopAmount: item.amount,
            cashAmount: isCash ? item.amount : 0,
            accountAmount: isCash ? 0 : item.amount,
          }));
        }
        // 每个文创商品拆为独立记录
        for (const item of this._retailItems) {
          const amt = item.qty * item.unitPrice;
          await Store.add('revenue', createRevenue({
            ...baseRecord,
            retailItems: [{ productName: item.productName, qty: item.qty, unitPrice: item.unitPrice, amount: amt }],
            retailAmount: amt,
            cashAmount: isCash ? amt : 0,
            accountAmount: isCash ? 0 : amt,
          }));
        }
        this.toast('收款成功 ¥' + total.toFixed(2));
      }
    } catch (e) {
      this.toast('保存失败：' + (e.message || e), 'error');
      this._submittingPayment = false;
      if (btn) { btn.disabled = false; btn.textContent = '确认收款'; }
      return;
    }
    this._submittingPayment = false;
    this._resetPOS();
    await this._renderRevenueList();
    this._loadTodayStats();
  },

  _getPOSTotal() {
    const tItems = this._getTicketItems();
    const cItems = this._getCoffeeItems();
    return tItems.reduce((s, i) => s + i.amount, 0)
      + cItems.reduce((s, i) => s + i.amount, 0)
      + this._workshopItems.reduce((s, i) => s + i.amount, 0)
      + this._retailItems.reduce((s, i) => s + i.amount, 0)
      + (+($('#rev-other')?.value || 0));
  },

  // —— POS 清空 ——
  _resetPOS() {
    // 清空所有 ticket 和 coffee
    (MODELS.ticketProducts || []).forEach((p, i) => {
      const el = document.getElementById('tkt-' + i);
      if (el) { el.value = 0; }
      const disp = document.getElementById('tkt-' + i + '-display');
      if (disp) disp.textContent = '0';
      const sub = document.getElementById('tkt-' + i + '-sub');
      if (sub) sub.textContent = '¥0.00';
    });
    (MODELS.coffeeProducts || []).forEach((p, i) => {
      const el = document.getElementById('cof-' + i);
      if (el) { el.value = 0; }
      const disp = document.getElementById('cof-' + i + '-display');
      if (disp) disp.textContent = '0';
      const sub = document.getElementById('cof-' + i + '-sub');
      if (sub) sub.textContent = '¥0.00';
    });
    document.getElementById('rev-other').value = '0';
    document.getElementById('rev-other-desc').value = '';
    document.getElementById('rev-notes').value = '';
    this._workshopItems = [];
    this._retailItems = [];
    this._renderWorkshopList();
    this._renderRetailList();
    document.querySelectorAll('.pos-payment-btn').forEach(b => b.classList.toggle('active', b.dataset.payment === '扫码支付'));
    this._updatePOS();
  },

  // —— 编辑模式预填 ——
  async _fillPOSEdit(id) {
    const r = await Store.getById('revenue', id);
    if (!r) return;
    document.getElementById('rev-date').value = r.date || todayStr();

    // 票务（动态）
    (r.ticketItems || []).forEach((item, i) => {
      const idx = (MODELS.ticketProducts || []).findIndex(p => p.name === item.name);
      if (idx >= 0) {
        const el = document.getElementById('tkt-' + idx);
        if (el) { el.value = item.qty || 0; }
        const disp = document.getElementById('tkt-' + idx + '-display');
        if (disp) disp.textContent = item.qty || 0;
      }
    });
    // 咖啡（动态）
    (r.coffeeItems || []).forEach((item, i) => {
      const idx = (MODELS.coffeeProducts || []).findIndex(p => p.name === item.name);
      if (idx >= 0) {
        const el = document.getElementById('cof-' + idx);
        if (el) { el.value = item.qty || 0; }
        const disp = document.getElementById('cof-' + idx + '-display');
        if (disp) disp.textContent = item.qty || 0;
      }
    });

    // 工坊
    this._workshopItems = (Array.isArray(r.workshopItems) ? r.workshopItems : []).map(i => ({ ...i }));
    this._renderWorkshopList();

    // 文创
    this._retailItems = (Array.isArray(r.retailItems) ? r.retailItems : []).map(i => ({ ...i }));
    this._renderRetailList();

    // 其他
    document.getElementById('rev-other').value = r.otherAmount || 0;
    document.getElementById('rev-other-desc').value = r.otherDesc || '';
    document.getElementById('rev-notes').value = r.notes || '';

    // 收款方式
    const payMethod = r.paymentMethod || '现金';
    document.querySelectorAll('.pos-payment-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.payment === payMethod);
    });

    this._updatePOS();
  },

  _cancelEditRevenue() {
    this._editingId = null;
    this._workshopItems = [];
    this._retailItems = [];
    this.renderRevenuePage();
  },

  // —— 收入记录列表（按日筛选） ——
  async _renderRevenueList() {
    const el = $('#revenue-list');
    if (!el) return;

    const filter = document.getElementById('rev-filter-date')?.value || todayStr();
    const all = await Store.getAll('revenue');
    const records = all.filter(r => r.date === filter);
    const countEl = $('#rev-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">💰</div>暂无收入记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>收入明细</th><th>合计</th><th>收款方式</th><th>收款人</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const tags = [];
      if ((r.ticketAmount || 0) > 0) tags.push(`🎫 普通票 ${r.ticketQty||0}张 ¥${this._fmt(r.ticketAmount)}`);
      if ((r.comboAmount || 0) > 0) tags.push(`🎟️ 套票 ${r.comboQty||0}张 ¥${this._fmt(r.comboAmount)}`);
      if ((r.coffeeAmount || 0) > 0) tags.push(`☕ 咖啡 ${r.coffeeQty||0}杯 ¥${this._fmt(r.coffeeAmount)}`);
      if ((r.workshopAmount || 0) > 0) tags.push(`🔧 工坊 ¥${this._fmt(r.workshopAmount)}`);
      const retail = r.retailAmount || r.creativeAmount || 0;
      if (retail > 0) tags.push(`🛒 文创 ¥${this._fmt(retail)}`);
      if ((r.venueAmount || 0) > 0) tags.push(`🏛 场地 ¥${this._fmt(r.venueAmount)}`);
      if ((r.otherAmount || 0) > 0) {
        const desc = r.otherDesc ? `(${r.otherDesc})` : '';
        tags.push(`📝 其他${desc} ¥${this._fmt(r.otherAmount)}`);
      }

      const total = (r.ticketAmount||0)+(r.comboAmount||0)+(r.coffeeAmount||0)+(r.workshopAmount||0)+(r.retailAmount||r.creativeAmount||0)+(r.venueAmount||0)+(r.otherAmount||0);
      const timeStr = r.createdAt ? UI._fmtBeijingTime(r.createdAt) : r.date;
      h += `<tr>
        <td>${timeStr}</td>
        <td><div class="rev-tag-group">${tags.map(t => `<span class="rev-tag">${t}</span>`).join('')}</div></td>
        <td><strong>¥${this._fmt(total)}</strong></td>
        <td><span class="tag tag-info">${r.paymentMethod || '—'}</span></td>
        <td>${r.handler || '—'}</td>
        <td class="action-cell">
          <div class="row-actions">
            <button class="btn btn-sm btn-secondary" onclick="UI._editRevenue('${r.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="UI._deleteRevenue('${r.id}')">删除</button>
          </div>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  async _editRevenue(id) {
    this._resetPOS();
    this._editingId = id;
    await this.renderRevenuePage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  _filterRevenue() {
    this._revenueFilterDate = document.getElementById('rev-filter-date').value;
    this._renderRevenueList();
  },

  async _deleteRevenue(id) {
    if (!confirm('确认删除此收入记录？')) return;
    await Store.delete('revenue', id);
    this.toast('已删除');
    await this._renderRevenueList();
  },

  // === 场地租金待收款提醒（收银台顶部） ===
  async _loadSpaceRentReminder() {
    const el = document.getElementById('space-rent-reminder');
    if (!el) return;
    const all = await Store.getAll('space');
    const unpaid = all.filter(s => s.rentalType === '付费' && (s.receivableAmount || 0) > (s.receivedAmount || 0));
    if (!unpaid.length) { el.style.display = 'none'; return; }
    const total = unpaid.reduce((s, r) => s + (r.receivableAmount - (r.receivedAmount || 0)), 0);
    el.style.display = 'block';
    el.innerHTML = `⚠️ 场地租金待收款 <strong>¥${this._fmt(total)}</strong>（${unpaid.length} 笔），请前往 <a href="#" onclick="UI._goToSpaceTab();return false">🏛 空间使用</a> 核对到账`;
  },

  // === 空间页顶部待收款汇总卡片（独立实现，不抽公共方法）===
  async _loadSpaceRentSummary() {
    const el = document.getElementById('space-rent-summary');
    if (!el) return;
    const all = await Store.getAll('space');
    const unpaid = all.filter(s => s.rentalType === '付费' && (s.receivableAmount || 0) > (s.receivedAmount || 0));
    if (!unpaid.length) { el.style.display = 'none'; return; }
    const total = unpaid.reduce((s, r) => s + (r.receivableAmount - (r.receivedAmount || 0)), 0);
    el.style.display = 'block';
    el.innerHTML = `💰 场地租金待收款 <strong>¥${this._fmt(total)}</strong>（${unpaid.length} 笔）<span class="srh-hint">请滚动到底部核对到账情况</span>`;
  },

  // === 当日销售统计（收银台顶部） ===
  async _loadTodayStats() {
    const el = document.getElementById('pos-today-stats');
    if (!el) return;
    const today = todayStr();
    const all = await Store.getAll('revenue');
    const todayRecords = all.filter(r => r.date === today);

    const ticketQty = todayRecords.reduce((s, r) => s + (r.ticketQty || 0), 0);
    const ticketAmt = todayRecords.reduce((s, r) => s + (r.ticketAmount || 0), 0);
    const comboAmt = todayRecords.reduce((s, r) => s + (r.comboAmount || 0), 0);
    const coffeeAmt = todayRecords.reduce((s, r) => s + (r.coffeeAmount || 0), 0);
    const workshopAmt = todayRecords.reduce((s, r) => s + (r.workshopAmount || 0), 0);
    const retailAmt = todayRecords.reduce((s, r) => s + (r.retailAmount || r.creativeAmount || 0), 0);
    const venueAmt = todayRecords.reduce((s, r) => s + (r.venueAmount || 0), 0);
    const otherAmt = todayRecords.reduce((s, r) => s + (r.otherAmount || 0), 0);
    const totalAmount = ticketAmt + comboAmt + coffeeAmt + workshopAmt + retailAmt + venueAmt + otherAmt;

    const item = (label, value, isTotal) => `
      <div class="today-stat-item${isTotal ? ' today-stat-total' : ''}">
        <span class="today-stat-label">${label}</span>
        <span class="today-stat-value">¥${this._fmt(value)}</span>
      </div>
    `;

    el.innerHTML = [
      `<div class="today-stat-item"><span class="today-stat-label">今日门票</span><span class="today-stat-value">${ticketQty} 张</span></div>`,
      `<div class="today-stat-divider"></div>`,
      item('门票', ticketAmt),
      `<div class="today-stat-divider"></div>`,
      item('套票', comboAmt),
      `<div class="today-stat-divider"></div>`,
      item('咖啡', coffeeAmt),
      `<div class="today-stat-divider"></div>`,
      item('文创', retailAmt),
      `<div class="today-stat-divider"></div>`,
      item('工坊', workshopAmt),
      `<div class="today-stat-divider"></div>`,
      item('其他', otherAmt + venueAmt),
      `<div class="today-stat-divider"></div>`,
      item('合计', totalAmount, true),
    ].join('');
  },

  _goToSpaceTab() {
    const btn = document.querySelector('.tab-btn[data-tab="space"]');
    if (btn) btn.click();
  },

  // === 支出录入 ===
  async renderExpensePage() {
    const page = $('#page-expense');
    if (!Auth.hasModuleAccess('expense')) { this._noAccess(page); return; }

    html(page, `
      <div class="card">
        <div class="card-title">${this._editingExpenseId ? '编辑支出记录' : '新增支出记录'}</div>
        <form id="expense-form" class="form-grid">
          <div class="form-group">
            <label>日期</label>
            <div style="display:flex;gap:6px"><input type="date" id="exp-date" value="${todayStr()}" style="flex:1">${this._todayBtn('exp-date')}</div>
          </div>
          <div class="form-group"><label>类型</label><select id="exp-type"><option value="备用金支出">备用金支出</option><option value="备用金借入">备用金借入</option></select></div>
          <div class="form-group"><label>项目</label><select id="exp-project">${MODELS.PROJECT_TYPES.map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
          <div class="form-group"><label>支出类别</label><select id="exp-category">${MODELS.EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
          <div class="form-group"><label>金额</label><input type="number" id="exp-amount" min="0" step="0.01" placeholder="0.00" required></div>
          <div class="form-group full"><label>内容说明</label><input type="text" id="exp-desc" placeholder="支出具体内容"></div>
          <div class="form-group"><label>经手人</label><input type="text" id="exp-handler" placeholder="经手人姓名"></div>
          <div class="form-group"><label>发票</label><select id="exp-invoice">${MODELS.INVOICE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>付款凭证</label><select id="exp-receipt">${MODELS.RECEIPT_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>关联活动</label><input type="text" id="exp-activity" placeholder="关联展览/活动名称"></div>
          <div class="form-actions full">
            <button type="submit" class="btn btn-primary">${this._editingExpenseId ? '保存修改' : '保存记录'}</button>
            ${this._editingExpenseId ? '<button type="button" class="btn btn-secondary" onclick="UI._cancelEditExpense()">取消编辑</button>' : ''}
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">支出记录</div>
        <div class="filter-bar">
          <div class="form-group"><label>筛选月份</label><select id="exp-filter-month" onchange="UI._filterExpense()">${this._monthOptions()}</select></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('exp-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterExpense()">本月</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="exp-count"></span>
        </div>
        <div id="expense-list"><div class="loading-state"><div class="spinner"></div></div></div>
      </div>
    `);

    document.getElementById('exp-filter-month').value = this._expenseFilterMonth || todayStr().slice(0, 7);
    if (this._editingExpenseId) {
      const r = await Store.getById('expense', this._editingExpenseId);
      if (r) this._fillExpenseForm(r);
    }
    await this._renderExpenseList();
  },

  _fillExpenseForm(r) {
    $('#exp-date').value = r.date;
    $('#exp-type').value = r.type;
    $('#exp-project').value = r.project;
    $('#exp-category').value = r.category;
    $('#exp-amount').value = r.amount;
    $('#exp-desc').value = r.description || '';
    $('#exp-handler').value = r.handler || '';
    $('#exp-invoice').value = r.invoiceStatus;
    $('#exp-receipt').value = r.receiptStatus;
    $('#exp-activity').value = r.relatedActivity || '';
  },

  async _renderExpenseList() {
    const filter = document.getElementById('exp-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#expense-list');
    if (!el) return;

    const records = await Store.getByMonth('expense', filter);
    const countEl = $('#exp-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">🧾</div>暂无支出记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>类型</th><th>项目</th><th>类别</th><th>金额</th><th>内容</th><th>经手人</th><th>发票</th><th>凭证</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      h += `<tr>
        <td>${r.date}</td>
        <td><span class="tag ${r.type === '备用金借入' ? 'tag-success' : 'tag-warning'}">${r.type}</span></td>
        <td>${r.project}</td>
        <td>${r.category}</td>
        <td><strong>${this._fmt(r.amount)}</strong></td>
        <td>${r.description || '-'}</td>
        <td>${r.handler || '-'}</td>
        <td><span class="tag ${r.invoiceStatus === '有发票' ? 'tag-success' : r.invoiceStatus === '待补' ? 'tag-danger' : 'tag-info'}">${r.invoiceStatus}</span></td>
        <td><span class="tag ${r.receiptStatus === '有凭证' ? 'tag-success' : r.receiptStatus === '待补' ? 'tag-danger' : 'tag-info'}">${r.receiptStatus}</span></td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editExpense('${r.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteExpense('${r.id}')">删除</button>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  async _saveExpense(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    const data = {
      date: $('#exp-date').value,
      type: $('#exp-type').value,
      project: $('#exp-project').value,
      category: $('#exp-category').value,
      amount: +($('#exp-amount').value || 0),
      description: $('#exp-desc').value,
      handler: $('#exp-handler').value,
      invoiceStatus: $('#exp-invoice').value,
      receiptStatus: $('#exp-receipt').value,
      relatedActivity: $('#exp-activity').value
    };
    const errs = validateExpense(data);
    if (errs.length) { this.toast(errs[0], 'error'); if (btn) { btn.disabled = false; btn.textContent = this._editingExpenseId ? '保存修改' : '保存记录'; } return; }

    if (this._editingExpenseId) {
      await Store.update('expense', this._editingExpenseId, data);
      this.toast('支出记录已更新');
      this._editingExpenseId = null;
    } else {
      await Store.add('expense', createExpense(data));
      this.toast('支出记录已保存');
    }
    await this.renderExpensePage();
  },

  _editExpense(id) {
    this._editingExpenseId = id;
    this.renderExpensePage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  _cancelEditExpense() {
    this._editingExpenseId = null;
    this.renderExpensePage();
  },

  async _deleteExpense(id) {
    if (!confirm('确认删除此支出记录？')) return;
    await Store.delete('expense', id);
    this.toast('已删除');
    await this._renderExpenseList();
  },

  _filterExpense() {
    this._expenseFilterMonth = document.getElementById('exp-filter-month').value;
    this._renderExpenseList();
  },

  // === 空间使用（卡片看板 + 统一录入） ===
  async renderSpacePage() {
    const page = $('#page-space');
    if (!Auth.hasModuleAccess('space')) { this._noAccess(page); return; }
    const editing = this._editingSpaceId;
    const records = await Store.getAll('space');

    // 按空间聚合当前状态
    const spaceStatuses = {};
    MODELS.SPACES.forEach(s => { spaceStatuses[s] = null; });
    records.forEach(r => {
      if (['筹备中','已确认','进行中'].includes(r.status)) {
        spaceStatuses[r.space] = r;
      }
    });

    html(page, `
      <div id="space-rent-summary" class="space-rent-summary" style="display:none"></div>
      <div class="card">
        <div class="card-title">🏛 空间使用看板</div>
        <div class="space-dashboard" id="space-dashboard-cards">
          ${this._renderSpaceDashboardCards(spaceStatuses)}
        </div>
      </div>
      <div class="card">
        <div class="card-title">${editing ? '编辑使用记录' : '新增使用登记'}</div>
        <form id="space-form" class="form-grid">
          <div class="form-group"><label>日期</label><input type="date" id="sp-date" value="${todayStr()}"></div>
          <div class="form-group"><label>结束日期</label><input type="date" id="sp-end-date" value=""></div>
          <div class="form-group"><label>空间</label><select id="sp-space">${MODELS.SPACES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>项目/活动名称</label><input type="text" id="sp-project" placeholder="请输入项目名称" required></div>
          <div class="form-group"><label>类型</label><select id="sp-type">${MODELS.SPACE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div class="form-group"><label>客户/合作方</label><input type="text" id="sp-client" placeholder="客户或合作方名称"></div>
          <div class="form-group"><label>状态</label><select id="sp-status">${MODELS.SPACE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>租金类型</label>
            <select id="sp-rental-type" onchange="UI._toggleRentalType()">
              ${MODELS.RENTAL_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="sp-rental-amount-group"><label>应收金额</label><input type="number" id="sp-receivable" min="0" step="0.01" placeholder="0.00" value="0"></div>
          <div class="form-group" id="sp-received-group"><label>已收金额</label><input type="number" id="sp-received" min="0" step="0.01" placeholder="0.00" value="0"></div>
          <div class="form-group full"><label>备注</label><textarea id="sp-notes" rows="2"></textarea></div>
          <div class="form-actions full">
            <button type="submit" class="btn btn-primary">${editing ? '保存修改' : '保存记录'}</button>
            ${editing ? '<button type="button" class="btn btn-secondary" onclick="UI._cancelEditSpace()">取消编辑</button>' : ''}
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">全部记录</div>
        <div class="filter-bar">
          <div class="form-group"><label>筛选月份</label><select id="sp-filter-month" onchange="UI._filterSpace()">${this._monthOptions()}</select></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('sp-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterSpace()">本月</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="sp-count"></span>
        </div>
        <div id="space-list"><div class="loading-state"><div class="spinner"></div></div></div>
      </div>
    `);

    document.getElementById('sp-filter-month').value = this._spaceFilterMonth || todayStr().slice(0, 7);

    // 初始化租金类型（新增时默认付费）
    this._toggleRentalType();

    if (editing) {
      const r = await Store.getById('space', editing);
      if (r) this._fillSpaceForm(r);
    }
    await this._renderSpaceList();
    await this._loadSpaceRentSummary();
  },

  _renderSpaceDashboardCards(spaceStatuses) {
    const names = { '1号厅':'1号展厅', '2号厅':'2号展厅', '美学空间':'美学空间', '多功能厅':'多功能厅', '六楼综合空间':'六楼综合空间', '走廊画廊':'走廊画廊', '户外露台':'户外露台' };
    const icons = { '1号厅':'🖼️', '2号厅':'🖼️', '美学空间':'💬', '多功能厅':'🎤', '六楼综合空间':'📦', '走廊画廊':'🖼️', '户外露台':'🌿' };
    let h = '';
    MODELS.SPACES.forEach(s => {
      const usage = spaceStatuses[s];
      const isOccupied = !!usage;
      const statusClass = isOccupied
        ? (usage.status === '进行中' ? 'card-occupied' : 'card-pending')
        : 'card-free';
      const statusLabel = isOccupied
        ? `<span class="tag ${usage.status === '进行中' ? 'tag-success' : 'tag-info'}">${usage.status}</span>`
        : '<span class="tag tag-free">空闲</span>';

      h += `<div class="space-card-dash ${statusClass}" onclick="UI._quickSelectSpace('${s}')">
        <div class="scd-icon">${icons[s] || '🏛️'}</div>
        <div class="scd-name">${names[s] || s}</div>
        <div class="scd-status">${statusLabel}</div>
        ${isOccupied ? `<div class="scd-project">${usage.projectName}</div>
          <div class="scd-meta">${usage.date}${usage.endDate ? ' → ' + usage.endDate : ''}</div>
          <div class="scd-meta">${usage.type} · ${usage.client || '—'}</div>
          <div class="scd-rent">${usage.rentalType === '免费' ? '免费' : '¥' + this._fmt(usage.receivableAmount)}</div>` : ''}
      </div>`;
    });
    return h;
  },

  _toggleRentalType() {
    const type = $('#sp-rental-type')?.value;
    const amountGroup = $('#sp-rental-amount-group');
    const receivedGroup = $('#sp-received-group');
    if (!amountGroup) return;
    if (type === '免费') {
      amountGroup.style.display = 'none';
      receivedGroup.style.display = 'none';
      const rInput = $('#sp-receivable');
      const rvInput = $('#sp-received');
      if (rInput) rInput.value = 0;
      if (rvInput) rvInput.value = 0;
    } else {
      amountGroup.style.display = '';
      receivedGroup.style.display = '';
    }
    this._bindSpaceAmountValidation();
  },

  _bindSpaceAmountValidation() {
    const rInput = $('#sp-receivable');
    const rvInput = $('#sp-received');
    if (!rInput || !rvInput) return;
    const handler = () => {
      const receivable = +(rInput.value || 0);
      const received = +(rvInput.value || 0);
      if (received > receivable && receivable >= 0) {
        rvInput.classList.add('invalid');
        rInput.classList.add('invalid');
      } else {
        rvInput.classList.remove('invalid');
        rInput.classList.remove('invalid');
      }
    };
    rInput.oninput = handler;
    rvInput.oninput = handler;
  },

  _quickSelectSpace(space) {
    document.getElementById('sp-space').value = space;
    document.getElementById('sp-project').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  _fillSpaceForm(r) {
    $('#sp-date').value = r.date;
    $('#sp-end-date').value = r.endDate || '';
    $('#sp-space').value = r.space;
    $('#sp-project').value = r.projectName;
    $('#sp-type').value = r.type;
    $('#sp-client').value = r.client || '';
    $('#sp-status').value = r.status;
    $('#sp-rental-type').value = r.rentalType || '付费';
    $('#sp-receivable').value = r.receivableAmount || 0;
    $('#sp-received').value = r.receivedAmount || 0;
    $('#sp-notes').value = r.notes || '';
    this._toggleRentalType();
    // 编辑回填后立刻校验一次（若旧数据已收>应收，要标红提醒）
    const rInput = $('#sp-receivable');
    const rvInput = $('#sp-received');
    if (rInput && rvInput) {
      rInput.dispatchEvent(new Event('input'));
    }
  },

  async _renderSpaceList() {
    const filter = document.getElementById('sp-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#space-list');
    if (!el) return;

    const records = await Store.getByMonth('space', filter);
    const countEl = $('#sp-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">📋</div>暂无记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>结束日期</th><th>空间</th><th>项目名称</th><th>类型</th><th>客户</th><th>租金类型</th><th>状态</th><th>应收</th><th>已收</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const statusTagClass = r.status === '已完成' ? 'tag-success' : r.status === '已取消' || r.status === '空闲' ? 'tag-danger' : 'tag-info';
      h += `<tr>
        <td>${r.date}</td>
        <td>${r.endDate || '—'}</td>
        <td>${r.space}</td>
        <td>${r.projectName}</td>
        <td>${r.type}</td>
        <td>${r.client || '-'}</td>
        <td><span class="tag ${r.rentalType === '免费' ? 'tag-free' : 'tag-info'}">${r.rentalType || '付费'}</span></td>
        <td><span class="tag ${statusTagClass}">${r.status}</span></td>
        <td>${r.rentalType === '免费' ? '免费' : '¥' + this._fmt(r.receivableAmount)}</td>
        <td>${r.rentalType === '免费' ? '—' : '¥' + this._fmt(r.receivedAmount)}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editSpace('${r.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteSpace('${r.id}')">删除</button>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  async _saveSpace(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    const rentalType = $('#sp-rental-type').value;
    const data = {
      date: $('#sp-date').value,
      endDate: $('#sp-end-date').value || '',
      space: $('#sp-space').value,
      projectName: $('#sp-project').value.trim(),
      type: $('#sp-type').value,
      client: $('#sp-client').value,
      status: $('#sp-status').value,
      rentalType: rentalType,
      receivableAmount: rentalType === '免费' ? 0 : +($('#sp-receivable').value || 0),
      receivedAmount: rentalType === '免费' ? 0 : +($('#sp-received').value || 0),
      notes: $('#sp-notes').value
    };

    if (!data.projectName) { this.toast('请输入项目/活动名称', 'error'); if (btn) { btn.disabled = false; btn.textContent = this._editingSpaceId ? '保存修改' : '保存记录'; } return; }

    // 校验：已收金额不能大于应收金额
    if (rentalType !== '免费' && data.receivedAmount > data.receivableAmount) {
      this.toast(`已收金额（¥${this._fmt(data.receivedAmount)}）不能大于应收金额（¥${this._fmt(data.receivableAmount)}）`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = this._editingSpaceId ? '保存修改' : '保存记录'; }
      const rInput = $('#sp-received');
      if (rInput) { rInput.classList.add('invalid'); rInput.focus(); }
      return;
    }

    // 检查时间冲突
    if (['已确认','进行中'].includes(data.status)) {
      const conflict = await this._checkSpaceConflict(data);
      if (conflict) {
        this.toast(`时间冲突：该空间在所选时段已被「${conflict.projectName}」占用`, 'error');
        if (btn) { btn.disabled = false; btn.textContent = this._editingSpaceId ? '保存修改' : '保存记录'; }
        return;
      }
    }

    if (this._editingSpaceId) {
      await Store.update('space', this._editingSpaceId, data);
      this.toast('空间使用记录已更新');
      this._editingSpaceId = null;
    } else {
      await Store.add('space', createSpaceUsage(data));
      this.toast('空间使用记录已保存');
    }
    await this.renderSpacePage();
  },

  async _checkSpaceConflict(newData) {
    // 获取同一空间的所有记录
    const all = await Store.getAll('space');
    const sameSpace = all.filter(r =>
      r.space === newData.space &&
      ['已确认','进行中'].includes(r.status) &&
      r.id !== this._editingSpaceId // 编辑时排除自身
    );
    if (!sameSpace.length) return null;

    // 新记录占用日期集合
    const occupiedDates = new Set();
    const start = new Date(newData.date);
    let end;
    if (newData.endDate) {
      // 有结束日期：占用到结束日期后一天
      end = new Date(newData.endDate);
      end.setDate(end.getDate() + 1);
    } else {
      // 只有开始日期：仅当天占用
      end = new Date(newData.date);
    }

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      occupiedDates.add(d.toISOString().slice(0, 10));
    }

    // 检查每条已有记录的占用区间
    for (const record of sameSpace) {
      const rStart = new Date(record.date);
      let rEnd;
      if (record.endDate) {
        rEnd = new Date(record.endDate);
        rEnd.setDate(rEnd.getDate() + 1);
      } else {
        rEnd = new Date(record.date);
      }

      for (let d = new Date(rStart); d <= rEnd; d.setDate(d.getDate() + 1)) {
        if (occupiedDates.has(d.toISOString().slice(0, 10))) {
          return record; // 返回冲突记录
        }
      }
    }

    return null;
  },

  async _editSpace(id) {
    this._editingSpaceId = id;
    await this.renderSpacePage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  _cancelEditSpace() {
    this._editingSpaceId = null;
    this.renderSpacePage();
  },

  async _deleteSpace(id) {
    if (!confirm('确认删除此记录？')) return;
    await Store.delete('space', id);
    this.toast('已删除');
    await this.renderSpacePage();
  },

  _filterSpace() {
    this._spaceFilterMonth = document.getElementById('sp-filter-month').value;
    this._renderSpaceList();
  },

  // === 画廊销售 ===
  async renderGalleryPage() {
    const page = $('#page-gallery');
    if (!Auth.hasModuleAccess('gallery')) { this._noAccess(page); return; }
    const editing = this._editingGalleryId;

    html(page, `
      <div class="card">
        <div class="card-title">${editing ? '编辑画廊销售记录' : '新增画廊销售记录'}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>日期</label>
            <div style="display:flex;gap:6px"><input type="date" id="gal-date" value="${todayStr()}" style="flex:1">${this._todayBtn('gal-date')}</div>
          </div>
          <div class="form-group"><label>作品名称</label><input type="text" id="gal-artwork" placeholder="请输入作品名称" required></div>
          <div class="form-group"><label>艺术家</label><input type="text" id="gal-artist" placeholder="艺术家姓名（选填）"></div>
          <div class="form-group"><label>成交价（元）</label><input type="number" id="gal-price" min="0" step="0.01" placeholder="0.00" required oninput="UI._updateGalleryNet()"></div>
          <div class="form-group"><label>佣金/手续费（元）</label><input type="number" id="gal-commission" min="0" step="0.01" placeholder="0.00" value="0" oninput="UI._updateGalleryNet()"></div>
          <div class="form-group"><label>净收入 <span id="gal-net" style="font-weight:bold;color:var(--green-700)">¥0.00</span></label></div>
          <div class="form-group"><label>买家</label><input type="text" id="gal-buyer" placeholder="买家姓名（选填）"></div>
          <div class="form-group"><label>收款方式</label>
            <select id="gal-payment">
              <option value="扫码支付">扫码支付</option>
              <option value="现金">现金</option>
              <option value="对公转账">对公转账</option>
            </select>
          </div>
          <div class="form-group"><label>状态</label>
            <select id="gal-status">
              <option value="已售出">已售出</option>
              <option value="已预定">已预定</option>
              <option value="已退款">已退款</option>
            </select>
          </div>
          <div class="form-group"><label>关联展览</label><input type="text" id="gal-exhibition" placeholder="关联展览名称（选填）"></div>
          <div class="form-group"><label>经手人</label><input type="text" id="gal-handler" placeholder="经手人姓名"></div>
          <div class="form-group full"><label>备注</label><input type="text" id="gal-notes" placeholder="备注（选填）"></div>
          <div class="form-actions full">
            <button type="button" class="btn btn-primary" onclick="UI._saveGallerySale()">${editing ? '保存修改' : '保存记录'}</button>
            ${editing ? '<button type="button" class="btn btn-secondary" onclick="UI._cancelEditGallery()">取消编辑</button>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">画廊销售记录</div>
        <div class="filter-bar">
          <div class="form-group"><label>筛选月份</label><select id="gal-filter-month" onchange="UI._filterGallery()">${this._monthOptions()}</select></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('gal-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterGallery()">本月</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="gal-count"></span>
        </div>
        <div id="gallery-list"><div class="loading-state"><div class="spinner"></div></div></div>
      </div>
    `);

    document.getElementById('gal-filter-month').value = this._galleryFilterMonth || todayStr().slice(0, 7);

    if (editing) {
      const r = await Store.getById('gallery', editing);
      if (r) this._fillGalleryForm(r);
    }
    this._updateGalleryNet();
    await this._renderGalleryList();
  },

  _updateGalleryNet() {
    const price = +($('#gal-price')?.value || 0);
    const comm = +($('#gal-commission')?.value || 0);
    const net = $('#gal-net');
    if (net) net.textContent = '¥' + Math.max(0, price - comm).toFixed(2);
  },

  _fillGalleryForm(r) {
    $('#gal-date').value = r.date;
    $('#gal-artwork').value = r.artworkName || '';
    $('#gal-artist').value = r.artist || '';
    $('#gal-price').value = r.price || 0;
    $('#gal-commission').value = r.commission || 0;
    $('#gal-buyer').value = r.buyerName || '';
    $('#gal-payment').value = r.paymentMethod || '扫码支付';
    $('#gal-status').value = r.status || '已售出';
    $('#gal-exhibition').value = r.relatedExhibition || '';
    $('#gal-handler').value = r.handler || '';
    $('#gal-notes').value = r.notes || '';
    this._updateGalleryNet();
  },

  async _saveGallerySale() {
    const data = {
      date: $('#gal-date').value,
      artworkName: $('#gal-artwork').value.trim(),
      artist: $('#gal-artist').value.trim(),
      price: +($('#gal-price').value || 0),
      commission: +($('#gal-commission').value || 0),
      buyerName: $('#gal-buyer').value.trim(),
      paymentMethod: $('#gal-payment').value,
      status: $('#gal-status').value,
      relatedExhibition: $('#gal-exhibition').value.trim(),
      handler: $('#gal-handler').value.trim(),
      notes: $('#gal-notes').value.trim()
    };

    const errs = validateGallerySale(data);
    if (errs.length) { this.toast(errs[0], 'error'); return; }

    const btn = document.querySelector('#page-gallery .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    try {
      if (this._editingGalleryId) {
        await Store.update('gallery', this._editingGalleryId, data);
        this.toast('画廊记录已更新');
        this._editingGalleryId = null;
      } else {
        await Store.add('gallery', createGallerySale(data));
        this.toast('画廊销售记录已保存');
      }
    } catch (e) {
      this.toast('保存失败：' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '保存记录'; }
      return;
    }

    await this.renderGalleryPage();
  },

  async _renderGalleryList() {
    const filter = document.getElementById('gal-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#gallery-list');
    if (!el) return;

    const records = await Store.getByMonth('gallery', filter);
    const countEl = $('#gal-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">🖼️</div>暂无画廊销售记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>作品名称</th><th>艺术家</th><th>成交价</th><th>佣金</th><th>净收入</th><th>买家</th><th>状态</th><th>收款方式</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const net = Math.max(0, (r.price||0) - (r.commission||0));
      const statusClass = r.status === '已售出' ? 'tag-success' : r.status === '已预定' ? 'tag-info' : 'tag-danger';
      h += `<tr>
        <td>${r.date}</td>
        <td>${r.artworkName || '-'}</td>
        <td>${r.artist || '-'}</td>
        <td><strong>¥${this._fmt(r.price)}</strong></td>
        <td>¥${this._fmt(r.commission)}</td>
        <td>¥${this._fmt(net)}</td>
        <td>${r.buyerName || '-'}</td>
        <td><span class="tag ${statusClass}">${r.status || '已售出'}</span></td>
        <td>${r.paymentMethod || '-'}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editGallery('${r.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteGallery('${r.id}')">删除</button>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  async _editGallery(id) {
    this._editingGalleryId = id;
    await this.renderGalleryPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async _deleteGallery(id) {
    if (!confirm('确认删除此画廊销售记录？')) return;
    await Store.delete('gallery', id);
    this.toast('已删除');
    await this._renderGalleryList();
  },

  _cancelEditGallery() {
    this._editingGalleryId = null;
    this.renderGalleryPage();
  },

  _filterGallery() {
    this._galleryFilterMonth = document.getElementById('gal-filter-month').value;
    this._renderGalleryList();
  },

  // === 操作日志查看 ===
  async renderLogsPage() {
    const page = $('#page-logs');
    if (!Auth.isAdmin) { this._noAccess(page); return; }

    html(page, `
      <div class="card">
        <div class="card-title">📋 操作日志</div>
        <div class="filter-bar" style="flex-wrap:wrap;gap:8px">
          <div class="form-group"><label>开始日期</label><input type="date" id="log-start" style="width:140px"></div>
          <div class="form-group"><label>结束日期</label><input type="date" id="log-end" style="width:140px"></div>
          <div class="form-group"><label>操作</label>
            <select id="log-action" style="width:90px">
              <option value="">全部</option>
              <option value="create">新增</option>
              <option value="update">修改</option>
              <option value="delete">删除</option>
            </select>
          </div>
          <div class="form-group"><label>数据表</label>
            <select id="log-table" style="width:100px">
              <option value="">全部</option>
              <option value="revenue">收入</option>
              <option value="expense">支出</option>
              <option value="space">空间使用</option>
              <option value="gallery">画廊销售</option>
              <option value="users">用户</option>
            </select>
          </div>
          <button type="button" class="btn btn-sm btn-primary" onclick="UI._filterLogs()" style="margin-top:18px">查询</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._resetLogFilter()" style="margin-top:18px">重置</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="log-count"></span>
        </div>
        <div id="logs-list"><div class="loading-state" style="padding:40px"><div class="spinner"></div><span>加载日志...</span></div></div>
      </div>
    `);

    await this._renderLogsList();
  },

  async _renderLogsList(append = false) {
    const el = $('#logs-list');
    if (!el) return;

    const startDate = $('#log-start')?.value || '';
    const endDate = $('#log-end')?.value || '';
    const action = $('#log-action')?.value || '';
    const tableName = $('#log-table')?.value || '';

    if (!append) {
      el.innerHTML = '<div class="loading-state" style="padding:40px"><div class="spinner"></div><span>加载日志...</span></div>';
    }

    const result = await OperationLogger.query({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      action: action || undefined,
      tableName: tableName || undefined,
      offset: append ? this._logOffset : 0,
      limit: 100
    });

    const countEl = $('#log-count');
    if (countEl) countEl.textContent = `${result.total} 条记录`;

    if (!result.records.length) {
      if (!append) html(el, '<div class="empty-state"><div class="icon">📋</div>暂无操作日志</div>');
      return;
    }

    const actionLabels = { create: '新增', update: '修改', delete: '删除' };
    const tableLabels = { revenue: '收入', expense: '支出', space: '空间使用', gallery: '画廊销售', users: '用户' };
    const actionColors = { create: 'tag-success', update: 'tag-info', delete: 'tag-danger' };

    let h = append ? '' : '<div class="table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>用户</th><th>操作</th><th>数据表</th><th>记录ID</th><th>详情</th></tr></thead><tbody>';
    result.records.forEach(r => {
      const details = this._formatLogDetails(r);
      h += `<tr>
        <td style="white-space:nowrap">${r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '-'}</td>
        <td>${r.userId ? r.userId.slice(0, 8) + '…' : '-'}</td>
        <td><span class="tag ${actionColors[r.action] || 'tag-info'}">${actionLabels[r.action] || r.action}</span></td>
        <td>${tableLabels[r.tableName] || r.tableName}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${r.recordId || '-'}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--gray-500)">${details || '-'}</td>
      </tr>`;
    });
    if (!append) h += '</tbody></table></div>';

    if (append) {
      el.insertAdjacentHTML('beforeend', h);
    } else {
      html(el, h);
    }

    this._logOffset = (this._logOffset || 0) + 100;
  },

  _formatLogDetails(r) {
    if (!r.details || r.details === '{}') return '-';
    const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
    if (r.action === 'create') return '新增记录';
    if (r.action === 'delete') return d.date ? `${d.date} ${d.paymentMethod || ''}`.trim() : '删除记录';
    if (r.action === 'update') {
      if (d.before && d.after) {
        const changed = [];
        for (const k of Object.keys(d.after)) {
          const a = JSON.stringify(d.after[k]);
          const b = JSON.stringify(d.before[k]);
          if (a !== b) changed.push(k);
        }
        return `修改字段：${changed.join('、') || '无变化'}`;
      }
      return '修改记录';
    }
    return '-';
  },

  _logOffset: 0,

  _filterLogs() {
    this._logOffset = 0;
    this._renderLogsList();
  },

  _resetLogFilter() {
    ['log-start', 'log-end', 'log-action', 'log-table'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.value = '';
    });
    this._logOffset = 0;
    this._renderLogsList();
  },

  // ===== 产品/资产管理 =====
  async renderProductPage() {
    if (!Auth.hasModuleAccess('products')) { this._noAccess($('#page-products')); return; }
    // 确保配置已从数据库加载
    await Store.loadAppConfig();
    const page = $('#page-products');
    const ticketItems = MODELS.ticketProducts || [];
    const coffeeItems = MODELS.coffeeProducts || [];
    const wsItems = MODELS.WORKSHOP_PRODUCTS || [];
    const spItems = MODELS.spaceDetails || [];

    html(page, `
      <div class="card">
        <div class="card-title">🎫 票务产品</div>
        <div id="prod-ticket-table">${this._renderEditableList(ticketItems, 'ticket', ['名称', '单价'], ['name', 'price'])}</div>
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:8px" onclick="UI._addConfigItem('ticket')">+ 新增票种</button>
      </div>
      <div class="card">
        <div class="card-title">☕ 咖啡饮品</div>
        <div id="prod-coffee-table">${this._renderEditableList(coffeeItems, 'coffee', ['名称', '单价'], ['name', 'price'])}</div>
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:8px" onclick="UI._addConfigItem('coffee')">+ 新增咖啡</button>
      </div>
      <div class="card">
        <div class="card-title">🔧 工坊产品</div>
        <div id="prod-workshop-table">${this._renderEditableList(wsItems, 'workshop', ['名称', '单价'], ['name', 'price'])}</div>
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:8px" onclick="UI._addConfigItem('workshop')">+ 新增产品</button>
      </div>
      <div class="card">
        <div class="card-title">🏛 经营空间</div>
        <div id="prod-space-table">${this._renderEditableList(spItems, 'space', ['空间名', '日价', '半天价', '说明'], ['name', 'dailyPrice', 'halfDayPrice', 'desc'])}</div>
        <button type="button" class="btn btn-sm btn-primary" style="margin-top:8px" onclick="UI._addConfigItem('space')">+ 新增空间</button>
      </div>
      <div class="card">
        <div class="card-title">📦 文创产品管理</div>
        <div class="filter-bar" style="flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-sm btn-primary" onclick="UI._addCreativeProduct()">+ 新增产品</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._importCreativeProducts()">📥 导入库存</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._downloadImportTemplate()">📋 下载导入模板</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeProducts()">📤 导出产品列表</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeSales()">📄 导出文创销售清单</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="cp-count"></span>
        </div>
        <div id="prod-creative-table"><div class="loading-state"><div class="spinner"></div></div></div>
      </div>
    `);
    this._renderCreativeProductList();
  },

  _renderEditableList(items, type, headers, fields) {
    if (!items || !items.length) return '<div class="empty-state" style="padding:16px">暂无数据</div>';
    const fieldCount = fields.length;
    let h = '<div class="table-wrap"><table class="data-table"><thead><tr>';
    headers.forEach(hdr => { h += '<th>' + hdr + '</th>'; });
    h += '<th style="width:90px">操作</th></tr></thead><tbody>';
    items.forEach((item, idx) => {
      h += '<tr>';
      fields.forEach(f => {
        const val = typeof item[f] !== 'undefined' ? item[f] : '';
        const isPrice = f === 'price' || f === 'dailyPrice' || f === 'halfDayPrice';
        h += isPrice ? '<td>' + val + '</td>' : '<td>' + val + '</td>';
      });
      h += `<td class="row-actions">
        <button class="btn btn-sm btn-secondary" onclick="UI._editConfigItem('${type}', ${idx})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="UI._deleteConfigItem('${type}', ${idx})">删除</button>
      </td></tr>`;
    });
    h += '</tbody></table></div>';
    return h;
  },

  _addConfigItem(type) {
    let fields = [];
    if (type === 'ticket' || type === 'coffee' || type === 'workshop') {
      fields = ['名称', '单价'];
    } else if (type === 'space') {
      fields = ['空间名', '日价', '半天价', '说明'];
    }
    const name = prompt('请输入' + fields[0] + '：');
    if (!name) return;
    const price = parseFloat(prompt('请输入' + fields[1] + '：'));
    if (isNaN(price) || price < 0) { this.toast('请输入有效价格', 'error'); return; }

    let item;
    if (type === 'ticket' || type === 'coffee' || type === 'workshop') {
      item = { name, price };
    } else if (type === 'space') {
      const halfDay = parseFloat(prompt('请输入半天价（输入0表示无）：')) || 0;
      const desc = prompt('请输入说明：') || '';
      item = { name, dailyPrice: price, halfDayPrice: halfDay, desc };
    }

    const keyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products', space: 'spaces' };
    const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS', space: 'spaceDetails' };
    const listKey = listKeyMap[type];
    const dbKey = keyMap[type];

    MODELS[listKey] = MODELS[listKey] || [];
    MODELS[listKey].push(item);

    // 同步更新旧常量兼容
    if (type === 'ticket') { MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10; if (MODELS.ticketProducts.length > 1) MODELS.COMBO_PRICE = MODELS.ticketProducts[1].price; }
    if (type === 'coffee') { MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15; }
    if (type === 'space') { MODELS.SPACES = MODELS.spaceDetails.map(s => s.name); }

    Store.saveConfig(dbKey, MODELS[listKey]);
    this.toast('已新增');
    this.renderProductPage();
  },

  _editConfigItem(type, idx) {
    const keyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products', space: 'spaces' };
    const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS', space: 'spaceDetails' };
    const listKey = listKeyMap[type];
    const dbKey = keyMap[type];
    const items = MODELS[listKey] || [];
    if (!items[idx]) return;
    const item = items[idx];

    if (type === 'ticket' || type === 'coffee' || type === 'workshop') {
      const name = prompt('名称：', item.name);
      if (!name) return;
      const price = parseFloat(prompt('单价：', item.price));
      if (isNaN(price) || price < 0) { this.toast('请输入有效价格', 'error'); return; }
      items[idx] = { name, price };
    } else if (type === 'space') {
      const name = prompt('空间名：', item.name);
      if (!name) return;
      const dp = parseFloat(prompt('日价：', item.dailyPrice));
      if (isNaN(dp)) { this.toast('请输入有效日价', 'error'); return; }
      const hp = parseFloat(prompt('半天价：', item.halfDayPrice)) || 0;
      const desc = prompt('说明：', item.desc) || '';
      items[idx] = { name, dailyPrice: dp, halfDayPrice: hp, desc };
    }

    // 同步
    if (type === 'ticket') { MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10; if (MODELS.ticketProducts.length > 1) MODELS.COMBO_PRICE = MODELS.ticketProducts[1].price; }
    if (type === 'coffee') { MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15; }
    if (type === 'space') { MODELS.SPACES = MODELS.spaceDetails.map(s => s.name); }

    Store.saveConfig(dbKey, items);
    this.toast('已更新');
    this.renderProductPage();
  },

  _deleteConfigItem(type, idx) {
    if (!confirm('确认删除？')) return;
    const keyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products', space: 'spaces' };
    const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS', space: 'spaceDetails' };
    const listKey = listKeyMap[type];
    const dbKey = keyMap[type];
    const items = MODELS[listKey] || [];
    items.splice(idx, 1);

    if (type === 'ticket') { MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10; MODELS.COMBO_PRICE = MODELS.ticketProducts.length > 1 ? MODELS.ticketProducts[1].price : 25; }
    if (type === 'coffee') { MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15; }
    if (type === 'space') { MODELS.SPACES = MODELS.spaceDetails.map(s => s.name); }

    Store.saveConfig(dbKey, items);
    this.toast('已删除');
    this.renderProductPage();
  },

  // ===== 文创产品管理 =====
  _creativeProducts: [],
  _cpFilterSupplier: '',
  _cpPage: 0,
  _CP_PAGE_SIZE: 40,

  async _loadCreativeProducts() {
    try {
      this._creativeProducts = await Store.getAll('creativeProducts') || [];
    } catch (e) {
      this._creativeProducts = [];
    }
    return this._creativeProducts;
  },

  /** 获取去重后的供应商列表 */
  _cpSuppliers() {
    const s = new Set();
    this._creativeProducts.forEach(p => { if (p.supplier) s.add(p.supplier); });
    return [...s].sort();
  },

  /** 根据当前筛选条件获取产品子集 */
  _cpFiltered() {
    let list = this._creativeProducts;
    if (this._cpFilterSupplier) {
      list = list.filter(p => p.supplier === this._cpFilterSupplier);
    }
    return list;
  },

  /** 当前页的产品 */
  _cpPageItems() {
    const filtered = this._cpFiltered();
    const start = this._cpPage * this._CP_PAGE_SIZE;
    return filtered.slice(start, start + this._CP_PAGE_SIZE);
  },

  async _renderCreativeProductList() {
    const el = document.getElementById('prod-creative-table');
    if (!el) return;
    await this._loadCreativeProducts();
    const suppliers = this._cpSuppliers();
    const filtered = this._cpFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / this._CP_PAGE_SIZE));

    // 修正越界页码
    if (this._cpPage >= totalPages) this._cpPage = totalPages - 1;

    const countEl = $('#cp-count');
    if (countEl) countEl.textContent = `${filtered.length} 个产品（共 ${this._creativeProducts.length} 个）`;

    const pageItems = this._cpPageItems();

    if (!this._creativeProducts.length) {
      el.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">📦</div>暂无文创产品，请新增或导入</div>';
      return;
    }

    // —— 供应商筛选 + 分页控件 ——
    let toolbarHtml = `<div class="cp-toolbar">
      <div class="form-group" style="margin-bottom:0">
        <label style="display:inline;font-size:12px">供应商</label>
        <select id="cp-supplier-filter" onchange="UI._cpOnFilterChange()" style="padding:4px 8px;font-size:13px">
          <option value="">全部供应商</option>
          ${suppliers.map(s => `<option value="${s}"${this._cpFilterSupplier === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="cp-pagination">
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(0)" ${this._cpPage === 0 ? 'disabled' : ''}>首页</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage - 1})" ${this._cpPage === 0 ? 'disabled' : ''}>‹ 上一页</button>
        <span class="cp-page-info">第 ${this._cpPage + 1}/${totalPages} 页</span>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage + 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>下一页 ›</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${totalPages - 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>末页</button>
      </div>
    </div>`;

    let h = toolbarHtml;
    h += '<div class="table-wrap"><table class="data-table"><thead><tr><th>名称</th><th>SKU</th><th>供应商</th><th>进货价</th><th>零售价</th><th>库存</th><th>单位</th><th>备注</th><th style="width:90px">操作</th></tr></thead><tbody>';

    if (!pageItems.length && filtered.length > 0) {
      h += `<tr><td colspan="9" style="text-align:center;color:var(--gray-500)">当前页无数据</td></tr>`;
    }

    pageItems.forEach((p) => {
      h += `<tr>
        <td>${p.name || '-'}</td>
        <td>${p.sku || '-'}</td>
        <td>${p.supplier || '-'}</td>
        <td>¥${this._fmt(p.costPrice)}</td>
        <td><strong>¥${this._fmt(p.retailPrice)}</strong></td>
        <td><span class="tag ${(p.stock || 0) <= 0 ? 'tag-danger' : 'tag-success'}">${p.stock || 0}</span></td>
        <td>${p.unit || '个'}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${p.notes || '-'}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editCreativeProduct('${p.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteCreativeProduct('${p.id}')">删除</button>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';

    // 底部再放一次分页
    if (totalPages > 1) {
      h += `<div class="cp-toolbar" style="margin-top:8px">
        <div></div>
        <div class="cp-pagination">
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(0)" ${this._cpPage === 0 ? 'disabled' : ''}>首页</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage - 1})" ${this._cpPage === 0 ? 'disabled' : ''}>‹ 上一页</button>
          <span class="cp-page-info">第 ${this._cpPage + 1}/${totalPages} 页</span>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage + 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>下一页 ›</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${totalPages - 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>末页</button>
        </div>
      </div>`;
    }

    el.innerHTML = h;
  },

  _cpOnFilterChange() {
    this._cpFilterSupplier = document.getElementById('cp-supplier-filter')?.value || '';
    this._cpPage = 0;
    this._renderCreativeProductList();
  },

  _cpGoToPage(page) {
    const filtered = this._cpFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / this._CP_PAGE_SIZE));
    if (page < 0 || page >= totalPages) return;
    this._cpPage = page;
    this._renderCreativeProductList();
  },

  _showCreativeProductModal(data, isEdit) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const d = data || {};
    overlay.innerHTML = `
      <div class="modal-card" style="min-width:480px">
        <div class="modal-title">${isEdit ? '编辑文创产品' : '新增文创产品'}</div>
        <div class="form-grid">
          <div class="form-group"><label>产品名称 *</label><input type="text" id="cp-name" value="${d.name || ''}" placeholder="必填"></div>
          <div class="form-group"><label>SKU/编码</label><input type="text" id="cp-sku" value="${d.sku || ''}" placeholder="选填"></div>
          <div class="form-group"><label>供应商</label><input type="text" id="cp-supplier" value="${d.supplier || ''}" placeholder="选填"></div>
          <div class="form-group"><label>进货价</label><input type="number" id="cp-cost" min="0" step="0.01" value="${d.costPrice || 0}" placeholder="0.00"></div>
          <div class="form-group"><label>零售价 *</label><input type="number" id="cp-retail" min="0" step="0.01" value="${d.retailPrice || 0}" placeholder="0.00"></div>
          <div class="form-group"><label>库存数量</label><input type="number" id="cp-stock" min="0" step="1" value="${d.stock || 0}" placeholder="0"></div>
          <div class="form-group"><label>单位</label><select id="cp-unit">
            ${['个','件','套','只','对','盒','包'].map(u => `<option value="${u}"${(d.unit||'个') === u ? ' selected' : ''}>${u}</option>`).join('')}
          </select></div>
          <div class="form-group full"><label>备注</label><input type="text" id="cp-notes" value="${d.notes || ''}" placeholder="选填"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" id="cp-save-btn">${isEdit ? '保存修改' : '创建产品'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#cp-save-btn').addEventListener('click', async () => {
      const name = overlay.querySelector('#cp-name').value.trim();
      if (!name) { UI.toast('请输入产品名称', 'error'); return; }
      const record = {
        name,
        sku: overlay.querySelector('#cp-sku').value.trim(),
        supplier: overlay.querySelector('#cp-supplier').value.trim(),
        costPrice: +overlay.querySelector('#cp-cost').value || 0,
        retailPrice: +overlay.querySelector('#cp-retail').value || 0,
        stock: +overlay.querySelector('#cp-stock').value || 0,
        unit: overlay.querySelector('#cp-unit').value,
        notes: overlay.querySelector('#cp-notes').value.trim()
      };
      try {
        if (isEdit && d.id) {
          await Store.update('creativeProducts', d.id, record);
          UI.toast('产品已更新');
        } else {
          await Store.add('creativeProducts', createCreativeProduct(record));
          UI.toast('产品已新增');
        }
        overlay.remove();
        await UI._renderCreativeProductList();
      } catch (e) {
        UI.toast('保存失败：' + (e.message || e), 'error');
      }
    });
  },

  async _addCreativeProduct() {
    this._showCreativeProductModal(null, false);
  },

  async _editCreativeProduct(id) {
    const p = this._creativeProducts.find(x => x.id === id);
    if (!p) { this.toast('产品不存在', 'error'); return; }
    this._showCreativeProductModal(p, true);
  },

  async _deleteCreativeProduct(id) {
    const p = this._creativeProducts.find(x => x.id === id);
    if (!confirm(`确认删除产品「${p ? p.name : id}」？`)) return;
    await Store.delete('creativeProducts', id);
    this.toast('已删除');
    await this._renderCreativeProductList();
  },

  async _importCreativeProducts() {
    // 创建隐藏 file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await this._parseCreativeImportFile(file);
        if (!data || !data.length) { this.toast('未解析到有效数据', 'error'); return; }
        let imported = 0;
        for (const row of data) {
          try {
            await Store.add('creativeProducts', createCreativeProduct(row));
            imported++;
          } catch (err) {
            console.warn('导入失败:', row, err);
          }
        }
        this.toast(`导入完成：共 ${imported} 个产品`);
        await this._renderCreativeProductList();
      } catch (err) {
        this.toast('导入失败：' + (err.message || err), 'error');
      }
    };
    input.click();
  },

  _parseCreativeImportFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          if (file.name.endsWith('.xlsx')) {
            // 使用 SheetJS (xlsx.full.min.js) — 用 array 模式代替 deprecated binary 模式
            if (typeof XLSX === 'undefined') { reject(new Error('缺少 xlsx 库')); return; }
            const wb = XLSX.read(content, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            resolve(rows.map(r => {
              const nameVal = this._getCPField(r, ['产品名称','产品名','名称','name','Name','商品名','商品名称']);
              return {
                name: String(nameVal || '').trim(),
                sku: String(this._getCPField(r, ['SKU','sku','Sku','编码','编号','货号']) || '').trim(),
                supplier: String(this._getCPField(r, ['供应商','supplier','Supplier','供货商']) || '').trim(),
                costPrice: +(+this._getCPField(r, ['进货价','costPrice','cost_price','进价','成本价']) || 0),
                retailPrice: +(+this._getCPField(r, ['零售价','retailPrice','retail_price','售价','单价','价格']) || 0),
                stock: +(+this._getCPField(r, ['库存','stock','库存数量','quantity','数量']) || 0),
                unit: String(this._getCPField(r, ['单位','unit','Unit']) || '个').trim(),
                notes: String(this._getCPField(r, ['备注','notes','备注说明']) || '').trim()
              };
            }).filter(r => r.name));
          } else {
            // CSV 解析
            const lines = content.replace(/^﻿/, '').split('\n').filter(l => l.trim());
            if (lines.length < 2) { reject(new Error('CSV 为空或只有表头')); return; }
            const headers = this._parseCSVLine(lines[0]);
            const results = [];
            for (let i = 1; i < lines.length; i++) {
              const vals = this._parseCSVLine(lines[i]);
              if (vals.length < 2) continue;
              const row = {};
              headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
              const nameVal = this._getCPField(row, ['产品名称','产品名','名称','name','Name','商品名','商品名称']);
              if (!nameVal) continue;
              results.push({
                name: String(nameVal || '').trim(),
                sku: String(this._getCPField(row, ['SKU','sku','Sku','编码','编号','货号']) || '').trim(),
                supplier: String(this._getCPField(row, ['供应商','supplier','Supplier','供货商']) || '').trim(),
                costPrice: +(+this._getCPField(row, ['进货价','costPrice','cost_price','进价','成本价']) || 0),
                retailPrice: +(+this._getCPField(row, ['零售价','retailPrice','retail_price','售价','单价','价格']) || 0),
                stock: +(+this._getCPField(row, ['库存','stock','库存数量','quantity','数量']) || 0),
                unit: String(this._getCPField(row, ['单位','unit','Unit']) || '个').trim(),
                notes: String(this._getCPField(row, ['备注','notes','备注说明']) || '').trim()
              });
            }
            resolve(results);
          }
        } catch (err) { reject(err); }
      };
      if (file.name.endsWith('.xlsx')) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file, 'UTF-8');
      }
    });
  },

  // 按候选名称列表从行数据中取第一个有效值
  _getCPField(row, candidates) {
    for (const key of candidates) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
        return row[key];
      }
    }
    return '';
  },

  _parseCSVLine(line) {
    const result = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { result.push(current); current = ''; }
        else current += ch;
      }
    }
    result.push(current);
    return result;
  },

  async _exportCreativeProducts() {
    await this._loadCreativeProducts();
    if (!this._creativeProducts.length) { this.toast('没有产品可导出', 'error'); return; }
    const headers = ['产品名称','SKU','供应商','进货价','零售价','库存','单位','备注'];
    const rows = this._creativeProducts.map(p => [
      p.name || '', p.sku || '', p.supplier || '',
      (+p.costPrice || 0).toFixed(2), (+p.retailPrice || 0).toFixed(2),
      p.stock || 0, p.unit || '个', p.notes || ''
    ]);
    this._downloadCSV(headers, rows, '文创产品列表');
  },

  async _exportCreativeSales() {
    const { start, end } = ImportExport._getExportDates();
    const all = await Store.getAll('revenue');
    let records = ImportExport._filterByDateRange(all, start, end);
    // 只筛选有文创产品的记录
    records = records.filter(r => {
      const items = Array.isArray(r.retailItems) ? r.retailItems : [];
      return items.length > 0;
    });
    if (!records.length) { this.toast('所选范围内无文创销售记录', 'error'); return; }

    // 展开每条 retailItems
    const headers = ['日期','产品名称','数量','单价','金额','收款方式','经手人','备注','创建时间'];
    const rows = [];
    records.forEach(r => {
      const items = Array.isArray(r.retailItems) ? r.retailItems : [];
      items.forEach(item => {
        rows.push([
          r.date,
          item.productName || '',
          item.qty || 1,
          (item.unitPrice || 0).toFixed(2),
          (item.amount || 0).toFixed(2),
          r.paymentMethod || '',
          r.handler || '',
          r.notes || '',
          r.createdAt || ''
        ]);
      });
    });
    this._downloadCSV(headers, rows, '文创销售清单');
  },

  _downloadCSV(headers, rows, label) {
    const csvContent = '﻿' + headers.join(',') + '\n' + rows.map(row => row.map(v => {
      const s = String(v !== undefined && v !== null ? v : '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `艾维美术馆_${label}_${todayStr()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast(`${label}已导出`);
  },

  _downloadImportTemplate() {
    const headers = ['产品名称','SKU','供应商','进货价','零售价','库存','单位','备注'];
    const example = ['示例文创笔记本','CP-001','示例供应商','15','38','100','个','首批进货'];
    const csvContent = '﻿' + headers.join(',') + '\n' + example.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `艾维美术馆_文创产品导入模板_${todayStr()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast('导入模板已下载，请按表头格式填写后导入');
  },

  // === 用户管理 ===
  async renderUsersPage() {
    const page = $('#page-users');
    if (!Auth.isAdmin) { html(page, '<div class="card"><p style="color:var(--red)">无权限访问</p></div>'); return; }
    html(page, '<div class="loading-state"><div class="spinner"></div><span>加载用户数据...</span></div>');
    try {
      const users = await Auth.listUsers();
      let h = '';

      // 修改密码卡片
      h += '<div class="card"><div class="card-title">🔑 修改密码</div>';
      h += '<div class="form-grid" style="max-width:500px">';
      h += '<div class="form-group"><label>当前密码</label><input type="password" id="self-old-pwd" autocomplete="current-password"></div>';
      h += '<div class="form-group"><label>新密码（至少 6 位）</label><input type="password" id="self-new-pwd" autocomplete="new-password"></div>';
      h += '<div class="form-group"><label>确认新密码</label><input type="password" id="self-new-pwd-confirm" autocomplete="new-password"></div>';
      h += '<div class="form-group" style="align-self:flex-end"><button class="btn btn-primary" onclick="UI._changeOwnPassword()">确认修改</button></div>';
      h += '</div></div>';

      // 用户列表
      h += '<div class="card"><div class="card-title">👥 用户管理</div>';
      h += '<table class="data-table"><thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead><tbody>';
      users.forEach(u => {
        const isSelf = u.id === Auth.currentUser.id;
        h += `<tr>
          <td>${u.username}</td>
          <td>${u.displayName || '-'}</td>
          <td>${u.role === 'admin' ? '管理员' : u.role === 'editor' ? '编辑者' : '查看者'}</td>
          <td>${u.isActive ? '<span style="color:var(--green-700)">启用</span>' : '<span style="color:var(--red)">禁用</span>'}</td>
          <td>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
          <td class="action-cell">
            <div class="row-actions">
            ${u.role !== 'admin' && !isSelf ? `<button class="btn btn-sm btn-secondary" onclick="Auth.toggleUser('${u.id}').then(()=>UI.renderUsersPage()).catch(e=>UI.toast(e.message,'error'))">${u.isActive ? '禁用' : '启用'}</button> ` : ''}
            ${u.role !== 'admin' && !isSelf ? `<button class="btn btn-sm btn-secondary" onclick="Auth.resetPassword('${u.id}').then(()=>UI.toast('密码已重置为 88888888')).then(()=>UI.renderUsersPage()).catch(e=>UI.toast(e.message,'error'))">重置密码</button> ` : ''}
            ${u.role !== 'admin' ? `<button class="btn btn-sm btn-secondary" onclick="UI._editUser('${u.id}')">编辑</button> ` : ''}
            ${u.role !== 'admin' && !isSelf ? `<button class="btn btn-sm btn-danger" onclick="UI._deleteUser('${u.id}','${u.username}')">删除</button>` : ''}
            ${isSelf ? '<span style="color:var(--gray-500);font-size:12px">当前用户</span>' : ''}
            </div>
          </td>
        </tr>`;
      });
      h += '</tbody></table></div>';
      // 新增用户表单
      h += '<div class="card"><div class="card-title">➕ 新增用户</div>';
      h += '<div class="form-grid" style="max-width:600px">';
      h += '<div class="form-group"><label>用户名</label><input type="text" id="new-user-name" placeholder="支持中文"></div>';
      h += '<div class="form-group"><label>显示名称</label><input type="text" id="new-user-display" placeholder="选填"></div>';
      h += '<div class="form-group"><label>角色</label><select id="new-user-role"><option value="editor">编辑者</option><option value="viewer">查看者</option></select></div>';
      h += '<div class="form-group" style="align-self:flex-end"><button class="btn btn-primary" onclick="UI._addUser()">创建用户</button></div>';
      h += '</div></div>';
      html(page, h);
    } catch (e) {
      html(page, '<div class="card"><p style="color:var(--red)">' + e.message + '</p></div>');
    }
  },

  async _editUser(id) {
    // 获取用户最新数据
    const user = await Store.getById('users', id);
    if (!user) { UI.toast('用户不存在', 'error'); return; }
    const displayName = user.displayName || '';
    const role = user.role || 'editor';

    // 构建编辑弹窗
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">编辑用户</div>
        <div class="form-grid">
          <div class="form-group"><label>显示名称</label><input type="text" id="edit-user-display" value="${displayName}"></div>
          <div class="form-group"><label>角色</label><select id="edit-user-role">
            <option value="admin" ${role === 'admin' ? 'selected' : ''}>管理员</option>
            <option value="editor" ${role === 'editor' ? 'selected' : ''}>编辑者</option>
            <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>查看者</option>
          </select></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" id="edit-user-confirm">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // 保存
    overlay.querySelector('#edit-user-confirm').addEventListener('click', async () => {
      const newDisplay = overlay.querySelector('#edit-user-display').value.trim();
      const newRole = overlay.querySelector('#edit-user-role').value;
      try {
        await Auth.editUser(id, { displayName: newDisplay || displayName, role: newRole });
        UI.toast('用户信息已更新');
        overlay.remove();
        UI.renderUsersPage();
      } catch (e) {
        UI.toast(e.message, 'error');
      }
    });
  },

  async _deleteUser(id, username) {
    if (!confirm(`确定要删除用户「${username}」吗？此操作不可恢复。`)) return;
    try {
      await Auth.deleteUser(id);
      UI.toast(`用户「${username}」已删除`);
      this.renderUsersPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async _changeOwnPassword() {
    const oldPwd = $('#self-old-pwd')?.value;
    const newPwd = $('#self-new-pwd')?.value;
    const confirm = $('#self-new-pwd-confirm')?.value;
    if (!oldPwd) { UI.toast('请输入当前密码', 'error'); return; }
    if (newPwd.length < 6) { UI.toast('新密码至少 6 位', 'error'); return; }
    if (newPwd !== confirm) { UI.toast('两次密码输入不一致', 'error'); return; }
    try {
      await Auth.changeOwnPassword(oldPwd, newPwd);
      UI.toast('密码修改成功');
      $('#self-old-pwd').value = '';
      $('#self-new-pwd').value = '';
      $('#self-new-pwd-confirm').value = '';
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async _addUser() {
    const name = $('#new-user-name')?.value?.trim();
    const display = $('#new-user-display')?.value?.trim();
    const role = $('#new-user-role')?.value;
    if (!name) { UI.toast('请输入用户名', 'error'); return; }
    try {
      await Auth.addUser({ username: name, displayName: display, role });
      UI.toast(`用户「${name}」已创建（默认密码 88888888）`);
      this.renderUsersPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  // === 数据报表 ===
  async renderReportsPage() {
    const page = $('#page-reports');
    const ym = todayStr().slice(0, 7);
    html(page, `
      <div class="filter-bar">
        <div class="form-group"><label>年份</label><select id="rpt-year" onchange="Charts._onFilterChange()">${this._yearOptions()}</select></div>
        <div class="form-group"><label>月份</label><select id="rpt-month" onchange="Charts._onFilterChange()">
          <option value="">全部</option>
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
            const ms = String(m).padStart(2, '0');
            return `<option value="${ms}"${ms === ym.slice(5) ? ' selected' : ''}>${m}月</option>`;
          }).join('')}
        </select></div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="Charts.renderAll()">刷新图表</button>
      </div>
      <div id="report-charts"><div class="loading-state" style="text-align:center;padding:80px"><div class="spinner"></div><span style="margin-left:10px">加载报表数据中...</span></div></div>
    `);
    // 加载图表需要时间，延迟一帧让 loading 先显示
    setTimeout(async () => {
      await Charts.renderAll();
    }, 50);
  },

  // === 数据管理 ===
  async renderManagePage() {
    const page = $('#page-manage');
    if (!Auth.hasModuleAccess('manage')) { this._noAccess(page); return; }
    html(page, `
<div class="card manage-section">
        <h3>📤 导出数据</h3>
        <p class="manage-desc">选择导出时间范围（留空为全部数据）：</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-sm btn-secondary" onclick="UI._setExportRange('week')">本周</button>
          <button class="btn btn-sm btn-secondary" onclick="UI._setExportRange('month')">本月</button>
          <button class="btn btn-sm btn-secondary" onclick="UI._setExportRange('year')">本年</button>
          <button class="btn btn-sm btn-secondary" onclick="UI._setExportRange('all')">全部</button>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <label style="font-size:13px;display:flex;align-items:center;gap:4px">开始日期：<input type="date" id="export-start" style="padding:4px 8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px"></label>
          <label style="font-size:13px;display:flex;align-items:center;gap:4px">结束日期：<input type="date" id="export-end" style="padding:4px 8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);font-size:13px"></label>
        </div>
        <p class="manage-desc">导出为 CSV 或 JSON 格式</p>
        <div class="manage-actions">
          <button class="btn btn-gold" onclick="ImportExport.exportCSV('revenue')">导出收入数据</button>
          <button class="btn btn-gold" onclick="ImportExport.exportCSV('expense')">导出支出数据</button>
          <button class="btn btn-gold" onclick="ImportExport.exportCSV('space')">导出空间使用数据</button>
          <button class="btn btn-gold" onclick="ImportExport.exportCSV('gallery')">导出画廊销售数据</button>
          <button class="btn btn-gold" onclick="ImportExport.exportAllJSON()">导出全部(JSON备份)</button>
        </div>
      </div>
      <div class="card manage-section">
        <h3>📊 数据概览</h3>
        <p id="manage-data-count" class="manage-desc">加载中...</p>
      </div>
      <div class="card manage-section">
        <h3>☁️ 数据库状态</h3>
        <p id="manage-db-status" class="manage-desc">检查中...</p>
        <div class="manage-actions" style="margin-top:8px">
          <button class="btn btn-sm btn-secondary" onclick="UI._checkDBStatus()">刷新状态</button>
        </div>
      </div>
          `);
    await this._updateManageStats();
    this._checkDBStatus();
  },

  async _updateManageStats() {
    const rev = await Store.getAll('revenue');
    const exp = await Store.getAll('expense');
    const spa = await Store.getAll('space');
    const gal = await Store.getAll('gallery');
    const el = $('#manage-data-count');
    if (el) el.innerHTML = `收入记录 <strong>${rev.length}</strong> 条 · 支出记录 <strong>${exp.length}</strong> 条 · 空间使用记录 <strong>${spa.length}</strong> 条 · 画廊销售记录 <strong>${gal.length}</strong> 条`;
  },

  _setExportRange(range) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const fmt = d => d.toISOString().slice(0, 10);
    const start = document.getElementById('export-start');
    const end = document.getElementById('export-end');
    if (!start || !end) return;
    if (range === 'all') {
      start.value = '';
      end.value = '';
      return;
    }
    if (range === 'week') {
      // 自然周：周一 ~ 周日
      const day = now.getDay() || 7; // Sun=0->7
      const mon = new Date(now);
      mon.setDate(d - day + 1);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      start.value = fmt(mon);
      end.value = fmt(sun);
    } else if (range === 'month') {
      // 自然月：1日 ~ 月末
      start.value = fmt(new Date(y, m, 1));
      end.value = fmt(new Date(y, m + 1, 0));
    } else if (range === 'year') {
      // 本年：1月1日 ~ 今天
      start.value = fmt(new Date(y, 0, 1));
      end.value = fmt(now);
    }
  },

  async _checkDBStatus() {
    const el = $('#manage-db-status');
    if (el) el.innerHTML = '检查中...';
    const result = await Store.healthCheck();
    if (el) {
      const isOk = result.ok;
      el.innerHTML = `<span style="color:${isOk ? 'var(--green-700)' : 'var(--red)'}">${isOk ? '✅' : '❌'} ${result.message}</span>`;
    }
  },

  async _clearAllData() {
    if (!confirm('确认清除所有数据？此操作不可恢复！')) return;
    if (!confirm('再次确认：将删除全部收入、支出和空间使用数据？')) return;
    await Store.clearAll('revenue');
    await Store.clearAll('expense');
    await Store.clearAll('space');
    await Store.clearAll('gallery');
    this.toast('所有数据已清除');
    await this._updateManageStats();
  },

  // === 一键迁移（localStorage → Supabase） ===
  async _migrateFromLocal() {
    const lRev = (() => { try { return JSON.parse(localStorage.getItem('aiwei_revenue')) || []; } catch { return []; } })();
    const lExp = (() => { try { return JSON.parse(localStorage.getItem('aiwei_expense')) || []; } catch { return []; } })();
    const lSpc = (() => { try { return JSON.parse(localStorage.getItem('aiwei_space')) || []; } catch { return []; } })();

    const total = lRev.length + lExp.length + lSpc.length;
    if (!total) { this.toast('本地没有找到可迁移的数据', 'error'); return; }

    if (!confirm(`将从本地迁移 ${lRev.length} 条收入、${lExp.length} 条支出、${lSpc.length} 条空间数据到云端数据库，确认？`)) return;

    try {
      if (lRev.length) await Store.importData('revenue', lRev);
      if (lExp.length) await Store.importData('expense', lExp);
      if (lSpc.length) await Store.importData('space', lSpc);
      this.toast(`迁移完成！共 ${total} 条记录已写入云端数据库`);
      await this._updateManageStats();
    } catch (e) {
      this.toast('迁移失败：' + (e.message || e), 'error');
    }
  }
};
