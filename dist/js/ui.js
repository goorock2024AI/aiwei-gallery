// ui.js — UI 渲染函数（Supabase 异步版）
const UI = {
  _editingId: null,
  _editingExpenseId: null,
  _editingSpaceId: null,
  _editingGalleryId: null,
  _revenueFilterMonth: '',
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
    const filter = this._revenueFilterMonth || todayStr().slice(0, 7);

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
                      <div class="form-group"><label>折扣%</label><input type="number" id="ws-discount" min="0" max="100" value="0" style="width:60px"></div>
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

          <!-- 历史记录列表 -->
          <div class="card">
            <div class="card-title">收入记录</div>
            <div class="filter-bar">
              <div class="form-group"><label>筛选月份</label><select id="rev-filter-month" onchange="UI._filterRevenue()">${this._monthOptions()}</select></div>
              <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('rev-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterRevenue()">本月</button>
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

    document.getElementById('rev-filter-month').value = filter;

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
    const amount = qty * price * (1 - discount / 100);

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
      const discText = item.discount > 0 ? ` (${item.discount}%off)` : '';
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
    const ticketAmount = tItems.reduce((s, i) => s + i.amount, 0);
    const coffeeAmount = cItems.reduce((s, i) => s + i.amount, 0);
    const oth = +($('#rev-other')?.value || 0);

    const workshopAmount = this._workshopItems.reduce((s, i) => s + i.amount, 0);
    const retailAmount = this._retailItems.reduce((s, i) => s + i.amount, 0);
    const total = ticketAmount + coffeeAmount + workshopAmount + retailAmount + oth;

    const s = id => document.getElementById(id);
    if (s('s-ticket')) s('s-ticket').textContent = ticketAmount.toFixed(2);
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
        preview.textContent = q > 0 ? `¥${p} × ${q} ${d > 0 ? `(${d}% off) ` : ''}= ¥${(q * p * (1 - d / 100)).toFixed(2)}` : '';
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

    const data = {
      date: document.getElementById('rev-date').value,
      ticketItems: tItems,
      ticketAmount: tItems.reduce((s, i) => s + i.amount, 0),
      coffeeItems: cItems,
      coffeeAmount: cItems.reduce((s, i) => s + i.amount, 0),
      workshopItems: this._workshopItems.map(i => ({ ...i })),
      workshopAmount: this._workshopItems.reduce((s, i) => s + i.amount, 0),
      retailItems: this._retailItems.map(i => ({ productName: i.productName, qty: i.qty, unitPrice: i.unitPrice, amount: i.amount })),
      retailAmount: this._retailItems.reduce((s, i) => s + i.amount, 0),
      otherAmount: +($('#rev-other')?.value || 0),
      otherDesc: $('#rev-other-desc')?.value || '',
      paymentMethod,
      projectName: '',
      notes: $('#rev-notes')?.value || '',
      cashAmount: paymentMethod === '扫码支付' || paymentMethod === '对公转账' ? 0 : total,
      accountAmount: paymentMethod !== '扫码支付' && paymentMethod !== '对公转账' ? 0 : total
    };

    try {
      if (this._editingId) {
        await Store.update('revenue', this._editingId, data);
        this.toast('收入记录已更新');
        this._editingId = null;
      } else {
        await Store.add('revenue', createRevenue(data));
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
    this._workshopItems = (r.workshopItems || []).map(i => ({ ...i }));
    this._renderWorkshopList();

    // 文创
    this._retailItems = (r.retailItems || []).map(i => ({ ...i }));
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

  // —— 收入记录列表 ——
  async _renderRevenueList() {
    const filter = document.getElementById('rev-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#revenue-list');
    if (!el) return;

    const records = await Store.getByMonth('revenue', filter);
    const countEl = $('#rev-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">💰</div>暂无收入记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>普通票</th><th>套票</th><th>咖啡</th><th>工坊</th><th>文创</th><th>其他</th><th>合计</th><th>收款方式</th><th>项目</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const total = (r.ticketAmount||0) + (r.comboAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0);
      h += `<tr>
        <td>${r.date}</td>
        <td>${r.ticketQty||0}张 / ${this._fmt(r.ticketAmount)}</td>
        <td>${r.comboQty||0}张 / ${this._fmt(r.comboAmount)}</td>
        <td>${r.coffeeQty||0}杯 / ${this._fmt(r.coffeeAmount)}</td>
        <td>${this._fmt(r.workshopAmount)}</td>
        <td>${this._fmt(r.retailAmount || r.creativeAmount)}</td>
        <td>${r.otherDesc ? r.otherDesc + ' ' : ''}${this._fmt(r.otherAmount)}</td>
        <td><strong>${this._fmt(total)}</strong></td>
        <td><span class="tag tag-info">${r.paymentMethod || '—'}</span></td>
        <td>${r.projectName || '-'}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-secondary" onclick="UI._editRevenue('${r.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="UI._deleteRevenue('${r.id}')">删除</button>
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

  async _deleteRevenue(id) {
    if (!confirm('确认删除此收入记录？')) return;
    await Store.delete('revenue', id);
    this.toast('已删除');
    await this._renderRevenueList();
  },

  _filterRevenue() {
    this._revenueFilterMonth = document.getElementById('rev-filter-month').value;
    this._renderRevenueList();
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
    const totalAmount = todayRecords.reduce((s, r) => {
      return s + (r.ticketAmount||0) + (r.coffeeAmount||0) + (r.comboAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0);
    }, 0);
    el.innerHTML = `
      <div class="today-stat-item"><span class="today-stat-label">今日门票</span><span class="today-stat-value">${ticketQty} 张</span></div>
      <div class="today-stat-divider"></div>
      <div class="today-stat-item"><span class="today-stat-label">今日实收</span><span class="today-stat-value">¥${this._fmt(totalAmount)}</span></div>
    `;
  },

  _goToSpaceTab() {
    const btn = document.querySelector('.tab-btn[data-tab="space"]');
    if (btn) btn.click();
  },

  // === 支出录入 ===
  async renderExpensePage() {
    const page = $('#page-expense');

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

  // ===== 产品/资产管理 =====
  async renderProductPage() {
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
    `);
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
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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
