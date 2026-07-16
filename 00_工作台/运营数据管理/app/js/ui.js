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
  _artworkFilterChip: 'all',  // 画廊库存子过滤：all | instock | exhibiting | soldout | lowstock
  _artworkSalesPeriod: 'month',  // 销售额月/年切换：month | year
  _salesAgg: { month: 0, year: 0, total: 0 },  // 画廊销售聚合（缓存）
  _spaceStatsTotalPeriod: (typeof localStorage !== 'undefined' && localStorage.getItem('aiwei_space_stats_total_period')) || 'month',  // 总收入统计周期：month | year
  _spaceStatsReceivedPeriod: (typeof localStorage !== 'undefined' && localStorage.getItem('aiwei_space_stats_received_period')) || 'month',  // 已收统计周期：month | year
  // 产品管理二级标签（重构 2026-07-10）
  _productTab: 'ticket',  // ticket | coffee | creative | workshop | gallery
  _productSearch: { ticket: '', coffee: '', creative: '', workshop: '', gallery: '' },
  _artworks: [],
  _creativeProducts: [],
  _cpFilterSupplier: '',
  _cpPage: 0,
  _CP_PAGE_SIZE: 40,

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
    this.toast('当前账号无权限访问此页面', 'error');
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

              <!-- 右列：文创/零售 + 工坊 -->
              <div>
                <div class="pos-section-title">🛒 文创/零售</div>
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
      // 明细数组字段名兼容：录入路径用驼峰（unitPrice/productName），历史/手动 SQL 可能用蛇形（unit_price/product_name）
      const itemName = i => i.productName ?? i.product_name ?? i.name ?? '';
      const itemPrice = i => i.unitPrice ?? i.unit_price ?? i.price ?? 0;
      const lines = [];
      // 普通票 + 套票明细（ticketItems 里混在一起，套票的 name==='套票'）
      const tItems = Array.isArray(r.ticketItems) ? r.ticketItems : [];
      const regularTickets = tItems.filter(i => itemName(i) !== '套票');
      const comboItems = tItems.filter(i => itemName(i) === '套票');
      const fmtItem = (icon, qty, name, unitPrice) => `${icon} ${qty}×${name} ¥${this._fmt(unitPrice)}`;
      regularTickets.forEach(i => lines.push(fmtItem('🎫', i.qty || 0, itemName(i) || '普通票', itemPrice(i))));
      comboItems.forEach(i => lines.push(fmtItem('🎟️', i.qty || 0, itemName(i) || '套票', itemPrice(i))));
      // 咖啡明细
      const cItems = Array.isArray(r.coffeeItems) ? r.coffeeItems : [];
      cItems.forEach(i => lines.push(fmtItem('☕', i.qty || 0, itemName(i) || '咖啡', itemPrice(i))));
      // 工坊明细
      const wItems = Array.isArray(r.workshopItems) ? r.workshopItems : [];
      wItems.forEach(i => lines.push(fmtItem('🔧', i.qty || 0, itemName(i) || '工坊', itemPrice(i))));
      // 文创明细
      const retItems = Array.isArray(r.retailItems) ? r.retailItems : [];
      retItems.forEach(i => lines.push(fmtItem('🛒', i.qty || 0, itemName(i) || '文创', itemPrice(i))));

      // 兜底 tag：金额>0 但明细数组为空（历史旧数据），保留旧版汇总式显示
      const fallbackTags = [];
      if ((r.ticketAmount || 0) > 0 && regularTickets.length === 0) fallbackTags.push(`🎫 普通票 ${r.ticketQty||0}张 ¥${this._fmt(r.ticketAmount)}`);
      if ((r.comboAmount || 0) > 0 && comboItems.length === 0) fallbackTags.push(`🎟️ 套票 ${r.comboQty||0}张 ¥${this._fmt(r.comboAmount)}`);
      if ((r.coffeeAmount || 0) > 0 && cItems.length === 0) fallbackTags.push(`☕ 咖啡 ${r.coffeeQty||0}杯 ¥${this._fmt(r.coffeeAmount)}`);
      if ((r.workshopAmount || 0) > 0 && wItems.length === 0) fallbackTags.push(`🔧 工坊 ¥${this._fmt(r.workshopAmount)}`);
      const retail = r.retailAmount || r.creativeAmount || 0;
      if (retail > 0 && retItems.length === 0) fallbackTags.push(`🛒 文创 ¥${this._fmt(retail)}`);
      if ((r.venueAmount || 0) > 0) fallbackTags.push(`🏛 场地 ¥${this._fmt(r.venueAmount)}`);
      if ((r.otherAmount || 0) > 0) {
        const desc = r.otherDesc ? `(${r.otherDesc})` : '';
        fallbackTags.push(`📝 其他${desc} ¥${this._fmt(r.otherAmount)}`);
      }

      const detailHtml = lines.length
        ? lines.map(t => `<div class="rev-detail-row">${t}</div>`).join('')
        : fallbackTags.map(t => `<span class="rev-tag">${t}</span>`).join('');
      const detailGroupHtml = lines.length
        ? `<div class="rev-detail-group">${detailHtml}</div>`
        : `<div class="rev-tag-group">${detailHtml}</div>`;

      const total = (r.ticketAmount||0)+(r.comboAmount||0)+(r.coffeeAmount||0)+(r.workshopAmount||0)+(r.retailAmount||r.creativeAmount||0)+(r.venueAmount||0)+(r.otherAmount||0);
      const timeStr = r.createdAt ? UI._fmtBeijingTime(r.createdAt) : r.date;
      h += `<tr>
        <td>${timeStr}</td>
        <td>${detailGroupHtml}</td>
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

  _goToProjectListTab() {
    const btn = document.querySelector('.tab-btn[data-tab="project-list"]');
    if (btn) btn.click();
  },

  // === 项目清单页（合同视角的收款快速入口；2026-07-15 重构） ===
  _projectListFilter: 'pending',  // all | pending | settled | status:{value}
  _projectListStatusFilter: '',

  async renderProjectListPage() {
    const page = $('#page-project-list');
    if (!Auth.hasModuleAccess('space')) { this._noAccess(page); return; }
    const records = await Store.getAll('space');
    this._projectListRecords = records;

    let pendingCount = 0, settledCount = 0, pendingAmount = 0, settledAmount = 0;
    records.forEach(r => {
      if (r.rentalType !== '付费') return;
      const recv = +r.receivableAmount || 0;
      const got = +r.receivedAmount || 0;
      if (got < recv) { pendingCount += 1; pendingAmount += (recv - got); }
      else { settledCount += 1; settledAmount += recv; }
    });

    const filterOpts = `
      <div class="form-group"><label>范围</label>
        <select id="pl-filter" onchange="UI._onProjectListFilterChange()">
          <option value="pending" ${this._projectListFilter === 'pending' ? 'selected' : ''}>待收（${pendingCount}）</option>
          <option value="settled" ${this._projectListFilter === 'settled' ? 'selected' : ''}>已结清（${settledCount}）</option>
          <option value="all" ${this._projectListFilter === 'all' ? 'selected' : ''}>全部（${pendingCount + settledCount}）</option>
        </select>
      </div>
      <div class="form-group"><label>状态</label>
        <select id="pl-status-filter" onchange="UI._onProjectListFilterChange()">
          <option value="">全部</option>
          <option value="筹备中" ${this._projectListStatusFilter === '筹备中' ? 'selected' : ''}>筹备中</option>
          <option value="已确认" ${this._projectListStatusFilter === '已确认' ? 'selected' : ''}>已确认</option>
          <option value="进行中" ${this._projectListStatusFilter === '进行中' ? 'selected' : ''}>进行中</option>
          <option value="已完成" ${this._projectListStatusFilter === '已完成' ? 'selected' : ''}>已完成</option>
          <option value="已取消" ${this._projectListStatusFilter === '已取消' ? 'selected' : ''}>已取消</option>
        </select>
      </div>
    `;

    html(page, `
      <div class="card">
        <div class="card-title">📋 项目清单</div>
        <div class="stat-card-grid" style="margin-bottom: 16px;">
          <div class="stat-card stat-card-clickable ${this._projectListFilter === 'pending' ? 'stat-card-active' : ''}" onclick="UI._setProjectListFilter('pending')">
            <div class="stat-label">待收</div>
            <div class="stat-value" style="color:var(--red)">${pendingCount} <span style="font-size:14px">笔合同</span></div>
            <div class="stat-sub">合计待收 ¥${this._fmt(pendingAmount)}</div>
          </div>
          <div class="stat-card stat-card-clickable ${this._projectListFilter === 'settled' ? 'stat-card-active' : ''}" onclick="UI._setProjectListFilter('settled')">
            <div class="stat-label">已结清</div>
            <div class="stat-value" style="color:var(--green-700)">${settledCount} <span style="font-size:14px">笔合同</span></div>
            <div class="stat-sub">合计应收 ¥${this._fmt(settledAmount)}</div>
          </div>
        </div>
        <div class="filter-bar">${filterOpts}</div>
        <div id="project-list-table">${this._renderProjectListTable(records)}</div>
      </div>
    `);
  },

  _setProjectListFilter(filter) {
    this._projectListFilter = filter;
    this._projectListStatusFilter = '';
    this.renderProjectListPage();
  },

  _onProjectListFilterChange() {
    this._projectListFilter = $('#pl-filter').value;
    this._projectListStatusFilter = $('#pl-status-filter').value;
    const records = this._projectListRecords || [];
    document.getElementById('project-list-table').innerHTML = this._renderProjectListTable(records);
    // 顶部统计卡同步
    this.renderProjectListPage();
  },

  _renderProjectListTable(records) {
    let arr = (records || []).filter(r => r.rentalType === '付费');
    if (this._projectListStatusFilter) {
      arr = arr.filter(r => r.status === this._projectListStatusFilter);
    }
    if (this._projectListFilter === 'pending') {
      arr = arr.filter(r => (+r.receivedAmount || 0) < (+r.receivableAmount || 0));
    } else if (this._projectListFilter === 'settled') {
      arr = arr.filter(r => (+r.receivedAmount || 0) >= (+r.receivableAmount || 0));
    }
    if (!arr.length) return '<div class="empty-state"><div class="icon">📋</div>暂无符合条件的合同</div>';

    // 按未收金额倒序
    arr.sort((a, b) => {
      const gapA = (+a.receivableAmount || 0) - (+a.receivedAmount || 0);
      const gapB = (+b.receivableAmount || 0) - (+b.receivedAmount || 0);
      return gapB - gapA;
    });

    const rows = arr.map(r => {
      const recv = +r.receivableAmount || 0;
      const got = +r.receivedAmount || 0;
      const gap = Math.max(0, recv - got);
      const pct = recv > 0 ? Math.round((got / recv) * 100) : 100;
      const isPending = gap > 0;
      const paymentsN = Array.isArray(r.payments) ? r.payments.length : 0;
      const no = this._genSpaceContractNo(r);
      return `
        <tr>
          <td><span style="font-family:monospace;background:var(--cream);padding:2px 6px;border-radius:4px;font-size:12px">${no}</span></td>
          <td>
            <div style="font-weight:600">${this._escHtml(r.projectName || '—')}</div>
            <div style="font-size:12px;color:var(--gray-500)">${this._escHtml(r.client || '未指定客户')} · ${this._escHtml(r.space || '')} · ${this._escHtml(r.type || '')}</div>
          </td>
          <td>¥${this._fmt(recv)}</td>
          <td>¥${this._fmt(got)}</td>
          <td>
            ${isPending
              ? `<span style="color:var(--red);font-weight:600">¥${this._fmt(gap)}</span>`
              : `<span style="color:var(--gray-400)">—</span>`}
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden;max-width:80px">
                <div style="width:${pct}%;height:100%;background:${isPending ? 'var(--gold)' : 'var(--green-700)'}"></div>
              </div>
              <span style="font-size:12px;color:var(--gray-500);min-width:36px">${pct}%</span>
            </div>
            ${paymentsN > 0 ? `<div style="font-size:12px;color:var(--gray-500);margin-top:2px">${paymentsN} 笔到账</div>` : ''}
          </td>
          <td><span class="tag tag-info">${this._escHtml(r.status || '筹备中')}</span></td>
          <td class="row-actions" style="white-space:nowrap">
            ${isPending ? `<button class="btn btn-primary btn-sm" onclick="UI._openQuickCollectModal('${r.id}')">💰 收款</button> ` : ''}
            <button class="btn btn-secondary btn-sm" onclick="UI._editSpace('${r.id}')">详情</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>合同编号</th><th>项目 / 客户 / 空间</th>
          <th>应收</th><th>已收</th><th>未收</th><th>已收进度</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `;
  },

  // 合同编号生成（按 id 后 6 位）
  _genSpaceContractNo(r) {
    return 'C' + (r.id || '').slice(-6).toUpperCase();
  },

  _openQuickCollectModal(spaceId) {
    const r = (this._projectListRecords || []).find(x => x.id === spaceId);
    if (!r) { this.toast('记录不存在', 'error'); return; }
    const recv = +r.receivableAmount || 0;
    const got = +r.receivedAmount || 0;
    const gap = Math.max(0, recv - got);

    const existing = document.getElementById('quick-collect-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'quick-collect-modal';
    modal.className = 'modal-mask';
    modal.innerHTML = `
      <div class="modal-card quick-collect-modal" onclick="event.stopPropagation()">
        <div class="modal-header">💰 快速到账 — ${this._escHtml(r.projectName || '')} <span style="float:right;cursor:pointer;font-size:20px;color:var(--gray-500)" onclick="document.getElementById('quick-collect-modal').remove()">×</span></div>
        <div class="quick-collect-summary">
          <div class="quick-collect-cell">
            <div class="quick-collect-label">合同总金额</div>
            <div class="quick-collect-value">¥${this._fmt(recv)}</div>
          </div>
          <div class="quick-collect-cell quick-collect-cell-highlight">
            <div class="quick-collect-label">待收款金额</div>
            <div class="quick-collect-value" style="color:var(--red)">¥${this._fmt(gap)}</div>
          </div>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group">
              <label>到账金额 <span style="color:var(--red)">*</span></label>
              <input type="number" id="qc-amount" min="0.01" max="${gap || ''}" step="0.01" placeholder="0.00" value="${gap.toFixed(2)}">
              <small style="color:var(--gray-500)">最多 ¥${this._fmt(gap)}</small>
            </div>
            <div class="form-group"><label>到账日期</label><input type="date" id="qc-date" value="${todayStr()}"></div>
            <div class="form-group full">
              <label>付款方式</label>
              <div class="radio-group">
                <label class="radio-pill"><input type="radio" name="qc-method" value="扫码支付" checked> 扫码支付</label>
                <label class="radio-pill"><input type="radio" name="qc-method" value="转账"> 转账</label>
              </div>
            </div>
            <div class="form-group full"><label>备注</label><input type="text" id="qc-notes" placeholder="选填"></div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" onclick="document.getElementById('quick-collect-modal').remove()">取消</button>
            <button class="btn btn-primary" onclick="UI._submitQuickCollect('${spaceId}')">✅ 确认收款</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', () => modal.remove());
    setTimeout(() => document.getElementById('qc-amount')?.focus(), 30);
  },

  async _submitQuickCollect(spaceId) {
    const amount = +($('#qc-amount').value || 0);
    const date = $('#qc-date').value;
    const method = (document.querySelector('input[name="qc-method"]:checked') || {}).value || '扫码支付';
    const notes = $('#qc-notes').value || '';
    if (!(amount > 0)) { this.toast('金额必须大于 0', 'error'); return; }
    const r = (this._projectListRecords || []).find(x => x.id === spaceId);
    if (!r) return;
    const gap = (+r.receivableAmount || 0) - (+r.receivedAmount || 0);
    if (amount > gap + 0.01) {
      this.toast(`金额超过待收 ¥${this._fmt(gap)}`, 'error'); return;
    }
    try {
      await Store.add('spacePayment', createSpacePayment({
        spaceUsageId: spaceId,
        paymentDate: date,
        amount, paymentMethod: method, notes
      }));
      this.toast(`已录入到账 ¥${this._fmt(amount)}`);
      document.getElementById('quick-collect-modal').remove();
      // 刷新页面与顶部 4 卡片
      this._projectListRecords = await Store.getAll('space');
      await this.renderProjectListPage();
      // 同步空间页（如果用户切回去能直接看到变化）
      const spacePage = $('#page-space');
      if (spacePage && spacePage.classList.contains('active')) {
        await this.renderSpacePage();
      }
    } catch (e) {
      this.toast('到账录入失败：' + (e.message || e), 'error');
    }
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

  // === 空间使用（重构 2026-07-10：财务卡 + 甘特图 + 子表付款）===
  async renderSpacePage() {
    const page = $('#page-space');
    if (!Auth.hasModuleAccess('space')) { this._noAccess(page); return; }
    const editing = this._editingSpaceId;
    const records = await Store.getAll('space');

    html(page, `
      <div class="rent-stat-grid" id="rent-stat-grid">${this._renderRentStatCards(records)}</div>
      <div class="card">
        <div class="card-title">🏛 空间使用日历（本月）</div>
        <div class="filter-bar">
          <div class="form-group"><label>月份</label><input type="month" id="sp-gantt-month" value="${this._spaceGanttMonth || todayStr().slice(0,7)}" onchange="UI._onGanttMonthChange()"></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('sp-gantt-month').value='${todayStr().slice(0,7)}'; UI._onGanttMonthChange()">本月</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto">色块：<span class="gantt-legend gantt-bar--partial" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle"></span> 部分收　<span class="gantt-legend gantt-bar" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;background:var(--green-500)"></span> 已收齐　<span class="gantt-legend gantt-bar--free" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;background:var(--gray-300)"></span> 免费</span>
        </div>
        <div id="space-gantt">${this._renderSpaceGantt(records, this._spaceGanttMonth || todayStr().slice(0,7))}</div>
      </div>
      <div class="card">
        <div class="card-title">${editing ? '编辑使用记录' : '新增使用登记'}</div>
        <form id="space-form" class="form-grid" onsubmit="return false">
          <div class="form-group"><label>日期</label><input type="date" id="sp-date" value="${todayStr()}" onchange="UI._autoSetExpectedPayment()"></div>
          <div class="form-group"><label>结束日期</label><input type="date" id="sp-end-date" value="" onchange="UI._autoSetExpectedPayment()"></div>
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
          <div class="form-group"><label>预计到账日</label><input type="date" id="sp-expected-payment"></div>
          <div class="form-group full"><label>备注</label><textarea id="sp-notes" rows="2"></textarea></div>
          <div class="form-actions full">
            <button type="button" class="btn btn-primary" onclick="UI._saveSpace()">${editing ? '保存修改' : '保存记录'}</button>
            ${editing ? '<button type="button" class="btn btn-secondary" onclick="UI._cancelEditSpace()">取消编辑</button>' : ''}
          </div>
        </form>
      </div>
      ${editing ? `<div class="card" id="space-payments-card">${await this._renderPaymentsCard(editing)}</div>` : ''}
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

    // 初始化租金类型 + 自动算预计到账日
    this._toggleRentalType();
    this._autoSetExpectedPayment();

    if (editing) {
      const r = await Store.getById('space', editing);
      if (r) this._fillSpaceForm(r);
    }
    await this._renderSpaceList();
  },

  // === 顶部 4 张财务卡片（2026-07-14 重构：双口径时间锚点；2026-07-15 拆分切换器）
  //   总收入 → 按合同月（rentalType==='付费' 且 r.date 在期内），独立切换器
  //   已收 → 按入账日（space_payments.payment_date 在期内），独立切换器
  //   未收 → 全期存量（SUM(receivable - received)），无切换器
  //   待收项目 → 全期存量（COUNT(应收>已收 的合同数)），无切换器）===
  _renderRentStatCards(records) {
    const totalPeriod = this._spaceStatsTotalPeriod || 'month';
    const recvPeriod = this._spaceStatsReceivedPeriod || 'month';
    const today = todayStr();
    const totalStart = totalPeriod === 'month' ? today.slice(0, 7) : today.slice(0, 4);
    const recvStart = recvPeriod === 'month' ? today.slice(0, 7) : today.slice(0, 4);
    const totalLabel = totalPeriod === 'month' ? `${totalStart}（本月）` : `${totalStart}年（本年）`;
    const recvLabel = recvPeriod === 'month' ? `${recvStart}（本月）` : `${recvStart}年（本年）`;

    let receivable = 0;        // 流量：期内合同应收（按 totalPeriod）
    let received = 0;          // 流量：期内实收（按 recvPeriod）
    let unpaidAllTime = 0;     // 存量：全期未收合计金额
    let pendingProjects = 0;   // 存量：全期待收合同数

    records.forEach(r => {
      if (r.rentalType !== '付费') return;
      const recv = +r.receivableAmount || 0;
      const got = +r.receivedAmount || 0;

      // 流量 1：合同月落在 totalPeriod 期内 → 应收计入
      if (r.date && r.date.startsWith(totalStart)) {
        receivable += recv;
      }
      // 流量 2：遍历子表按 payment_date 落在 recvPeriod 期内计入
      const payments = Array.isArray(r.payments) ? r.payments : [];
      payments.forEach(p => {
        if (p.paymentDate && p.paymentDate.startsWith(recvStart)) {
          received += +(p.amount || 0);
        }
      });

      // 存量：未收金额 + 待收项目（全期累积，合同收齐才扣除）
      const gap = recv - got;
      if (gap > 0) {
        unpaidAllTime += gap;
        pendingProjects += 1;
      }
    });

    // 独立切换器渲染器
    const renderToggle = (cardKey, period, clickHandler) => `
      <div class="period-inline-toggle">
        <button type="button" class="rent-period-btn ${period === 'month' ? 'active' : ''}" data-period="month" onclick="UI._onSpaceCardPeriodChange('${cardKey}', 'month', this)">本月</button>
        <button type="button" class="rent-period-btn ${period === 'year' ? 'active' : ''}" data-period="year" onclick="UI._onSpaceCardPeriodChange('${cardKey}', 'year', this)">本年</button>
      </div>
    `;

    return `
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-label">总收入</div>
          ${renderToggle('total', totalPeriod)}
        </div>
        <div class="stat-value">¥${this._fmt(receivable)}</div>
        <div class="stat-sub">${totalLabel} · 合同金额</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-label">已收</div>
          ${renderToggle('received', recvPeriod)}
        </div>
        <div class="stat-value" style="color:var(--green-700)">¥${this._fmt(received)}</div>
        <div class="stat-sub">${recvLabel} · 实收金额</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未收</div>
        <div class="stat-value" style="color:var(--gold)">¥${this._fmt(unpaidAllTime)}</div>
        <div class="stat-sub">全期累积 · ${unpaidAllTime > 0 ? '需跟进' : '已结清'}</div>
      </div>
      <div class="stat-card stat-card-clickable" onclick="UI._goToProjectListTab()">
        <div class="stat-label">待收项目</div>
        <div class="stat-value" style="color:${pendingProjects > 0 ? 'var(--red)' : 'var(--gray-500)'}">${pendingProjects} <span style="font-size:14px">笔合同</span></div>
        <div class="stat-sub">全期累积 · ¥${this._fmt(unpaidAllTime)} 待收 · 点击查看 →</div>
      </div>
    `;
  },

  // === 空间页财务卡：单卡独立月/年切换器（2026-07-15） ===
  _onSpaceCardPeriodChange(cardKey, period, btn) {
    if (!['month', 'year'].includes(period)) return;
    if (cardKey === 'total') {
      this._spaceStatsTotalPeriod = period;
      try { localStorage.setItem('aiwei_space_stats_total_period', period); } catch {}
    } else if (cardKey === 'received') {
      this._spaceStatsReceivedPeriod = period;
      try { localStorage.setItem('aiwei_space_stats_received_period', period); } catch {}
    } else {
      return;
    }
    // 当前卡内按钮 active 态切换（不影响其他卡）
    const toggle = btn.parentElement;
    toggle.querySelectorAll('.rent-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    // 重渲染整个卡片网格（其余 3 张卡也用最新状态重新计算）
    Store.getAll('space').then(records => {
      const grid = document.getElementById('rent-stat-grid');
      if (grid) grid.innerHTML = this._renderRentStatCards(records);
    });
  },

  // === 甘特图自绘：横轴日期 / 纵轴空间 ===
  _renderSpaceGantt(records, yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
    const monthEnd = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const today = todayStr();
    const todayDay = today.startsWith(yearMonth) ? +today.slice(8,10) : -1;

    // 过滤当月记录
    const inMonth = records.filter(r => {
      const s = r.date, e = r.endDate || r.date;
      return !(e < monthStart || s > monthEnd);
    });

    // 表头：日期
    let headerHtml = '<div class="gantt-day-head gantt-corner">空间 \\ 日期</div>';
    for (let d = 1; d <= lastDay; d++) {
      const isToday = d === todayDay;
      headerHtml += `<div class="gantt-day-head${isToday ? ' gantt-today' : ''}">${d}</div>`;
    }
    const dayCount = lastDay;

    // 每行：1 空间
    let rowsHtml = '';
    MODELS.SPACES.forEach(space => {
      const spaceRecs = inMonth.filter(r => r.space === space);
      rowsHtml += `<div class="gantt-space-cell">${space}</div>`;
      // 每天 1 个单元格（占位，色块用 grid-column 跨列）
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${yearMonth}-${String(d).padStart(2,'0')}`;
        const cellRec = spaceRecs.find(r => r.date <= dateStr && (r.endDate || r.date) >= dateStr);
        if (cellRec && cellRec.date === dateStr) {
          // 色块起点
          const startDay = +cellRec.date.slice(8,10);
          const endDay = +(cellRec.endDate || cellRec.date).slice(8,10);
          const span = Math.min(endDay, lastDay) - startDay + 1;
          const expected = cellRec.expectedPaymentDate || this._calcExpectedPaymentDate(cellRec.date, cellRec.endDate);
          const recv = +(cellRec.receivedAmount || 0);
          const req = +(cellRec.receivableAmount || 0);
          let cls = 'gantt-bar';
          if (cellRec.rentalType === '免费') cls += ' gantt-bar--free';
          else if (req > 0 && recv >= req) cls += ' gantt-bar--paid';
          else if (recv > 0) cls += ' gantt-bar--partial';
          rowsHtml += `<div class="gantt-bar-cell">
            <div class="${cls}" style="grid-column: span ${span}" title="${this._escAttr(cellRec.projectName)} · ${cellRec.date}${cellRec.endDate && cellRec.endDate !== cellRec.date ? ' → ' + cellRec.endDate : ''} · ${cellRec.status}" onclick="UI._editSpace('${cellRec.id}')">${this._escHtml(cellRec.projectName)}</div>
          </div>`;
          d += span - 1; // 跳过被色块覆盖的日期
        } else if (cellRec) {
          // 被前面的色块覆盖，跳过（不渲染）
          rowsHtml += `<div class="gantt-bar-cell"></div>`;
        } else {
          rowsHtml += `<div class="gantt-bar-cell"></div>`;
        }
      }
    });

    return `<div class="gantt-wrap"><div class="gantt-grid" style="--days:${dayCount}">
      ${headerHtml}
      ${rowsHtml}
    </div></div>`;
  },

  _onGanttMonthChange() {
    this._spaceGanttMonth = document.getElementById('sp-gantt-month').value;
    Store.getAll('space').then(records => {
      const el = document.getElementById('space-gantt');
      if (el) el.innerHTML = this._renderSpaceGantt(records, this._spaceGanttMonth);
      // 同步刷新财务卡
      const statEl = document.getElementById('rent-stat-grid');
      if (statEl) statEl.innerHTML = this._renderRentStatCards(records);
    });
  },

  // === 子表 payments 卡（仅编辑模式显示；2026-07-15 移除录入表单，仅保留明细列表 + 删除）===
  async _renderPaymentsCard(spaceId) {
    const r = await Store.getById('space', spaceId);
    const payments = (r && r.payments) || [];
    const total = payments.reduce((s,p)=>s + (+p.amount||0), 0);
    const req = +(r?.receivableAmount || 0);
    const unpaid = Math.max(0, req - total);

    const rows = payments.map(p => `
      <tr>
        <td>${p.paymentDate}</td>
        <td>¥${this._fmt(p.amount)}</td>
        <td>${p.paymentMethod || '转账'}</td>
        <td>${this._escHtml(p.notes || '')}</td>
        <td class="row-actions"><button class="btn btn-sm btn-danger" onclick="UI._deletePayment('${p.id}','${spaceId}')">删除</button></td>
      </tr>
    `).join('');

    return `
      <div class="card-title">💰 到账明细（已收 ¥${this._fmt(total)} / 应收 ¥${this._fmt(req)}${unpaid > 0 ? ' · 待收 ¥' + this._fmt(unpaid) : ' · 已结清'}）<span style="font-size:12px;color:var(--gray-500);margin-left:8px">录入请到「📋 项目清单」</span></div>
      ${payments.length === 0 ? '<div class="empty-state">暂无到账记录</div>' : `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>日期</th><th>金额</th><th>方式</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`}
    `;
  },

  async _deletePayment(paymentId, spaceId) {
    if (!confirm('确认删除此到账记录？')) return;
    await Store.delete('spacePayment', paymentId);
    this.toast('已删除');
    const card = document.getElementById('space-payments-card');
    if (card) card.innerHTML = await this._renderPaymentsCard(spaceId);
    this._refreshGanttAndStats();
  },

  async _refreshGanttAndStats() {
    const records = await Store.getAll('space');
    const statEl = document.getElementById('rent-stat-grid');
    if (statEl) statEl.innerHTML = this._renderRentStatCards(records);
    const ganttEl = document.getElementById('space-gantt');
    if (ganttEl) ganttEl.innerHTML = this._renderSpaceGantt(records, this._spaceGanttMonth || todayStr().slice(0,7));
  },

  // === 自动算预计到账日 = 结束日期 + 30 天 ===
  _calcExpectedPaymentDate(date, endDate) {
    const base = endDate || date;
    if (!base) return '';
    const d = new Date(base);
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  },
  _autoSetExpectedPayment() {
    const date = $('#sp-date')?.value;
    const endDate = $('#sp-end-date')?.value;
    const expected = $('#sp-expected-payment');
    if (expected && date) {
      expected.value = this._calcExpectedPaymentDate(date, endDate);
    }
  },

  _escHtml(s) {
    return String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  },
  _escAttr(s) { return this._escHtml(s); },

  _toggleRentalType() {
    const type = $('#sp-rental-type')?.value;
    const amountGroup = $('#sp-rental-amount-group');
    if (!amountGroup) return;
    if (type === '免费') {
      amountGroup.style.display = 'none';
      const rInput = $('#sp-receivable');
      if (rInput) rInput.value = 0;
    } else {
      amountGroup.style.display = '';
    }
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
    $('#sp-expected-payment').value = r.expectedPaymentDate || this._calcExpectedPaymentDate(r.date, r.endDate);
    $('#sp-notes').value = r.notes || '';
    this._toggleRentalType();
  },

  async _renderSpaceList() {
    const filter = document.getElementById('sp-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#space-list');
    if (!el) return;

    const records = await Store.getByMonth('space', filter);
    const countEl = $('#sp-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">📋</div>暂无记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>结束日期</th><th>空间</th><th>项目名称</th><th>类型</th><th>客户</th><th>租金类型</th><th>状态</th><th>应收</th><th>已收</th><th>预计到账</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const statusTagClass = r.status === '已完成' ? 'tag-success' : r.status === '已取消' || r.status === '空闲' ? 'tag-danger' : 'tag-info';
      const expected = r.expectedPaymentDate || this._calcExpectedPaymentDate(r.date, r.endDate);
      h += `<tr>
        <td>${r.date}</td>
        <td>${r.endDate || '—'}</td>
        <td>${this._escHtml(r.space)}</td>
        <td>${this._escHtml(r.projectName)}</td>
        <td>${this._escHtml(r.type)}</td>
        <td>${this._escHtml(r.client || '-')}</td>
        <td><span class="tag ${r.rentalType === '免费' ? 'tag-free' : 'tag-info'}">${r.rentalType || '付费'}</span></td>
        <td><span class="tag ${statusTagClass}">${r.status}</span></td>
        <td>${r.rentalType === '免费' ? '免费' : '¥' + this._fmt(r.receivableAmount)}</td>
        <td>${r.rentalType === '免费' ? '—' : '¥' + this._fmt(r.receivedAmount || 0)}</td>
        <td>${expected || '—'}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editSpace('${r.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteSpace('${r.id}')">删除</button>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  async _saveSpace() {
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
      expectedPaymentDate: $('#sp-expected-payment').value || '',
      notes: $('#sp-notes').value
    };

    if (!data.projectName) { this.toast('请输入项目/活动名称', 'error'); return; }
    if (!data.date) { this.toast('请选择日期', 'error'); return; }

    // 硬性冲突检测（仅对已确认/进行中状态）
    if (['已确认','进行中'].includes(data.status)) {
      try {
        const r = await fetch((SUPABASE_CONFIG.url || '') + '/rest/v1/space_usage/check-conflict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            space: data.space,
            date: data.date,
            endDate: data.endDate || '',
            excludeId: this._editingSpaceId || ''
          })
        });
        if (r.status === 409) {
          const body = await r.json();
          this.toast(`时间冲突：${data.space} 在所选时段已被「${body.conflict?.projectName || '其他项目'}」占用（${body.conflict?.date}${body.conflict?.endDate && body.conflict.endDate !== body.conflict.date ? ' → ' + body.conflict.endDate : ''}）`, 'error');
          return;
        }
        if (!r.ok) {
          this.toast('冲突检测失败：HTTP ' + r.status, 'error');
          return;
        }
      } catch (e) {
        this.toast('冲突检测失败：' + e.message, 'error');
        return;
      }
    }

    try {
      if (this._editingSpaceId) {
        await Store.update('space', this._editingSpaceId, data);
        this.toast('空间使用记录已更新');
        this._editingSpaceId = null;
      } else {
        await Store.add('space', createSpaceUsage(data));
        this.toast('空间使用记录已保存');
      }
      await this.renderSpacePage();
    } catch (e) {
      this.toast('保存失败：' + (e.message || e), 'error');
    }
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
    if (!confirm('确认删除此记录？（关联的到账记录会自动一起删除）')) return;
    await Store.delete('space', id);
    this.toast('已删除');
    this._editingSpaceId = null;
    await this.renderSpacePage();
  },

  _filterSpace() {
    this._spaceFilterMonth = document.getElementById('sp-filter-month').value;
    this._renderSpaceList();
  },

  // === 画廊销售 ===
  async _pickGalleryArtwork() {
    await this._loadArtworks();
    const list = this._artworks;
    if (!list.length) {
      this.toast('作品库为空，请先在「产品管理 → 画廊」录入作品', 'error');
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const rows = list
      .filter(a => a.status !== '已售' && a.status !== '借出' && a.status !== '下架')
      .map(a => ({
        ...a,
        avail: !['已售', '借出', '下架'].includes(a.status)
      }));
    const renderRows = (filterText) => {
      const kw = (filterText || '').trim().toLowerCase();
      const filtered = !kw ? list : list.filter(a =>
        String(a.title || '').toLowerCase().includes(kw) ||
        String(a.artist || '').toLowerCase().includes(kw) ||
        String(a.location || '').toLowerCase().includes(kw)
      );
      const body = overlay.querySelector('#picker-tbody');
      if (!filtered.length) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:20px">${kw ? '没有匹配作品' : '作品库为空'}</td></tr>`;
        return;
      }
      body.innerHTML = filtered.map(a => {
        const imgUrl = this._resolveImageUrl(a.imageUrl || a.image_url || '');
        const thumb = imgUrl
          ? `<img src="${this._escHtml(imgUrl)}" class="aw-thumb" onerror="this.outerHTML='<div class=&quot;aw-thumb aw-thumb--placeholder&quot;>无图</div>'">`
          : `<div class="aw-thumb aw-thumb--placeholder">无图</div>`;
        const stClass = a.status === '在库' ? 'tag-success' : a.status === '在展' ? 'tag-info' : 'tag-danger';
        const totalQty = Number(a.totalQty ?? a.total_qty ?? 1);
        const soldQty = Number(a.soldQty ?? a.sold_qty ?? 0);
        const avail = Math.max(0, totalQty - soldQty);
        const soldOut = avail <= 0 || ['已售', '借出', '下架'].includes(a.status);
        const no = this._escHtml(a.artworkNo || a.artwork_no || '');
        return `<tr style="${soldOut ? 'opacity:0.5' : ''}">
          <td><span style="font-family:monospace;background:var(--cream);padding:2px 6px;border-radius:4px;font-size:11px">${no || '-'}</span></td>
          <td>${thumb}</td>
          <td><strong>${this._escHtml(a.title || '-')}</strong></td>
          <td>${this._escHtml(a.artist || '-')}</td>
          <td><span class="tag ${stClass}">${this._escHtml(a.status || '在库')}</span></td>
          <td>${avail}/${totalQty}</td>
          <td>¥${this._fmt(a.retailPrice ?? a.retail_price)}</td>
          <td><button type="button" class="btn btn-sm btn-primary" ${soldOut ? 'disabled title="该作品无库存可售"' : ''} onclick="UI._selectArtworkForSale('${a.id}')">${soldOut ? '已售罄' : '选择'}</button></td>
        </tr>`;
      }).join('');
    };
    overlay.innerHTML = `
      <div class="modal-card" style="min-width:720px;max-width:90vw">
        <div class="modal-title">📋 从作品库选择</div>
        <div class="filter-bar" style="margin-bottom:12px">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label>查询</label>
            <input type="text" id="picker-search" placeholder="按标题/艺术家/位置搜索..." autofocus>
          </div>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto">共 ${list.length} 件</span>
        </div>
        <div class="table-wrap" style="max-height:50vh;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th style="width:80px">编号</th><th style="width:60px">缩略图</th><th>标题</th><th>艺术家</th><th>状态</th><th style="width:90px">库存</th><th style="width:100px">零售价</th><th style="width:80px">操作</th></tr></thead>
            <tbody id="picker-tbody"></tbody>
          </table>
        </div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:8px">库存为 0 或状态为「已售/借出/下架」的作品已禁用</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const searchInput = overlay.querySelector('#picker-search');
    searchInput.addEventListener('input', () => renderRows(searchInput.value));
    renderRows('');
  },

  _selectArtworkForSale(artworkId) {
    const a = this._artworks.find(x => x.id === artworkId);
    if (!a) { this.toast('作品不存在', 'error'); return; }
    const artworkEl = $('#gal-artwork');
    const noEl = $('#gal-artwork-no');
    const artistEl = $('#gal-artist');
    const priceEl = $('#gal-price');
    const qtyEl = $('#gal-quantity');
    const hintEl = $('#gal-max-qty-hint');
    if (artworkEl) artworkEl.value = a.title || '';
    if (noEl) noEl.value = a.artworkNo || a.artwork_no || '';
    if (artistEl) artistEl.value = a.artist || '';
    const retail = Number(a.retailPrice ?? a.retail_price ?? 0);
    if (priceEl && retail > 0) priceEl.value = retail;
    const totalQty = Number(a.totalQty ?? a.total_qty ?? 1);
    const soldQty = Number(a.soldQty ?? a.sold_qty ?? 0);
    const avail = Math.max(1, totalQty - soldQty);
    if (qtyEl) qtyEl.value = 1;
    if (qtyEl) qtyEl.max = avail;
    if (hintEl) hintEl.textContent = `(库存 ${avail}/${totalQty})`;
    this._updateGalleryNet();
    document.querySelector('.modal-overlay')?.remove();
    this.toast(`已选择：${a.artworkNo ? '['+a.artworkNo+'] ' : ''}${a.title}`);
  },

  async renderGalleryPage() {
    const page = $('#page-gallery');
    if (!Auth.hasModuleAccess('gallery')) { this._noAccess(page); return; }
    const editing = this._editingGalleryId;
    await this._loadArtworks();

    html(page, `
      <div class="card">
        <div class="card-title">${editing ? '编辑画廊销售记录' : '新增画廊销售记录'}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>日期</label>
            <div style="display:flex;gap:6px"><input type="date" id="gal-date" value="${todayStr()}" style="flex:1">${this._todayBtn('gal-date')}</div>
          </div>
          <div class="form-group">
            <label>作品名称</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="gal-artwork" placeholder="请输入或从作品库选择" required style="flex:1">
              <button type="button" class="btn btn-secondary" onclick="UI._pickGalleryArtwork()" title="从产品库-画廊的作品档案中选择">📋 选作品</button>
            </div>
          </div>
          <div class="form-group"><label>作品编号</label><input type="text" id="gal-artwork-no" placeholder="选品后自动填充" readonly style="background:var(--cream);font-family:monospace"></div>
          <div class="form-group"><label>艺术家</label><input type="text" id="gal-artist" placeholder="艺术家姓名（选填）"></div>
          <div class="form-group"><label>成交数量 <span id="gal-max-qty-hint" style="font-size:11px;color:var(--gray-500);font-weight:normal"></span></label><input type="number" id="gal-quantity" min="1" step="1" value="1" required oninput="UI._updateGalleryNet()"></div>
          <div class="form-group"><label>成交单价（元）</label><input type="number" id="gal-price" min="0" step="0.01" placeholder="0.00" required oninput="UI._updateGalleryNet()"></div>
          <div class="form-group"><label>总金额 <span style="font-size:11px;color:var(--gray-500);font-weight:normal">(单价×数量)</span></label><div id="gal-amount" style="padding:8px;background:var(--cream);border-radius:var(--radius-sm);font-weight:bold;color:var(--gold)">¥0.00</div></div>
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
    const qty = +($('#gal-quantity')?.value || 1);
    const price = +($('#gal-price')?.value || 0);
    const comm = +($('#gal-commission')?.value || 0);
    const amount = qty * price;
    const net = amount - comm;
    const amountEl = $('#gal-amount');
    if (amountEl) amountEl.textContent = '¥' + Math.max(0, amount).toFixed(2);
    const netEl = $('#gal-net');
    if (netEl) netEl.textContent = '¥' + Math.max(0, net).toFixed(2);
  },

  _fillGalleryForm(r) {
    $('#gal-date').value = r.date;
    $('#gal-artwork').value = r.artworkName || '';
    $('#gal-artwork-no').value = r.artworkNo || r.artwork_no || '';
    $('#gal-artist').value = r.artist || '';
    $('#gal-quantity').value = r.saleQuantity || r.sale_quantity || 1;
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
      artworkNo: $('#gal-artwork-no')?.value.trim() || '',
      saleQuantity: Math.max(1, +($('#gal-quantity').value || 1)),
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

    let prevRecord = null;
    try {
      if (this._editingGalleryId) {
        prevRecord = await Store.getById('gallery', this._editingGalleryId);
        await Store.update('gallery', this._editingGalleryId, data);
        this.toast('画廊记录已更新');
        this._editingGalleryId = null;
      } else {
        await Store.add('gallery', createGallerySale(data));
        this.toast('画廊销售记录已保存');
      }
      // 联动艺术品库状态（按 artwork_no 优先，title+artist 兜底）
      await this._syncArtworkStatusBySale(data, prevRecord);
    } catch (e) {
      this.toast('保存失败：' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '保存记录'; }
      return;
    }

    await this.renderGalleryPage();
  },

  /** 根据销售记录联动更新作品库存 + 状态
   * 规则：
   *  - sold_qty 增加 saleQuantity（按 artwork_no 匹配，兜底用 title+artist）
   *  - sold_qty >= total_qty 时仅显示"售罄"tag（status 字段不被强制覆盖）
   *  - 删除销售时新增参数 soldQtyDelta 为负，逆向回滚
   */
  async _syncArtworkStatusBySale(saleData, prevSale, soldQtyDelta = null) {
    const name = String(saleData.artworkName || '').trim();
    const no = String(saleData.artworkNo || prevSale?.artworkNo || '').trim();
    if (!name && !no) return;
    await this._loadArtworks();
    const matched = this._artworks.find(a => {
      if (no) return String(a.artworkNo || a.artwork_no || '').trim() === no;
      return String(a.title || '').trim() === name &&
        (!saleData.artist || String(a.artist || '').trim() === String(saleData.artist || '').trim());
    });
    if (!matched) return;
    const totalQty = Number(matched.totalQty ?? matched.total_qty ?? 1);
    let curSoldQty = Number(matched.soldQty ?? matched.sold_qty ?? 0);
    let delta;
    if (soldQtyDelta !== null) {
      // 显式 delta（删除回滚路径）
      delta = soldQtyDelta;
    } else {
      // 计算本次增量：本次 quantity - 上次 quantity
      const curQty = +saleData.saleQuantity || 1;
      const prevQty = +(prevSale?.saleQuantity || prevSale?.sale_quantity || 1);
      const wasSold = prevSale?.status === '已售出';
      const isSoldNow = saleData.status === '已售出';
      if (wasSold && isSoldNow) delta = curQty - prevQty;
      else if (!wasSold && isSoldNow) delta = curQty;
      else if (wasSold && !isSoldNow) delta = -prevQty;
      else delta = 0;
    }
    const newSoldQty = Math.max(0, Math.min(totalQty, curSoldQty + delta));
    if (newSoldQty === curSoldQty) return;
    try {
      await Store.update('artworks', matched.id, {
        soldQty: newSoldQty,
        updatedAt: new Date().toISOString()
      });
      matched.soldQty = newSoldQty;
      const tag = newSoldQty >= totalQty ? '售罄' : '正常';
      this.toast(`已更新作品库存：${matched.artworkNo || matched.title}（${curSoldQty}→${newSoldQty}/${totalQty}，${tag}）`, 'info');
    } catch (e) {
      console.warn('[gallery] 同步作品库存失败：', e);
    }
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
    let deletedRecord = null;
    try { deletedRecord = await Store.getById('gallery', id); } catch {}
    await Store.delete('gallery', id);
    // 联动回滚库存
    if (deletedRecord?.status === '已售出') {
      const qty = +(deletedRecord.saleQuantity || deletedRecord.sale_quantity || 1);
      try {
        await this._syncArtworkStatusBySale(
          { artworkNo: deletedRecord.artworkNo, artworkName: deletedRecord.artworkName, artist: deletedRecord.artist },
          null,
          -qty
        );
      } catch (e) {
        console.warn('[gallery] 删除时回滚库存失败：', e);
      }
    }
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
    const page = $('#page-products');
    const tab = this._productTab;
    // 确保配置已从数据库加载
    await Store.loadAppConfig();
    await this._loadCreativeProducts();
    await this._loadArtworks();
    if (tab === 'gallery') await this._buildArtworkLastSoldMap();
    const counts = {
      ticket: (MODELS.ticketProducts || []).length,
      coffee: (MODELS.coffeeProducts || []).length,
      creative: this._creativeProducts.length,
      workshop: (MODELS.WORKSHOP_PRODUCTS || []).length,
      gallery: this._artworks.length
    };

    html(page, `
      <div class="sub-tabs" id="product-sub-tabs">
        <button class="sub-tab-btn ${tab==='ticket'?'active':''}" data-ptab="ticket">🎫 门票 <span class="badge">${counts.ticket}</span></button>
        <button class="sub-tab-btn ${tab==='coffee'?'active':''}" data-ptab="coffee">☕ 咖啡 <span class="badge">${counts.coffee}</span></button>
        <button class="sub-tab-btn ${tab==='creative'?'active':''}" data-ptab="creative">📦 文创/零售 <span class="badge">${counts.creative}</span></button>
        <button class="sub-tab-btn ${tab==='workshop'?'active':''}" data-ptab="workshop">🔧 工坊 <span class="badge">${counts.workshop}</span></button>
        <button class="sub-tab-btn ${tab==='gallery'?'active':''}" data-ptab="gallery">🖼️ 画廊 <span class="badge">${counts.gallery}</span></button>
      </div>
      <div id="product-tab-content">${this._renderProductTabContent(tab)}</div>
    `);

    // 绑定 tab 切换
    page.querySelectorAll('.sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        this._productTab = btn.getAttribute('data-ptab');
        // 切到画廊子 tab 时，确保销售聚合数据已加载（避免子 tab 切换不走 renderProductPage 的问题）
        if (this._productTab === 'gallery') {
          await this._buildArtworkLastSoldMap();
        }
        const content = page.querySelector('#product-tab-content');
        if (content) content.innerHTML = this._renderProductTabContent(this._productTab);
      });
    });
  },

  /** 二级 tab 内容渲染 */
  _renderProductTabContent(tab) {
    if (tab === 'ticket')      return this._renderSimpleConfigTab('ticket', '门票', ['名称', '单价'], ['name', 'price']);
    if (tab === 'coffee')      return this._renderSimpleConfigTab('coffee', '咖啡', ['名称', '单价'], ['name', 'price']);
    if (tab === 'workshop')    return this._renderSimpleConfigTab('workshop', '工坊', ['名称', '单价'], ['name', 'price']);
    if (tab === 'creative')    return this._renderCreativeTab();
    if (tab === 'gallery')     return this._renderArtworkTab();
    return '';
  },

  _setSalesPeriod(p) {
    this._artworkSalesPeriod = p;
    this._refreshCurrentProductTab();
  },

  /** 异步构建作品最近售出索引 { artworkNo -> 'YYYY-MM-DD' } + 销售额月/年聚合 */
  async _buildArtworkLastSoldMap() {
    const map = {};
    const ym = (new Date()).toISOString().slice(0, 7); // YYYY-MM
    const yy = (new Date()).toISOString().slice(0, 4); // YYYY
    const agg = { month: 0, year: 0, total: 0 };
    try {
      const all = await Store.getAll('gallery') || [];
      all.forEach(r => {
        // 仅"已售出"作为有效计入（已退款应反向，本期不处理）
        if (r.status !== '已售出') return;
        const qty = Number(r.saleQuantity || r.sale_quantity || 1);
        const price = Number(r.price || 0);
        const commission = Number(r.commission || 0);
        const amount = qty * price; // 销售总额 = 单价 × 数量
        const dateStr = r.date || '';
        // 索引到最近售出
        const key = r.artworkNo || r.artwork_no || (r.artworkName ? `name:${r.artworkName}` : '');
        if (key && dateStr) {
          if (!map[key] || dateStr > map[key]) map[key] = dateStr;
        }
        // 聚合（按现销售净额 = price × qty − commission）
        const net = Math.max(0, amount - commission);
        agg.total += net;
        if (dateStr.startsWith(ym)) agg.month += net;
        if (dateStr.startsWith(yy)) agg.year += net;
      });
    } catch (e) {
      console.warn('[gallery] 拉最近售出失败：', e);
    }
    this._artworkLastSoldMap = map;
    this._salesAgg = agg;
  },

  /** 门票/咖啡/工坊：简单配置表 + 查询框 + 内嵌表单 */
  _renderSimpleConfigTab(type, label, headers, fields) {
    const listKey = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS' }[type];
    const allItems = MODELS[listKey] || [];
    const keyword = (this._productSearch[type] || '').trim().toLowerCase();
    const items = keyword
      ? allItems.filter(it => String(it.name || '').toLowerCase().includes(keyword))
      : allItems;
    const escaped = (s) => String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    let rows = '';
    if (!items.length) {
      rows = `<tr><td colspan="${headers.length + 1}" style="text-align:center;color:var(--gray-500);padding:16px">${keyword ? '没有匹配项' : '暂无' + label + '产品'}</td></tr>`;
    } else {
      items.forEach((item) => {
        const realIdx = allItems.indexOf(item);
        const tds = fields.map(f => {
          const v = item[f];
          if (f === 'price') return `<td>¥${this._fmt(v)}</td>`;
          return `<td>${escaped(v)}</td>`;
        }).join('');
        rows += `<tr>${tds}<td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editConfigItem('${type}', ${realIdx})">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteConfigItem('${type}', ${realIdx})">删除</button>
        </td></tr>`;
      });
    }
    return `
      <div class="card">
        <div class="card-title">🎫 ${label}管理</div>
        <div class="filter-bar">
          <div class="form-group" style="min-width:220px">
            <label>查询</label>
            <input type="text" id="prod-search-${type}" placeholder="按名称搜索 ${label}..." value="${escaped(this._productSearch[type] || '')}" oninput="UI._onProductSearch('${type}', this.value)">
          </div>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto">共 ${allItems.length} 项${keyword ? ` · 匹配 ${items.length}` : ''}</span>
          <button type="button" class="btn btn-sm btn-primary" onclick="UI._addConfigItem('${type}')">+ 新增${label}</button>
        </div>
        <div class="table-wrap"><table class="data-table"><thead><tr>
          ${headers.map(h => `<th>${h}</th>`).join('')}
          <th style="width:140px">操作</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    `;
  },

  _onProductSearch(type, value) {
    this._productSearch[type] = value;
    const content = document.getElementById('product-tab-content');
    if (content) content.innerHTML = this._renderProductTabContent(this._productTab);
    // 保留焦点和光标位置
    const inp = document.getElementById('prod-search-' + type);
    if (inp) {
      inp.focus();
      const len = value.length;
      inp.setSelectionRange(len, len);
    }
  },

  /** 文创产品 tab：查询框 + 供应商筛选 + 分页（重构版） */
  _renderCreativeTab() {
    const keyword = (this._productSearch.creative || '').trim().toLowerCase();
    let list = this._creativeProducts;
    if (this._cpFilterSupplier) list = list.filter(p => p.supplier === this._cpFilterSupplier);
    if (keyword) list = list.filter(p =>
      String(p.name || '').toLowerCase().includes(keyword) ||
      String(p.sku || '').toLowerCase().includes(keyword) ||
      String(p.supplier || '').toLowerCase().includes(keyword) ||
      String(p.notes || '').toLowerCase().includes(keyword)
    );
    const suppliers = this._cpSuppliers();
    const totalPages = Math.max(1, Math.ceil(list.length / this._CP_PAGE_SIZE));
    if (this._cpPage >= totalPages) this._cpPage = totalPages - 1;
    const start = this._cpPage * this._CP_PAGE_SIZE;
    const pageItems = list.slice(start, start + this._CP_PAGE_SIZE);

    const toolbar = `<div class="filter-bar" style="flex-wrap:wrap;gap:8px">
      <div class="form-group" style="min-width:220px;margin-bottom:0">
        <label>查询</label>
        <input type="text" id="prod-search-creative" placeholder="按名称/SKU/供应商/备注搜索..." value="${this._escHtml(this._productSearch.creative || '')}" oninput="UI._onProductSearch('creative', this.value)">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>供应商</label>
        <select id="cp-supplier-filter" onchange="UI._cpOnFilterChange()" style="padding:4px 8px;font-size:13px">
          <option value="">全部供应商</option>
          ${suppliers.map(s => `<option value="${this._escHtml(s)}"${this._cpFilterSupplier === s ? ' selected' : ''}>${this._escHtml(s)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="UI._addCreativeProduct()">+ 新增产品</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._importCreativeProducts()">📥 导入库存</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._downloadImportTemplate()">📋 下载模板</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeProducts()">📤 导出产品</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeSales()">📄 销售清单</button>
      <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="cp-count">${list.length} 个${keyword||this._cpFilterSupplier ? ' (筛选后)' : ''} · 共 ${this._creativeProducts.length} 个</span>
    </div>`;

    let table = '<div class="table-wrap"><table class="data-table"><thead><tr><th>名称</th><th>SKU</th><th>供应商</th><th>进货价</th><th>零售价</th><th>库存</th><th>单位</th><th>备注</th><th style="width:90px">操作</th></tr></thead><tbody>';
    if (!pageItems.length) {
      table += `<tr><td colspan="9" style="text-align:center;color:var(--gray-500);padding:16px">${keyword ? '没有匹配项' : '暂无文创产品，请新增或导入'}</td></tr>`;
    } else {
      pageItems.forEach(p => {
        table += `<tr>
          <td>${this._escHtml(p.name || '-')}</td>
          <td>${this._escHtml(p.sku || '-')}</td>
          <td>${this._escHtml(p.supplier || '-')}</td>
          <td>¥${this._fmt(p.costPrice)}</td>
          <td><strong>¥${this._fmt(p.retailPrice)}</strong></td>
          <td><span class="tag ${(p.stock || 0) <= 0 ? 'tag-danger' : 'tag-success'}">${p.stock || 0}</span></td>
          <td>${this._escHtml(p.unit || '个')}</td>
          <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${this._escHtml(p.notes || '-')}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-secondary" onclick="UI._editCreativeProduct('${p.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="UI._deleteCreativeProduct('${p.id}')">删除</button>
          </td>
        </tr>`;
      });
    }
    table += '</tbody></table></div>';

    let pagination = '';
    if (totalPages > 1) {
      pagination = `<div class="filter-bar" style="margin-top:8px;justify-content:flex-end">
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(0)" ${this._cpPage === 0 ? 'disabled' : ''}>首页</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage - 1})" ${this._cpPage === 0 ? 'disabled' : ''}>‹ 上一页</button>
        <span style="font-size:13px;color:var(--gray-700);padding:6px 12px">第 ${this._cpPage + 1}/${totalPages} 页</span>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${this._cpPage + 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>下一页 ›</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="UI._cpGoToPage(${totalPages - 1})" ${this._cpPage >= totalPages - 1 ? 'disabled' : ''}>末页</button>
      </div>`;
    }

    return `<div class="card">${toolbar}${table}${pagination}</div>`;
  },

  // ===== 作品档案 (artworks) =====
  async _loadArtworks() {
    try {
      this._artworks = await Store.getAll('artworks') || [];
    } catch (e) {
      this._artworks = [];
    }
    return this._artworks;
  },

  /** 画廊作品档案 tab：库存看板 + 查询 + chip 过滤 + 列表 + 行展开 + 增删改 */
  _renderArtworkTab() {
    const all = this._artworks || [];
    const qtyOf = (a) => {
      const t = Number(a.totalQty ?? a.total_qty ?? 1);
      const s = Number(a.soldQty ?? a.sold_qty ?? 0);
      return { total: t, sold: s, avail: Math.max(0, t - s), soldOut: t > 0 && s >= t };
    };
    // 全局统计（基于过滤前的全集，不被 search 影响）
    const totalAvail = all.reduce((s, a) => s + qtyOf(a).avail, 0);
    const totalSold = all.reduce((s, a) => s + qtyOf(a).sold, 0);
    const exhibitCount = all.filter(a => a.status === '在展').length;
    const totalValue = all.reduce((s, a) => s + qtyOf(a).avail * Number(a.retailPrice ?? a.retail_price ?? 0), 0);

    // 销售额：按 月/年 toggle，从 _artworkLastSoldMap 旁的 salesStatsByPeriod 取（没有则用元数据）
    const salesAgg = this._salesAgg || { month: 0, year: 0, total: 0 };
    const period = this._artworkSalesPeriod || 'month';
    const salesAmount = period === 'year' ? salesAgg.year : salesAgg.month;
    const salesRangeLabel = period === 'year' ? '本年累计' : '本月销售';

    // 关键字搜索
    const keyword = (this._productSearch.gallery || '').trim().toLowerCase();
    let list = all;
    if (keyword) {
      list = list.filter(a =>
        String(a.title || '').toLowerCase().includes(keyword) ||
        String(a.artist || '').toLowerCase().includes(keyword) ||
        String(a.medium || '').toLowerCase().includes(keyword) ||
        String(a.location || '').toLowerCase().includes(keyword) ||
        String(a.notes || '').toLowerCase().includes(keyword) ||
        String(a.artworkNo || a.artwork_no || '').toLowerCase().includes(keyword)
      );
    }
    // 子过滤 chip
    const chip = this._artworkFilterChip || 'all';
    const filterByChip = (arr) => {
      if (chip === 'all') return arr;
      return arr.filter(a => {
        const { avail, total } = qtyOf(a);
        const st = a.status || '在库';
        if (chip === 'instock') return st === '在库';
        if (chip === 'exhibiting') return st === '在展';
        if (chip === 'soldout') return avail <= 0;
        if (chip === 'lowstock') return avail > 0 && avail <= Math.max(1, Math.ceil(total * 0.3));
        return true;
      });
    };
    list = filterByChip(list);

    // 顶部库存看板（5 张卡）
    const statsHtml = `<div class="stats-grid artwork-stats">
      <div class="stat-card">
        <div class="stat-label">总库存</div>
        <div class="stat-value">${totalAvail}</div>
        <div class="stat-sub">${all.length} 件作品 / 共 ${totalAvail + totalSold} 件</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">在展数</div>
        <div class="stat-value" style="color:var(--gold)">${exhibitCount}</div>
        <div class="stat-sub">当前展览中的作品</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已售数</div>
        <div class="stat-value" style="color:var(--gray-700)">${totalSold}</div>
        <div class="stat-sub">累计售出件数</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">销售额</div>
        <div class="stat-value" style="color:var(--green-700)">¥${this._fmt(salesAmount)}</div>
        <div class="stat-sub">
          <button type="button" class="stat-period-toggle ${period==='month'?'active':''}" onclick="UI._setSalesPeriod('month')">月</button>
          <button type="button" class="stat-period-toggle ${period==='year'?'active':''}" onclick="UI._setSalesPeriod('year')">年</button>
          <span style="font-size:11px;color:var(--gray-500);margin-left:4px">${salesRangeLabel}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">库存估值</div>
        <div class="stat-value" style="color:var(--green-700)">¥${this._fmt(totalValue)}</div>
        <div class="stat-sub">可售 × 零售价</div>
      </div>
    </div>`;

    // Chip 行
    const chipsHtml = `<div class="qty-chips">
      ${[
        { k: 'all',        label: '全部', count: all.length },
        { k: 'instock',    label: '在库', count: all.filter(a => (a.status || '在库') === '在库').length },
        { k: 'exhibiting', label: '在展', count: all.filter(a => a.status === '在展').length },
        { k: 'soldout',    label: '售罄', count: all.filter(a => qtyOf(a).avail <= 0).length },
        { k: 'lowstock',   label: '低库存', count: all.filter(a => { const q = qtyOf(a); return q.avail > 0 && q.avail <= Math.max(1, Math.ceil(q.total * 0.3)); }).length }
      ].map(c => `<button type="button" class="qty-chip ${chip === c.k ? 'active' : ''}" onclick="UI._setArtworkChip('${c.k}')">${c.label} <span class="qty-chip-count">${c.count}</span></button>`).join('')}
    </div>`;

    const toolbar = `<div class="filter-bar" style="flex-wrap:wrap;gap:8px">
      <div class="form-group" style="min-width:240px;margin-bottom:0">
        <label>查询</label>
        <input type="text" id="prod-search-gallery" placeholder="按编号/标题/艺术家/材质/位置/备注搜索..." value="${this._escHtml(this._productSearch.gallery || '')}" oninput="UI._onProductSearch('gallery', this.value)">
      </div>
      <span style="font-size:12px;color:var(--gray-500);margin-left:auto">${list.length} 件${keyword || chip !== 'all' ? ' (筛选后)' : ''} · 共 ${all.length} 件</span>
      <button type="button" class="btn btn-sm btn-primary" onclick="UI._addArtwork()">+ 新增作品</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._importArtworks()">📥 批量导入</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._downloadArtworkTemplate()">📋 下载模板</button>
    </div>`;

    // 最近售出聚合
    const lastSoldMap = this._artworkLastSoldMap || {};

    let table = '<div class="table-wrap"><table class="data-table"><thead><tr><th style="width:80px">编号</th><th style="width:64px">缩略图</th><th>标题</th><th>艺术家</th><th style="width:90px">库存</th><th style="width:100px">零售价</th><th style="width:110px">最近售出</th><th>状态</th><th>位置</th><th style="width:90px">操作</th></tr></thead><tbody>';
    if (!list.length) {
      table += `<tr><td colspan="10" style="text-align:center;color:var(--gray-500);padding:16px">${keyword || chip !== 'all' ? '没有匹配项' : '暂无作品档案，请新增或导入'}</td></tr>`;
    } else {
      list.forEach(a => {
        const statusClass = a.status === '在库' ? 'tag-success' : a.status === '在展' ? 'tag-info' : a.status === '已售' ? 'tag-danger' : a.status === '借出' ? 'tag-warning' : 'tag-default';
        const imgUrl = this._resolveImageUrl(a.imageUrl || a.image_url || '');
        const thumbCell = imgUrl
          ? `<img src="${this._escHtml(imgUrl)}" class="aw-thumb" onerror="this.outerHTML='<div class=&quot;aw-thumb aw-thumb--placeholder&quot;>无图</div>'">`
          : `<div class="aw-thumb aw-thumb--placeholder">无图</div>`;
        const { total, sold, avail, soldOut } = qtyOf(a);
        const isLowStock = !soldOut && avail > 0 && avail <= Math.max(1, Math.ceil(total * 0.3));
        const qtyCell = soldOut
          ? `<span style="color:var(--red);font-weight:bold">售罄 0</span><span style="font-size:11px;color:var(--gray-500);margin-left:4px">/ ${total}</span>`
          : `<strong style="color:${isLowStock ? 'var(--gold)' : 'var(--green-700)'}">${avail}</strong> / ${total}${isLowStock ? '<br><span style="font-size:10px;color:var(--gold)">⚡ 低库存</span>' : ''}`;
        const no = this._escHtml(a.artworkNo || a.artwork_no || '-');
        const lastSold = lastSoldMap[a.artworkNo || a.artwork_no] || lastSoldMap[a.title];
        const lastSoldCell = lastSold
          ? `<span style="color:var(--gray-700)">${lastSold}</span>`
          : `<span style="color:var(--gray-400)">—</span>`;
        table += `<tr data-artwork-id="${this._escHtml(a.id)}" onclick="UI._toggleArtworkDetail(this)" style="cursor:pointer">
          <td onclick="event.stopPropagation()"><span style="font-family:monospace;background:var(--cream);padding:2px 6px;border-radius:4px;font-size:12px">${no}</span></td>
          <td>${thumbCell}</td>
          <td onclick="event.stopPropagation()"><strong>${this._escHtml(a.title || '-')}</strong></td>
          <td>${this._escHtml(a.artist || '-')}</td>
          <td>${qtyCell}</td>
          <td>¥${this._fmt(a.retailPrice ?? a.retail_price)}</td>
          <td style="font-size:12px">${lastSoldCell}</td>
          <td><span class="tag ${statusClass}">${this._escHtml(a.status || '在库')}</span></td>
          <td style="max-width:120px">${this._escHtml(a.location || '-')}</td>
          <td class="row-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-secondary" onclick="UI._editArtwork('${a.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="UI._deleteArtwork('${a.id}')">删除</button>
          </td>
        </tr>
        <tr class="artwork-detail-row" id="aw-detail-${this._escHtml(a.id)}" style="display:none;background:var(--cream)">
          <td colspan="10" style="padding:12px 16px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 24px;font-size:13px">
              <div><span style="color:var(--gray-500)">结算价：</span><strong>¥${this._fmt(a.settlementPrice ?? a.settlement_price)}</strong></div>
              <div><span style="color:var(--gray-500)">年份：</span>${this._escHtml(a.year || '-')}</div>
              <div><span style="color:var(--gray-500)">材质：</span>${this._escHtml(a.medium || '-')}</div>
              <div><span style="color:var(--gray-500)">尺寸：</span>${this._escHtml(a.dimensions || '-')}</div>
              <div><span style="color:var(--gray-500)">已售：</span>${sold} / ${total}</div>
              <div><span style="color:var(--gray-500)">更新时间：</span>${a.updatedAt ? new Date(a.updatedAt).toLocaleDateString('zh-CN') : '-'}</div>
            </div>
            ${a.notes ? `<div style="margin-top:8px;font-size:13px;color:var(--gray-700)"><span style="color:var(--gray-500)">备注：</span>${this._escHtml(a.notes)}</div>` : ''}
          </td>
        </tr>`;
      });
    }
    table += '</tbody></table></div>';

    return `<div class="card">${statsHtml}${toolbar}${chipsHtml}${table}</div>`;
  },

  _setArtworkChip(k) {
    this._artworkFilterChip = k;
    this._refreshCurrentProductTab();
  },

  _toggleArtworkDetail(rowEl) {
    const id = rowEl.getAttribute('data-artwork-id');
    if (!id) return;
    const detailRow = document.getElementById('aw-detail-' + id);
    if (detailRow) {
      const visible = detailRow.style.display !== 'none';
      detailRow.style.display = visible ? 'none' : 'table-row';
      // 给主行加视觉指示
      rowEl.style.background = visible ? '' : 'var(--cream)';
    }
  },

  _showArtworkModal(data, isEdit) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const d = data || {};
    const ARTWORK_STATUSES = ['在库', '在展', '已售', '借出', '下架'];
    const initialNo = d.artworkNo || d.artwork_no || (isEdit ? '' : this._nextArtworkNo());
    const initialImg = this._resolveImageUrl(d.imageUrl || d.image_url || '');
    overlay.innerHTML = `
      <div class="modal-card" style="min-width:520px">
        <div class="modal-title">${isEdit ? '编辑作品' : '新增作品'}</div>
        <div class="form-grid">
          <div class="form-group"><label>作品编号</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="aw-no" value="${this._escHtml(initialNo)}" placeholder="A0001" style="flex:1;font-family:monospace">
              ${isEdit ? '' : '<button type="button" class="btn btn-sm btn-secondary" onclick="UI._regenArtworkNo()">⟳ 重生成</button>'}
            </div>
          </div>
          <div class="form-group"><label>标题 *</label><input type="text" id="aw-title" value="${this._escHtml(d.title || '')}" placeholder="作品标题"></div>
          <div class="form-group"><label>艺术家</label><input type="text" id="aw-artist" value="${this._escHtml(d.artist || '')}" placeholder="选填"></div>
          <div class="form-group"><label>年份</label><input type="text" id="aw-year" value="${this._escHtml(d.year || '')}" placeholder="如 2024"></div>
          <div class="form-group"><label>材质</label><input type="text" id="aw-medium" value="${this._escHtml(d.medium || '')}" placeholder="如 油画/水墨"></div>
          <div class="form-group"><label>尺寸</label><input type="text" id="aw-dimensions" value="${this._escHtml(d.dimensions || '')}" placeholder="如 60×80cm"></div>
          <div class="form-group"><label>存放位置</label><input type="text" id="aw-location" value="${this._escHtml(d.location || '')}" placeholder="如 1号展厅"></div>
          <div class="form-group"><label>总件数 <span style="font-size:11px;color:var(--gray-500)">(原画=1,复制品=N)</span></label><input type="number" id="aw-total-qty" value="${d.totalQty ?? d.total_qty ?? 1}" min="1" step="1" oninput="UI._updateQtyPreview()"></div>
          <div class="form-group"><label>已售件数</label><input type="number" id="aw-sold-qty" value="${d.soldQty ?? d.sold_qty ?? 0}" min="0" step="1" oninput="UI._updateQtyPreview()"></div>
          <div class="form-group"><label>可用库存</label><div id="aw-available-qty" style="padding:8px;background:var(--cream);border-radius:var(--radius-sm);min-height:36px;display:flex;align-items:center"></div></div>
          <div class="form-group"><label>结算价</label><input type="number" id="aw-settlement-price" value="${this._escHtml(d.settlementPrice ?? d.settlement_price ?? '')}" placeholder="如 0" min="0" step="0.01"></div>
          <div class="form-group"><label>零售价</label><input type="number" id="aw-retail-price" value="${this._escHtml(d.retailPrice ?? d.retail_price ?? '')}" placeholder="如 0" min="0" step="0.01"></div>
          <div class="form-group"><label>状态</label>
            <select id="aw-status">
              ${ARTWORK_STATUSES.map(s => `<option value="${s}"${(d.status||'在库') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group full">
            <label>作品照片</label>
            <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
              <div id="aw-image-preview" style="width:120px;height:120px;border:1px dashed var(--gray-300);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;background:var(--cream);overflow:hidden;flex-shrink:0">
                ${initialImg ? `<img src="${this._escHtml(initialImg)}" style="max-width:100%;max-height:100%;object-fit:cover">` : '<span style="font-size:11px;color:var(--gray-500)">无图</span>'}
              </div>
              <div style="flex:1;min-width:200px">
                <input type="file" id="aw-image-file" accept="image/*" style="margin-bottom:6px">
                <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">或直接粘贴 / 输入图片URL</div>
                <input type="text" id="aw-image-url" value="${this._escHtml(d.imageUrl || d.image_url || '')}" placeholder="/uploads/artworks/xxx.jpg 或 https://...">
                <input type="hidden" id="aw-image-stored" value="${this._escHtml(d.imageUrl || d.image_url || '')}">
                <div id="aw-upload-status" style="font-size:11px;color:var(--gray-500);margin-top:4px"></div>
                ${(d.imageUrl || d.image_url) ? '<button type="button" class="btn btn-sm btn-secondary" id="aw-image-clear" style="margin-top:6px">移除图片</button>' : ''}
              </div>
            </div>
          </div>
          <div class="form-group full"><label>备注</label><textarea id="aw-notes" rows="2">${this._escHtml(d.notes || '')}</textarea></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" id="aw-save-btn">${isEdit ? '保存修改' : '创建作品'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // 初始化可用库存预览
    this._updateQtyPreview();

    // 图片 URL 输入变化 → 实时预览
    const urlInput = overlay.querySelector('#aw-image-url');
    const preview = overlay.querySelector('#aw-image-preview');
    const storedInput = overlay.querySelector('#aw-image-stored');
    const renderPreview = (url) => {
      const full = this._resolveImageUrl(url);
      if (full) {
        preview.innerHTML = `<img src="${this._escHtml(full)}" style="max-width:100%;max-height:100%;object-fit:cover" onerror="this.parentNode.innerHTML='<span style=&quot;font-size:11px;color:var(--red)&quot;>加载失败</span>'">`;
      } else {
        preview.innerHTML = '<span style="font-size:11px;color:var(--gray-500)">无图</span>';
      }
    };
    urlInput.addEventListener('input', () => {
      storedInput.value = urlInput.value.trim();
      renderPreview(urlInput.value.trim());
    });

    // 文件选择 → 上传到服务器
    overlay.querySelector('#aw-image-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = overlay.querySelector('#aw-upload-status');
      statusEl.style.color = 'var(--gray-500)';
      statusEl.textContent = '上传中...';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch((SUPABASE_CONFIG.url || '') + '/rest/v1/artworks/upload', {
          method: 'POST',
          body: fd
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || body.message || '上传失败');
        urlInput.value = body.url;
        storedInput.value = body.url;
        renderPreview(body.url);
        statusEl.style.color = 'var(--green-700)';
        statusEl.textContent = `✅ 上传成功（${Math.round(body.size/1024)} KB）`;
      } catch (err) {
        statusEl.style.color = 'var(--red)';
        statusEl.textContent = '❌ ' + (err.message || err);
      }
    });

    // 移除图片
    const clearBtn = overlay.querySelector('#aw-image-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        storedInput.value = '';
        renderPreview('');
        const fu = overlay.querySelector('#aw-image-file');
        if (fu) fu.value = '';
        const st = overlay.querySelector('#aw-upload-status');
        if (st) st.textContent = '';
      });
    }

    overlay.querySelector('#aw-save-btn').addEventListener('click', async () => {
      const title = overlay.querySelector('#aw-title').value.trim();
      if (!title) { UI.toast('请输入作品标题', 'error'); return; }
      const record = {
        title,
        artworkNo: overlay.querySelector('#aw-no').value.trim(),
        artist: overlay.querySelector('#aw-artist').value.trim(),
        year: overlay.querySelector('#aw-year').value.trim(),
        medium: overlay.querySelector('#aw-medium').value.trim(),
        dimensions: overlay.querySelector('#aw-dimensions').value.trim(),
        location: overlay.querySelector('#aw-location').value.trim(),
        totalQty: Math.max(1, Number(overlay.querySelector('#aw-total-qty').value) || 1),
        soldQty: Math.max(0, Number(overlay.querySelector('#aw-sold-qty').value) || 0),
        settlementPrice: Number(overlay.querySelector('#aw-settlement-price').value) || 0,
        retailPrice: Number(overlay.querySelector('#aw-retail-price').value) || 0,
        status: overlay.querySelector('#aw-status').value,
        imageUrl: overlay.querySelector('#aw-image-stored').value.trim(),
        notes: overlay.querySelector('#aw-notes').value.trim(),
        updatedAt: new Date().toISOString()
      };
      try {
        if (isEdit && d.id) {
          await Store.update('artworks', d.id, record);
          UI.toast('作品已更新');
        } else {
          await Store.add('artworks', createArtwork(record));
          UI.toast('作品已新增');
        }
        overlay.remove();
        await UI._loadArtworks();
        UI._refreshCurrentProductTab();
      } catch (e) {
        UI.toast('保存失败：' + (e.message || e), 'error');
      }
    });
  },

  /** 生成下一个作品编号：A#### 格式，从当前最大值 + 1 起 */
  _nextArtworkNo() {
    const list = this._artworks || [];
    let maxN = 0;
    for (const a of list) {
      const m = String(a.artworkNo || a.artwork_no || '').match(/^A(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    return 'A' + String(maxN + 1).padStart(4, '0');
  },

  _regenArtworkNo() {
    const input = document.querySelector('#aw-no');
    if (input) {
      input.value = this._nextArtworkNo();
      this.toast('已生成新编号');
    }
  },

  /** modal 内：根据 total/sold 实时显示可用库存 + 售罄标记 */
  _updateQtyPreview() {
    const totalEl = document.querySelector('#aw-total-qty');
    const soldEl = document.querySelector('#aw-sold-qty');
    const availEl = document.querySelector('#aw-available-qty');
    if (!totalEl || !soldEl || !availEl) return;
    const total = Math.max(0, Number(totalEl.value) || 0);
    const sold = Math.max(0, Number(soldEl.value) || 0);
    const avail = Math.max(0, total - sold);
    const soldOut = total > 0 && sold >= total;
    availEl.innerHTML = soldOut
      ? `<strong style="color:var(--red)">售罄（0/${total}）</strong>`
      : `<strong style="color:var(--green-700)">${avail}</strong> / ${total} 件`;
  },

  /** 把 image_url 字段转成可在 <img src> 用的完整 URL */
  _resolveImageUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) return (SUPABASE_CONFIG.url || '') + url;
    return url;
  },

  async _addArtwork() {
    this._showArtworkModal(null, false);
  },

  async _editArtwork(id) {
    const a = this._artworks.find(x => x.id === id);
    if (!a) { this.toast('作品不存在', 'error'); return; }
    this._showArtworkModal(a, true);
  },

  async _deleteArtwork(id) {
    const a = this._artworks.find(x => x.id === id);
    if (!confirm(`确认删除作品「${a ? a.title : id}」？`)) return;
    await Store.delete('artworks', id);
    this.toast('已删除');
    await this._loadArtworks();
    this._refreshCurrentProductTab();
  },

  // === 旧 _renderEditableList 已废弃（被 _renderSimpleConfigTab 取代） ===

  _showSimpleConfigModal(type, label, item, isEdit) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const d = item || {};
    overlay.innerHTML = `
      <div class="modal-card" style="min-width:420px">
        <div class="modal-title">${isEdit ? '编辑' + label : '新增' + label}</div>
        <div class="form-grid">
          <div class="form-group full"><label>名称 *</label><input type="text" id="cfg-name" value="${this._escHtml(d.name || '')}" placeholder="如 普通票 / 手冲咖啡 / 果壳风铃" autofocus></div>
          <div class="form-group full"><label>单价（元）*</label><input type="number" id="cfg-price" min="0" step="0.01" value="${d.price || ''}" placeholder="0.00"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" id="cfg-save-btn">${isEdit ? '保存修改' : '创建'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#cfg-save-btn').addEventListener('click', async () => {
      const name = overlay.querySelector('#cfg-name').value.trim();
      const price = parseFloat(overlay.querySelector('#cfg-price').value);
      if (!name) { UI.toast('请输入名称', 'error'); return; }
      if (isNaN(price) || price < 0) { UI.toast('请输入有效单价', 'error'); return; }
      const newItem = { name, price };
      const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS' };
      const dbKeyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products' };
      const listKey = listKeyMap[type];
      const dbKey = dbKeyMap[type];
      MODELS[listKey] = MODELS[listKey] || [];
      if (isEdit) {
        const idx = MODELS[listKey].indexOf(item);
        if (idx >= 0) MODELS[listKey][idx] = newItem;
      } else {
        MODELS[listKey].push(newItem);
      }
      // 同步旧常量（票务/咖啡）
      if (type === 'ticket') {
        MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10;
        MODELS.COMBO_PRICE = MODELS.ticketProducts.length > 1 ? MODELS.ticketProducts[1].price : 25;
      }
      if (type === 'coffee') MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15;
      await Store.saveConfig(dbKey, MODELS[listKey]);
      UI.toast(isEdit ? '已更新' : '已新增');
      overlay.remove();
      UI._refreshCurrentProductTab();
    });
  },

  async _addConfigItem(type) {
    const label = { ticket: '门票', coffee: '咖啡', workshop: '工坊产品' }[type];
    this._showSimpleConfigModal(type, label, null, false);
  },

  async _editConfigItem(type, idx) {
    const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS' };
    const listKey = listKeyMap[type];
    const item = (MODELS[listKey] || [])[idx];
    if (!item) { this.toast('产品不存在', 'error'); return; }
    const label = { ticket: '门票', coffee: '咖啡', workshop: '工坊产品' }[type];
    this._showSimpleConfigModal(type, label, item, true);
  },

  async _deleteConfigItem(type, idx) {
    const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS' };
    const dbKeyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products' };
    const listKey = listKeyMap[type];
    const dbKey = dbKeyMap[type];
    const items = MODELS[listKey] || [];
    const item = items[idx];
    if (!item) return;
    if (!confirm(`确认删除「${item.name}」？`)) return;
    items.splice(idx, 1);
    if (type === 'ticket') {
      MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10;
      MODELS.COMBO_PRICE = MODELS.ticketProducts.length > 1 ? MODELS.ticketProducts[1].price : 25;
    }
    if (type === 'coffee') MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15;
    await Store.saveConfig(dbKey, items);
    this.toast('已删除');
    this._refreshCurrentProductTab();
  },

  /** 刷新当前二级 tab（不重建整个页面，保留搜索框焦点/光标位置） */
  _refreshCurrentProductTab() {
    const content = document.getElementById('product-tab-content');
    if (!content) return;
    content.innerHTML = this._renderProductTabContent(this._productTab);
    // 更新 tab 上的数量徽章
    const tabEl = document.querySelector(`.sub-tab-btn[data-ptab="${this._productTab}"] .badge`);
    if (tabEl) {
      const counts = {
        ticket: (MODELS.ticketProducts || []).length,
        coffee: (MODELS.coffeeProducts || []).length,
        creative: this._creativeProducts.length,
        workshop: (MODELS.WORKSHOP_PRODUCTS || []).length,
        gallery: this._artworks.length
      };
      tabEl.textContent = counts[this._productTab];
    }
  },

  // ===== 文创产品管理 =====
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
    this._refreshCurrentProductTab();
  },

  _cpGoToPage(page) {
    const filtered = this._cpFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / this._CP_PAGE_SIZE));
    if (page < 0 || page >= totalPages) return;
    this._cpPage = page;
    this._refreshCurrentProductTab();
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
        await UI._refreshCurrentProductTab();
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
    await this._refreshCurrentProductTab();
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
        await this._refreshCurrentProductTab();
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
    // 字段名兼容：服务端 toCamel 不递归 JSONB 数组，所以读出来时是 snake（product_name/unit_price）；
    // 少数旧数据可能保留录入时的 camel（productName/unitPrice）。两种都要支持。
    const itemName = i => i.productName ?? i.product_name ?? '';
    const itemPrice = i => i.unitPrice ?? i.unit_price ?? 0;
    records.forEach(r => {
      const items = Array.isArray(r.retailItems) ? r.retailItems : [];
      items.forEach(item => {
        rows.push([
          r.date,
          itemName(item),
          item.qty || 1,
          (+itemPrice(item)).toFixed(2),
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

  // === 作品档案导入（CSV / XLSX） ===
  async _importArtworks() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const rows = await this._parseArtworkImportFile(file);
        if (!rows.length) { this.toast('未解析到有效数据', 'error'); return; }
        let imported = 0, skipped = 0;
        for (const row of rows) {
          try {
            await Store.add('artworks', createArtwork(row));
            imported++;
          } catch (err) {
            console.warn('导入失败:', row, err);
            skipped++;
          }
        }
        this.toast(`导入完成：成功 ${imported} 件${skipped ? `，失败 ${skipped} 件` : ''}`);
        await this._loadArtworks();
        this._refreshCurrentProductTab();
      } catch (err) {
        this.toast('导入失败：' + (err.message || err), 'error');
      }
    };
    input.click();
  },

  _parseArtworkImportFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const AW_FIELDS = {
            title: ['标题','title','Title','作品','作品名','作品名称'],
            artist: ['艺术家','artist','Artist','作者'],
            year: ['年份','year','Year','创作年份'],
            medium: ['材质','medium','Medium','媒介','材料'],
            dimensions: ['尺寸','dimensions','Dimensions','规格'],
            location: ['位置','location','Location','存放位置','存放'],
            status: ['状态','status','Status'],
            imageUrl: ['图片URL','图片','图片地址','image','image_url','imageUrl','照片'],
            settlementPrice: ['结算价','settlement_price','settlementPrice','结算价格'],
            retailPrice: ['零售价','retail_price','retailPrice','零售价格'],
            notes: ['备注','notes','Notes','说明'],
            artworkNo: ['作品编号','编号','artwork_no','artworkNo','NO','no'],
            totalQty: ['总件数','total_qty','totalQty','数量','qty'],
            soldQty: ['已售件数','sold_qty','soldQty']
          };
          const mapRow = (r) => {
            const get = (cands) => {
              for (const k of cands) {
                if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
              }
              return '';
            };
            const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
            const totalQtyRaw = num(get(AW_FIELDS.totalQty));
            return {
              title: String(get(AW_FIELDS.title) || '').trim(),
              artworkNo: String(get(AW_FIELDS.artworkNo) || '').trim(),
              artist: String(get(AW_FIELDS.artist) || '').trim(),
              year: String(get(AW_FIELDS.year) || '').trim(),
              medium: String(get(AW_FIELDS.medium) || '').trim(),
              dimensions: String(get(AW_FIELDS.dimensions) || '').trim(),
              location: String(get(AW_FIELDS.location) || '').trim(),
              status: String(get(AW_FIELDS.status) || '在库').trim(),
              imageUrl: String(get(AW_FIELDS.imageUrl) || '').trim(),
              settlementPrice: num(get(AW_FIELDS.settlementPrice)),
              retailPrice: num(get(AW_FIELDS.retailPrice)),
              totalQty: totalQtyRaw || 1,
              soldQty: num(get(AW_FIELDS.soldQty)),
              notes: String(get(AW_FIELDS.notes) || '').trim()
            };
          };
          if (file.name.endsWith('.xlsx')) {
            if (typeof XLSX === 'undefined') { reject(new Error('缺少 xlsx 库')); return; }
            const wb = XLSX.read(content, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            resolve(rows.map(mapRow).filter(r => r.title));
          } else {
            const lines = content.replace(/^﻿/, '').split('\n').filter(l => l.trim());
            if (lines.length < 2) { reject(new Error('CSV 为空或只有表头')); return; }
            const headers = this._parseCSVLine(lines[0]);
            const results = [];
            for (let i = 1; i < lines.length; i++) {
              const vals = this._parseCSVLine(lines[i]);
              if (vals.length < 2) continue;
              const row = {};
              headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
              const mapped = mapRow(row);
              if (mapped.title) results.push(mapped);
            }
            resolve(results);
          }
        } catch (err) { reject(err); }
      };
      if (file.name.endsWith('.xlsx')) reader.readAsArrayBuffer(file);
      else reader.readAsText(file, 'UTF-8');
    });
  },

  _downloadArtworkTemplate() {
    const headers = ['作品编号','标题','艺术家','年份','材质','尺寸','位置','总件数','已售件数','结算价','零售价','状态','图片URL','备注'];
    const example = ['A0001','示例作品标题','张大千','1985','水墨画','68×136cm','1号展厅','5','0','5000','8000','在库','https://example.com/art.jpg','示例备注'];
    const csvContent = '﻿' + headers.join(',') + '\n' + example.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `艾维美术馆_作品档案导入模板_${todayStr()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast('模板已下载，请按表头填写后导入');
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
