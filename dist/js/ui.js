// ui.js — UI 渲染函数（Supabase 异步版）
const UI = {
  _editingId: null,
  _editingExpenseId: null,
  _editingSpaceId: null,
  _editingGalleryId: null,
  _revenueFilterDate: '',
  _expenseFilterMonth: '',
  _selectedExpenseIds: new Set(),
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

  _approvalStatus(record) {
    return record?.approvalStatus || record?.approval_status || '已上架';
  },

  _isListed(record) {
    return this._approvalStatus(record) === '已上架' && this._cpBool(record?.isActive ?? record?.is_active, true);
  },

  _approvalTag(record) {
    const status = this._approvalStatus(record);
    const cls = status === '已上架' ? 'tag-success' : status === '待确认' ? 'tag-info' : status === '已下架' ? 'tag-danger' : 'tag-default';
    return `<span class="tag ${cls}">${this._escHtml(status)}</span>`;
  },

  _canApproveProducts() {
    return Auth.can('approve', 'creative-products') || Auth.isAdmin;
  },

  _canEditCatalog(scope) {
    return Auth.can('edit', scope);
  },

  _canDeleteCatalog() {
    return Auth.can('delete', 'creative-products') || Auth.isAdmin;
  },

  _cpBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '是的', '启用'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', '否', '不是', '停用'].includes(normalized)) return false;
    return fallback;
  },

  _cpBusinessTypeOptions() {
    return [
      { code: 'creative_retail', label: '文创零售' },
      { code: 'beverage_retail', label: '饮料零售' }
    ];
  },

  _cpBusinessTypeLabel(code, isBeverage = false) {
    const normalized = code || (isBeverage ? 'beverage_retail' : 'creative_retail');
    const match = this._cpBusinessTypeOptions().find(item => item.code === normalized);
    return match ? match.label : (normalized || '未设置');
  },

  _normalizeCpBusinessType(value, isBeverage = false) {
    const raw = String(value || '').trim();
    if (!raw) return isBeverage ? 'beverage_retail' : 'creative_retail';
    if (raw === '饮料' || raw === '饮料零售' || raw.toLowerCase() === 'beverage') return 'beverage_retail';
    if (raw === '文创' || raw === '文创零售' || raw === '非饮料文创' || raw.toLowerCase() === 'creative') return 'creative_retail';
    return raw;
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

  _expenseCategoryOptions(selected = '') {
    const categories = MODELS.EXPENSE_CATEGORIES || [];
    let list = categories.slice();
    if (selected && !list.includes(selected)) list = [selected].concat(list);
    return list.map(c => {
      const label = selected && c === selected && !categories.includes(selected) ? `${c}（历史类别）` : c;
      return `<option value="${this._escAttr(c)}"${c === selected ? ' selected' : ''}>${this._escHtml(label)}</option>`;
    }).join('');
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
    const operationalExpenses = expenses.filter(isOperationalExpenseRecord);
    const totalExpense = operationalExpenses.reduce((s, r) => s + (+r.amount || 0), 0);
    const spaceCount = spaces.length;
    const galleryTotal = galleries.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0);
    const galleryCount = galleries.length;

    const statsEl = $('dash-stats') || document.querySelector('#dash-stats');
    if (statsEl) {
      statsEl.outerHTML = `<div class="stats-grid">
        <div class="stat-card"><div class="stat-label">当月收入</div><div class="stat-value">¥${this._fmt(totalRevenue)}</div><div class="stat-sub">${ym}</div></div>
        <div class="stat-card"><div class="stat-label">当月支出</div><div class="stat-value" style="color:var(--red)">¥${this._fmt(totalExpense)}</div><div class="stat-sub">${ym}</div></div>
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
    if (!Auth.can('create', 'revenue')) {
      html(page, `
        <div class="card">
          <div class="card-title">收银收入记录</div>
          <div class="filter-bar">
            <div class="form-group"><label>日期</label><input type="date" id="rev-filter-date" value="${todayStr()}" onchange="UI._filterRevenue()"></div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('rev-filter-date').value='${todayStr()}'; UI._filterRevenue()">今天</button>
            <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="rev-count"></span>
          </div>
          <div id="revenue-list"><div class="loading-state"><div class="spinner"></div></div></div>
        </div>
      `);
      await this._renderRevenueList();
      return;
    }
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
            <div id="pos-cash-panel" class="pos-today-stats" style="margin-top:8px"></div>

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
                    <div class="form-group"><label>产品名</label><input type="text" id="rt-name" oninput="UI._selectedRetailProduct = null" placeholder="产品名称" style="width:120px"></div>
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
                      <div class="form-group"><label>活动项目</label><input id="ws-project" placeholder="必填，如：周六亲子木刻" style="width:150px"></div>
                      <div class="form-group"><label>活动类型</label><select id="ws-type"><option value="workshop">工坊/体验</option><option value="course_study">课程/研学</option></select></div>
                      <div class="form-group"><label>参与人数</label><input type="number" id="ws-qty" min="1" step="1" value="1" style="width:72px"></div>
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
            <div class="card-title" style="margin-top:24px">本月工坊项目经营</div>
            <div id="workshop-project-list"><div class="loading-state"><div class="spinner"></div></div></div>
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
    this._loadCounterCashPanel();
    await this._renderRevenueList();
    await this._renderWorkshopProjects();
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
    const projectName = document.getElementById('ws-project')?.value.trim() || '';
    if (!projectName) { this.toast('请输入活动项目名称', 'error'); return; }
    const [name, priceStr] = sel.value.split(':');
    const price = +priceStr;
    const qty = Number(qtyInput.value);
    const discount = +discInput.value || 0;
    if (!Number.isInteger(qty) || qty <= 0) { this.toast('参与人数必须为正整数', 'error'); return; }
    if (discount < 0 || discount > qty * price) { this.toast('优惠额不能超过原价', 'error'); return; }

    this._workshopItems.push(createWorkshopSaleItem({ name, price }, projectName, document.getElementById('ws-type')?.value, qty, discount));
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
    this._workshopItems.map(normalizeWorkshopSaleItem).forEach((item, idx) => {
      total += item.amount;
      const discText = item.discount > 0 ? ` (优惠¥${item.discount})` : '';
      h += `<div class="pos-item-row">
        <span class="pos-item-name">${this._escHtml(item.productName)} · ${this._escHtml(item.projectName || '未填写项目')} · ${item.qty}人${discText}</span>
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
    const products = (await Store.getAll('creativeProducts') || []).filter(p => this._isListed(p));
    if (!products.length) { this.toast('暂无已上架文创产品，请先由管理员确认上架', 'error'); return; }
    const normalized = products.map(p => ({
      ...p,
      _stock: Number(p.stock ?? 0) || 0,
      _retailPrice: Number(p.retailPrice ?? p.retail_price ?? 0) || 0,
      _supplier: p.supplier || '',
      _unit: p.unit || '个'
    })).sort((a, b) => {
      const aReady = a._retailPrice > 0 ? 0 : 1;
      const bReady = b._retailPrice > 0 ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
    try {
      const aliases = await Store._request('GET', '/rest/v1/product_aliases?is_active=eq.true&limit=5000');
      normalized.forEach(p => { p._aliases = (aliases || []).filter(a => a.standardProductId === p.id).map(a => a.aliasName).join(' '); });
    } catch (error) {
      this.toast('别名检索暂不可用，可按商品名称选择', 'error');
    }
    const hotKeywords = await this._getCreativePOSHotKeywords(normalized);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    const suppliers = [...new Set(normalized.map(p => p._supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const hotHtml = hotKeywords.length ? `
        <div class="pos-creative-hot-row">
          ${hotKeywords.map(k => `<button type="button" class="cp-hot-chip" data-product-name="${this._escHtml(k)}" title="直接选择 ${this._escHtml(k)}">${this._escHtml(k)}</button>`).join('')}
        </div>` : '';
    overlay.innerHTML = `
      <div class="modal-card modal-card-wide">
        <div class="modal-title">📦 选择文创 / 饮料</div>
        <div class="pos-creative-picker-toolbar">
          <input type="text" id="cp-search-pos" placeholder="按名称 / 标准名 / 条码 / 别名搜索..." oninput="UI._renderCreativePOSList()">
          <select id="cp-supplier-pos" onchange="UI._renderCreativePOSList()">
            <option value="">全部供应商</option>
            ${suppliers.map(s => `<option value="${this._escHtml(s)}">${this._escHtml(s)}</option>`).join('')}
          </select>
        </div>
        ${hotHtml}
        <div id="cp-select-list" class="pos-creative-picker-list"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>
      </div>`;
    overlay._cpList = normalized;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.cp-hot-chip').forEach(btn => {
      btn.addEventListener('click', () => this._selectCreativePOSHotProduct(btn.dataset.productName || ''));
    });
    this._renderCreativePOSList();
  },

  async _getCreativePOSHotKeywords(products) {
    const productNames = new Set(products.map(p => String(p.name || '').trim()).filter(Boolean));
    const scores = new Map();
    try {
      const revenues = await Store.getAll('revenue') || [];
      revenues.forEach(r => {
        const items = Array.isArray(r.retailItems) ? r.retailItems : [];
        items.forEach(item => {
          const name = String(item.productName || item.product_name || item.name || '').trim();
          if (!name || !productNames.has(name)) return;
          const qty = Number(item.qty || item.quantity || 1) || 1;
          scores.set(name, (scores.get(name) || 0) + qty);
        });
      });
    } catch (err) {
      console.warn('Failed to load creative hot products', err);
    }

    const hot = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 5);
    products
      .filter(p => p._retailPrice > 0 && p.name)
      .forEach(p => {
        if (hot.length < 5 && !hot.includes(p.name)) hot.push(p.name);
      });
    return hot.slice(0, 5);
  },

  _applyCreativePOSKeyword(keyword) {
    const input = document.getElementById('cp-search-pos');
    if (!input) return;
    input.value = keyword;
    this._renderCreativePOSList();
  },

  _selectCreativePOSHotProduct(productName) {
    const overlay = document.querySelector('.modal-overlay');
    const name = String(productName || '').trim();
    const product = overlay?._cpList?.find(p => String(p.name || '').trim() === name && p._retailPrice > 0);
    if (product) {
      this._fillCreativeFromPOS(product.id);
      return;
    }
    this._applyCreativePOSKeyword(name);
  },

  _renderCreativePOSList() {
    const overlay = document.querySelector('.modal-overlay');
    const listEl = document.getElementById('cp-select-list');
    if (!overlay || !listEl || !overlay._cpList) return;
    const q = (document.getElementById('cp-search-pos')?.value || '').trim().toLowerCase();
    const supplier = document.getElementById('cp-supplier-pos')?.value || '';
    let list = overlay._cpList;
    if (supplier) list = list.filter(p => p._supplier === supplier);
    if (q) {
      list = list.filter(p => [p.name, p.standardName, p.packageSpec, p.barcode, p._aliases, p.sku, p.supplier, p.notes].some(v => String(v || '').toLowerCase().includes(q)));
    }
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">📦</div>没有匹配的产品</div>';
      return;
    }
    listEl.innerHTML = list.map(p => {
      const canSelect = p._retailPrice > 0;
      const reason = p._retailPrice <= 0 ? '\u65e0\u96f6\u552e\u4ef7' : '';
      return `
        <button type="button" class="cp-select-item ${canSelect ? '' : 'is-disabled'}" ${canSelect ? `onclick="UI._fillCreativeFromPOS('${p.id}')"` : 'disabled'} title="${reason}">
          <span class="cp-select-main">
            <strong>${this._escHtml(p.name || '-')}</strong>
            <span>${this._escHtml([p.standardName, p.packageSpec, this._cpBusinessTypeLabel(p.businessTypeCode, p.isBeverage), p.sku, p._supplier].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="cp-select-side">
            <strong>¥${p._retailPrice.toFixed(2)}</strong>
            <span class="${p._stock > 0 ? 'tag tag-success' : 'tag tag-danger'}">${this._cpBool(p.isCountableStock ?? p.is_countable_stock, true) ? '库存 ' + p._stock + this._escHtml(p._unit) : '不计库存'}</span>
            ${reason ? `<span class="cp-select-reason">${reason}</span>` : ''}
          </span>
        </button>`;
    }).join('');
  },

  _fillCreativeFromPOS(id) {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay && overlay._cpList) {
      const p = overlay._cpList.find(x => x.id === id);
      if (p) {
        this._selectedRetailProduct = { ...p };
        document.getElementById('rt-name').value = p.name;
        document.getElementById('rt-price').value = p._retailPrice || +p.retailPrice || 0;
        document.getElementById('rt-qty').value = 1;
      }
      overlay.remove();
    }
  },

  // —— 添加文创产品 ——
  _selectedRetailProduct: null,
  _retailItems: [],
  _addRetailItem() {
    const priceInput = document.getElementById('rt-price');
    const qtyInput = document.getElementById('rt-qty');
    const nameInput = document.getElementById('rt-name');
    if (!priceInput || !priceInput.value || +priceInput.value <= 0) { this.toast('请输入有效单价', 'error'); return; }
    if (!nameInput || !nameInput.value.trim()) { this.toast('请输入产品名称', 'error'); return; }
    const price = +priceInput.value;
    const qty = qtyInput.value === '' ? 1 : Number(qtyInput.value);
    const name = nameInput.value.trim();
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) { this.toast('请输入有效数量和单价', 'error'); return; }
    this._retailItems.push(createRetailSaleItem(name, qty, price, this._selectedRetailProduct));
    this._selectedRetailProduct = null;
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
        <span class="pos-item-name">${this._escHtml(item.productName)} × ${item.qty}${item.snapshotVersion === 1 ? ' · ' + this._escHtml(this._cpBusinessTypeLabel(item.businessTypeCode, item.isBeverage)) : ' · 未关联商品'}</span>
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
    const isCash = this._isCashPayment(paymentMethod);
    mainRecord.cashAmount = isCash ? mainTotal : 0;
    mainRecord.accountAmount = isCash ? 0 : mainTotal;

    try {
      if (this._editingId) {
        const oldRecord = await Store.getById('revenue', this._editingId);
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
          workshopItems: this._workshopItems.map(normalizeWorkshopSaleItem),
          workshopAmount: this._workshopItems.reduce((s, i) => s + i.amount, 0),
          retailItems: this._retailItems.map(i => ({ ...i })),
          retailAmount: this._retailItems.reduce((s, i) => s + i.amount, 0),
          otherAmount: +($('#rev-other')?.value || 0),
          otherDesc: $('#rev-other-desc')?.value || '',
          cashAmount: isCash ? total : 0,
          accountAmount: isCash ? 0 : total,
        };
        const updated = await Store.update('revenue', this._editingId, editData);
        await this._recordRevenueCashDelta(oldRecord, updated || { ...oldRecord, ...editData, id: this._editingId }, '现金收款编辑差额');
        this.toast('收入记录已更新');
        this._editingId = null;
      } else {
        // 先保存主记录
        if (mainTotal > 0) {
          const saved = await Store.add('revenue', createRevenue(mainRecord));
          await this._recordRevenueCashSale(saved);
        }
        // 每个工坊商品拆为独立记录
        for (const item of this._workshopItems) {
          const saved = await Store.add('revenue', createRevenue({
            ...baseRecord,
            projectName: normalizeWorkshopSaleItem(item).projectName,
            workshopItems: [normalizeWorkshopSaleItem(item)],
            workshopAmount: item.amount,
            cashAmount: isCash ? item.amount : 0,
            accountAmount: isCash ? 0 : item.amount,
          }));
          await this._recordRevenueCashSale(saved);
        }
        // 每个文创商品拆为独立记录
        for (const item of this._retailItems) {
          const amt = item.qty * item.unitPrice;
          const saved = await Store.add('revenue', createRevenue({
            ...baseRecord,
            retailItems: [{ ...item, amount: amt }],
            retailAmount: amt,
            cashAmount: isCash ? amt : 0,
            accountAmount: isCash ? 0 : amt,
          }));
          await this._recordRevenueCashSale(saved);
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
    await this._renderWorkshopProjects();
    this._loadTodayStats();
    this._loadCounterCashPanel();
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
    const workshopProject = document.getElementById('ws-project');
    if (workshopProject) workshopProject.value = '';
    const workshopType = document.getElementById('ws-type');
    if (workshopType) workshopType.value = 'workshop';
    this._retailItems = [];
    this._selectedRetailProduct = null;
    this._renderWorkshopList();
    this._renderRetailList();
    document.querySelectorAll('.pos-payment-btn').forEach(b => b.classList.toggle('active', b.dataset.payment === '扫码支付'));
    this._updatePOS();
  },

  // —— 编辑模式预填 ——
  async _fillPOSEdit(id) {
    this._selectedRetailProduct = null;
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
    this._workshopItems = (Array.isArray(r.workshopItems) ? r.workshopItems : []).map(normalizeWorkshopSaleItem);
    this._renderWorkshopList();

    // 文创
    this._retailItems = (Array.isArray(r.retailItems) ? r.retailItems : []).map(normalizeRetailSaleItem);
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
    this._selectedRetailProduct = null;
    this.renderRevenuePage();
  },

  _getRevenueRecordTotal(r) {
    return (r.ticketAmount || 0)
      + (r.comboAmount || 0)
      + (r.coffeeAmount || 0)
      + (r.workshopAmount || 0)
      + (r.retailAmount || r.creativeAmount || 0)
      + (r.venueAmount || 0)
      + (r.otherAmount || 0);
  },

  async _renderWorkshopProjects() {
    const el = document.getElementById('workshop-project-list');
    if (!el) return;
    const month = (document.getElementById('rev-filter-date')?.value || todayStr()).slice(0, 7);
    try {
      const rows = await Store._request('GET', '/rest/v1/workshop_project_performance_v2?activity_month=eq.' + encodeURIComponent(month) + '&order=last_activity_date.desc');
      if (!rows.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🔧</div>本月暂无已命名的工坊项目</div>'; return; }
      el.innerHTML = '<div class="table-wrap"><table class="data-table" style="min-width:850px"><thead><tr><th>活动项目</th><th>类型/日期</th><th>参与人数</th><th>收入</th><th>直接成本</th><th>贡献额</th><th>数据状态</th></tr></thead><tbody>' + rows.map(r => {
        const costState = r.missingDirectCost ? '<span class="tag tag-info">待补直接成本</span>' : r.pendingCostCount > 0 ? '<span class="tag tag-info">有待归类成本</span>' : '<span class="tag tag-success">已关联成本</span>';
        return `<tr><td><strong>${this._escHtml(r.projectName)}</strong></td><td>${this._escHtml(r.activityTypes || '工坊/体验')}<br>${r.firstActivityDate}${r.firstActivityDate === r.lastActivityDate ? '' : ' 至 ' + r.lastActivityDate}</td><td>${this._fmt(r.participantCount)} 人</td><td>¥${this._fmt(r.revenueAmount)}</td><td>¥${this._fmt(r.directCostAmount)}</td><td><strong>¥${this._fmt(r.contributionAmount)}</strong></td><td>${costState}</td></tr>`;
      }).join('') + '</tbody></table></div><p class="form-hint">直接成本只汇总 M3-05 中明确归属到同名项目和体验活动层的期间支出；未录入成本时不估算。</p>';
    } catch (error) {
      el.innerHTML = '<p>工坊项目经营数据加载失败：' + this._escHtml(error.message || error) + '</p>';
    }
  },

  _canAdjustRecord(record) {
    const status = record?.status || '正常';
    return status !== '已作废' && status !== '已退款';
  },

  _canEditOriginalRecord(record) {
    return (record?.status || '正常') === '正常' && !(record?.refundAmount > 0);
  },

  _requireAdminAdjustment() {
    if (Auth.isAdmin) return true;
    this.toast('仅管理员可执行退款/作废', 'error');
    return false;
  },

  async _recordTransactionAdjustment(targetType, targetId, action, amount, reason) {
    await Store.add('transactionAdjustments', createTransactionAdjustment({
      targetType,
      targetId,
      action,
      amount,
      reason,
      operatorId: Auth.currentUser?.id || '',
      operatorName: Auth.currentUser?.displayName || ''
    }));
  },

  _isCashPayment(method) {
    return method && method !== '扫码支付' && method !== '对公转账';
  },

  async _recordCashMovement(data) {
    const movement = createCashMovement({
      ...data,
      operatorId: data.operatorId || Auth.currentUser?.id || '',
      operatorName: data.operatorName || Auth.currentUser?.displayName || ''
    });
    if (!movement.type || !movement.amount) return null;
    return Store.add('cashMovements', movement);
  },

  async _recordRevenueCashSale(record) {
    const amount = +record.cashAmount || 0;
    if (amount <= 0) return;
    await this._recordCashMovement({
      id: 'cash_sale_revenue_' + record.id,
      date: record.date,
      type: 'cash_sale',
      amount,
      sourceType: 'revenue',
      sourceId: record.id,
      reason: '现金收款',
      notes: record.notes || ''
    });
  },

  async _recordRevenueCashDelta(oldRecord, newRecord, reason) {
    const oldCash = +oldRecord?.cashAmount || 0;
    const newCash = +newRecord?.cashAmount || 0;
    const delta = newCash - oldCash;
    if (!delta) return;
    await this._recordCashMovement({
      id: 'cash_edit_revenue_' + newRecord.id + '_' + Date.now().toString(36),
      date: newRecord.date || oldRecord?.date || todayStr(),
      type: 'cash_adjustment',
      amount: delta,
      sourceType: 'revenue',
      sourceId: newRecord.id,
      reason: reason || '现金收款编辑差额',
      notes: `原现金 ${this._fmt(oldCash)}，新现金 ${this._fmt(newCash)}`
    });
  },

  _getGalleryCashAmount(record) {
    if (!this._isCashPayment(record?.paymentMethod || record?.payment_method)) return 0;
    return Math.max(0, this._getGallerySaleNet(record) - (+record.refundAmount || 0));
  },

  async _recordGalleryCashSale(record) {
    const amount = this._getGalleryCashAmount(record);
    if (amount <= 0) return;
    await this._recordCashMovement({
      id: 'cash_sale_gallery_' + record.id,
      date: record.date,
      type: 'cash_sale',
      amount,
      sourceType: 'gallery',
      sourceId: record.id,
      reason: '画廊现金收款',
      notes: record.notes || ''
    });
  },

  async _recordGalleryCashDelta(oldRecord, newRecord, reason) {
    const oldCash = this._getGalleryCashAmount(oldRecord);
    const newCash = this._getGalleryCashAmount(newRecord);
    const delta = newCash - oldCash;
    if (!delta) return;
    await this._recordCashMovement({
      id: 'cash_edit_gallery_' + newRecord.id + '_' + Date.now().toString(36),
      date: newRecord.date || oldRecord?.date || todayStr(),
      type: 'cash_adjustment',
      amount: delta,
      sourceType: 'gallery',
      sourceId: newRecord.id,
      reason: reason || '画廊现金收款编辑差额',
      notes: `原现金 ${this._fmt(oldCash)}，新现金 ${this._fmt(newCash)}`
    });
  },

  async _getCashMovements() {
    try {
      return await Store.getAll('cashMovements') || [];
    } catch (e) {
      console.warn('[cash] load movements failed:', e);
      return [];
    }
  },

  _sumCashMovements(movements, filterFn = null) {
    return (movements || [])
      .filter(m => !filterFn || filterFn(m))
      .reduce((s, m) => s + (+m.amount || 0), 0);
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

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>收入明细</th><th>合计</th><th>状态</th><th>收款方式</th><th>收款人</th><th>操作</th></tr></thead><tbody>';
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
      const wItems = (Array.isArray(r.workshopItems) ? r.workshopItems : []).map(normalizeWorkshopSaleItem);
      wItems.forEach(i => lines.push(`🔧 ${i.qty}人 · ${this._escHtml(i.productName)}${i.projectName ? ' · ' + this._escHtml(i.projectName) : ''} ¥${this._fmt(i.unitPrice)}`));
      // 文创明细
      const retItems = (Array.isArray(r.retailItems) ? r.retailItems : []).map(normalizeRetailSaleItem);
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

      const total = this._getRevenueRecordTotal(r);
      const refundAmount = r.refundAmount || 0;
      const netTotal = Math.max(0, total - refundAmount);
      const status = r.status || '正常';
      const statusClass = status === '正常' ? 'tag-success' : status === '部分退款' ? 'tag-info' : 'tag-danger';
      const statusText = refundAmount > 0 ? `${status} ¥${this._fmt(refundAmount)}` : status;
      const canAdjust = Auth.isAdmin && this._canAdjustRecord(r);
      const timeStr = r.createdAt ? UI._fmtBeijingTime(r.createdAt) : r.date;
      h += `<tr>
        <td>${timeStr}</td>
        <td>${detailGroupHtml}</td>
        <td><strong>¥${this._fmt(netTotal)}</strong>${refundAmount > 0 ? `<div style="font-size:12px;color:var(--gray-500)">原 ¥${this._fmt(total)}</div>` : ''}</td>
        <td><span class="tag ${statusClass}">${statusText}</span></td>
        <td><span class="tag tag-info">${r.paymentMethod || '—'}</span></td>
        <td>${r.handler || '—'}</td>
        <td class="action-cell">
          <div class="row-actions">
            ${Auth.can('edit', 'revenue') && this._canEditOriginalRecord(r) ? `<button class="btn btn-sm btn-secondary" onclick="UI._editRevenue('${r.id}')">编辑</button>` : ''}
            ${canAdjust ? `<button class="btn btn-sm btn-secondary" onclick="UI._refundRevenue('${r.id}')">退款</button>` : ''}
            ${canAdjust ? `<button class="btn btn-sm btn-danger" onclick="UI._voidRevenue('${r.id}')">作废</button>` : ''}
            ${Auth.isAdmin ? `<button class="btn btn-sm btn-danger" onclick="UI._deleteRevenue('${r.id}')">删除</button>` : ''}
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

  async _filterRevenue() {
    this._revenueFilterDate = document.getElementById('rev-filter-date').value;
    await this._renderRevenueList();
    await this._renderWorkshopProjects();
  },

  async _deleteRevenue(id) {
    if (!confirm('确认删除此收入记录？')) return;
    const record = await Store.getById('revenue', id);
    const remainingCash = Math.max(0, (+record?.cashAmount || 0) - (+record?.refundAmount || 0));
    if (remainingCash > 0) {
      await this._recordCashMovement({
        id: 'cash_delete_revenue_' + id + '_' + Date.now().toString(36),
        date: record.date || todayStr(),
        type: 'cash_delete',
        amount: -remainingCash,
        sourceType: 'revenue',
        sourceId: id,
        reason: '删除现金收入记录',
        notes: '删除收入记录时同步冲销柜台现金'
      });
    }
    await Store.delete('revenue', id);
    this.toast('已删除');
    await this._renderRevenueList();
    await this._renderWorkshopProjects();
    this._loadTodayStats();
    this._loadCounterCashPanel();
  },

  async _voidRevenue(id) {
    if (!this._requireAdminAdjustment()) return;
    const record = await Store.getById('revenue', id);
    if (!record || !this._canAdjustRecord(record)) {
      this.toast('该记录已不能作废', 'error');
      return;
    }
    const reason = (prompt('请输入作废原因') || '').trim();
    if (!reason) { this.toast('已取消作废'); return; }
    const total = this._getRevenueRecordTotal(record);
    const now = new Date().toISOString();
    await Store.update('revenue', id, {
      status: '已作废',
      adjustedAt: now,
      adjustedBy: Auth.currentUser?.displayName || '',
      adjustmentReason: reason
    });
    await this._recordTransactionAdjustment('revenue', id, 'void', total, reason);
    const cashToVoid = Math.max(0, (+record.cashAmount || 0) - (+record.refundAmount || 0));
    if (cashToVoid > 0) {
      await this._recordCashMovement({
        id: 'cash_void_revenue_' + id,
        date: record.date || todayStr(),
        type: 'cash_void',
        amount: -cashToVoid,
        sourceType: 'revenue',
        sourceId: id,
        reason,
        notes: '现金收入作废'
      });
    }
    this.toast('收入记录已作废');
    await this._renderRevenueList();
    await this._renderWorkshopProjects();
    this._loadTodayStats();
    this._loadCounterCashPanel();
  },

  async _refundRevenue(id) {
    if (!this._requireAdminAdjustment()) return;
    const record = await Store.getById('revenue', id);
    if (!record || !this._canAdjustRecord(record)) {
      this.toast('该记录已不能退款', 'error');
      return;
    }
    const total = this._getRevenueRecordTotal(record);
    const refunded = record.refundAmount || 0;
    const remaining = Math.max(0, total - refunded);
    if (remaining <= 0) {
      this.toast('该记录已无可退金额', 'error');
      return;
    }
    const amount = Number(prompt(`请输入退款金额，最多 ¥${this._fmt(remaining)}`, remaining.toFixed(2)));
    if (!Number.isFinite(amount) || amount <= 0) { this.toast('已取消退款'); return; }
    if (amount > remaining) {
      this.toast('退款金额不能超过可退金额', 'error');
      return;
    }
    const reason = (prompt('请输入退款原因') || '').trim();
    if (!reason) { this.toast('已取消退款'); return; }
    const payoutMethod = '现金';
    const newRefund = refunded + amount;
    const status = newRefund >= total ? '已退款' : '部分退款';
    const now = new Date().toISOString();
    const adjustmentReason = `${reason}；实际退款方式：${payoutMethod}`;
    await Store.update('revenue', id, {
      status,
      refundAmount: newRefund,
      adjustedAt: now,
      adjustedBy: Auth.currentUser?.displayName || '',
      adjustmentReason
    });
    await this._recordTransactionAdjustment('revenue', id, status === '已退款' ? 'refund' : 'partial_refund', amount, adjustmentReason);
    if (payoutMethod === '现金') {
      await this._recordCashMovement({
        id: 'cash_refund_revenue_' + id + '_' + Date.now().toString(36),
        date: record.date || todayStr(),
        type: 'cash_refund',
        amount: -amount,
        sourceType: 'revenue',
        sourceId: id,
        reason,
        notes: `收入退款实际支付现金；原收款方式：${record.paymentMethod || '未知'}`
      });
    }
    this.toast('退款已记录');
    await this._renderRevenueList();
    await this._renderWorkshopProjects();
    this._loadTodayStats();
    this._loadCounterCashPanel();
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
    const todayRecords = all.filter(r => r.date === today && (r.status || '正常') !== '已作废');

    const ticketQty = todayRecords.reduce((s, r) => s + (r.ticketQty || 0), 0);
    const ticketAmt = todayRecords.reduce((s, r) => s + (r.ticketAmount || 0), 0);
    const comboAmt = todayRecords.reduce((s, r) => s + (r.comboAmount || 0), 0);
    const coffeeAmt = todayRecords.reduce((s, r) => s + (r.coffeeAmount || 0), 0);
    const workshopAmt = todayRecords.reduce((s, r) => s + (r.workshopAmount || 0), 0);
    const retailAmt = todayRecords.reduce((s, r) => s + (r.retailAmount || r.creativeAmount || 0), 0);
    const venueAmt = todayRecords.reduce((s, r) => s + (r.venueAmount || 0), 0);
    const otherAmt = todayRecords.reduce((s, r) => s + (r.otherAmount || 0), 0);
    const refundAmt = todayRecords.reduce((s, r) => s + (r.refundAmount || 0), 0);
    const totalAmount = Math.max(0, ticketAmt + comboAmt + coffeeAmt + workshopAmt + retailAmt + venueAmt + otherAmt - refundAmt);

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
      item('退款', -refundAmt),
      `<div class="today-stat-divider"></div>`,
      item('合计', totalAmount, true),
    ].join('');
  },

  async _loadCounterCashPanel() {
    const el = document.getElementById('pos-cash-panel');
    if (!el) return;
    const movements = await this._getCashMovements();
    const today = todayStr();
    const balance = this._sumCashMovements(movements);
    const todayCashIn = this._sumCashMovements(movements, m => m.date === today && (+m.amount || 0) > 0);
    const todayDeposit = -this._sumCashMovements(movements, m => m.date === today && m.type === 'cash_deposit');
    const todayOut = -this._sumCashMovements(movements, m => m.date === today && (+m.amount || 0) < 0 && m.type !== 'cash_deposit');

    const item = (label, value, isTotal) => `
      <div class="today-stat-item${isTotal ? ' today-stat-total' : ''}">
        <span class="today-stat-label">${label}</span>
        <span class="today-stat-value">¥${this._fmt(value)}</span>
      </div>
    `;

    el.innerHTML = [
      item('柜台现金', balance, true),
      `<div class="today-stat-divider"></div>`,
      item('今日现金收款', todayCashIn),
      `<div class="today-stat-divider"></div>`,
      item('今日存现金', todayDeposit),
      `<div class="today-stat-divider"></div>`,
      item('现金退款/冲销', todayOut),
      `<div class="today-stat-divider"></div>`,
      `<button type="button" class="btn btn-sm btn-primary" onclick="UI._depositCounterCash()">存现金</button>`
    ].join('');
  },

  async _depositCounterCash() {
    if (!Auth.hasModuleAccess('revenue')) {
      this.toast('无权操作收银台现金', 'error');
      return;
    }
    const movements = await this._getCashMovements();
    const balance = this._sumCashMovements(movements);
    if (balance <= 0) {
      this.toast('当前无可存柜台现金', 'error');
      return;
    }
    const amount = Number(prompt(`请输入存现金金额，最多 ¥${this._fmt(balance)}`, balance.toFixed(2)));
    if (!Number.isFinite(amount) || amount <= 0) { this.toast('已取消存现金'); return; }
    if (amount > balance) {
      this.toast('存现金金额不能超过柜台现金余额', 'error');
      return;
    }
    const accountChannel = (prompt('存入账户/渠道（如 银行账户、微信账户、其他）', '银行账户') || '').trim();
    if (!accountChannel) { this.toast('已取消存现金'); return; }
    const notes = (prompt('备注/凭证说明（可选）', '') || '').trim();
    await this._recordCashMovement({
      id: 'cash_deposit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: todayStr(),
      type: 'cash_deposit',
      amount: -amount,
      sourceType: 'deposit',
      sourceId: '',
      accountChannel,
      reason: '存现金',
      notes
    });
    this.toast('存现金已记录，柜台现金已减少');
    await this._loadCounterCashPanel();
    if (document.getElementById('daily-closing-body')) await this._loadDailyClosing();
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
      const no = r.contractNo || this._genSpaceContractNo(r);
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
          <td><span class="tag tag-info">${this._escHtml(r.businessStatus || '待确认')}</span><div style="font-size:12px;color:var(--gray-500);margin-top:2px">执行：${this._escHtml(r.status || '筹备中')}</div></td>
          <td class="row-actions" style="white-space:nowrap">
            ${Auth.can('create', 'space') && isPending ? `<button class="btn btn-primary btn-sm" onclick="UI._openQuickCollectModal('${r.id}')">💰 收款</button> ` : ''}
            ${Auth.can('edit', 'space') ? `<button class="btn btn-secondary btn-sm" onclick="UI._editSpace('${r.id}')">详情</button>` : ''}
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
    if (!Auth.can('create', 'space')) { this.toast('当前账号无权限录入到账', 'error'); return; }
    const r = (this._projectListRecords || []).find(x => x.id === spaceId);
    if (!r) { this.toast('记录不存在', 'error'); return; }
    const recv = +r.receivableAmount || 0;
    const got = +r.receivedAmount || 0;
    const gap = Math.max(0, recv - got);

    const existing = document.getElementById('quick-collect-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'quick-collect-modal';
    modal.className = 'modal-overlay';
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
      await Store._request('POST', `/rest/v1/space-entry?id=${encodeURIComponent(spaceId)}&action=payment`, { payment: createSpacePayment({
        spaceUsageId: spaceId, paymentDate: date, amount, paymentMethod: method, notes
      }) });
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

  _expensePendingOnly: false,
  _expenseClassFields: {
    costTypeCode: ['cost_type', '成本类型'], businessLayerCode: ['business_layer', '业务层'],
    businessTypeCode: ['business_type', '业务类型'], capabilityAxisCode: ['capability_axis', '能力轴']
  },

  _expenseClassificationHTML(prefix) {
    return `<div class="form-group full"><label for="${prefix}-class-mode">成本归属</label>
      <select id="${prefix}-class-mode" onchange="UI._setExpenseClassMode('${prefix}')"><option value="suggested">采用默认映射建议</option><option value="manual">手动确认归属</option><option value="pending">暂不能判断，标为待归类</option></select>
      <p id="${prefix}-class-hint" role="status">正在加载归属选项…</p>
      <p style="font-size:12px;color:var(--gray-500)">这里记录期间支出与能力投入；采购支出不会再次扣入商品销售毛利。</p></div>
      ${Object.entries(this._expenseClassFields).map(([key, [, label]]) => `<div class="form-group"><label for="${prefix}-${key}">${label}</label><select id="${prefix}-${key}" ${key === 'businessLayerCode' ? `onchange="UI._filterExpenseTypes('${prefix}')"` : ''}></select></div>`).join('')}
      <div class="form-group full"><label for="${prefix}-class-reason">归属说明（可选）</label><input id="${prefix}-class-reason" maxlength="500" placeholder="补充判断依据"></div>`;
  },

  async _loadExpenseClassification(prefix, id = '', initial = false) {
    const mode = document.getElementById(prefix + '-class-mode');
    if (!mode) return;
    const form = mode.closest('form');
    const token = (form._classToken || 0) + 1;
    form._classToken = token;
    form._classReady = false;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    const params = new URLSearchParams();
    if (id || form._expenseId) params.set('id', id || form._expenseId);
    for (const [key, suffix] of Object.entries({ project: 'project', category: 'category', description: 'desc', related_activity: 'activity' })) {
      params.set(key, document.getElementById(prefix + '-' + suffix)?.value || '');
    }
    try {
      const context = await Store._request('GET', '/rest/v1/expense-entry?' + params);
      if (!form.isConnected || form._classToken !== token) return;
      form._expenseId = id || form._expenseId || '';
      form._classContext = context;
      if (initial || !form._classInitialized) {
        for (const [key, [type]] of Object.entries(this._expenseClassFields)) {
          const select = document.getElementById(prefix + '-' + key);
          select.innerHTML = (key === 'costTypeCode' ? '' : '<option value="">' + (key === 'businessLayerCode' ? '共享运营 / 暂不指定' : '暂不指定') + '</option>') + context.dimensions.filter(d => d.dimensionType === type).map(d => `<option value="${this._escHtml(d.code)}">${this._escHtml(d.name)}</option>`).join('');
        }
        if (context.classification) {
          mode.value = 'manual';
          for (const key of Object.keys(this._expenseClassFields)) document.getElementById(prefix + '-' + key).value = context.classification[key] || (key === 'costTypeCode' ? 'uncategorized_cost' : '');
          document.getElementById(prefix + '-class-reason').value = context.classification.overrideReason || '';
        }
        form._classInitialized = true;
      }
      form._classReady = true;
      this._setExpenseClassMode(prefix);
      submit.disabled = false;
    } catch (error) {
      if (form._classToken !== token) return;
      document.getElementById(prefix + '-class-hint').textContent = '归属信息加载失败，请重新进入页面或修改类别重试：' + error.message;
    }
  },

  _filterExpenseTypes(prefix) {
    const layer = document.getElementById(prefix + '-businessLayerCode').value;
    const select = document.getElementById(prefix + '-businessTypeCode');
    const context = select.closest('form')._classContext;
    for (const option of select.options) {
      const match = context?.dimensions.find(d => d.dimensionType === 'business_type' && d.code === option.value);
      option.disabled = !!option.value && match?.parentCode !== layer;
    }
    if (select.selectedOptions[0]?.disabled) select.value = '';
  },

  _setExpenseClassMode(prefix) {
    const mode = document.getElementById(prefix + '-class-mode');
    const context = mode.closest('form')._classContext;
    if (!context) return;
    if (mode.value !== 'manual') {
      const values = mode.value === 'suggested' ? context.suggestion || {} : {};
      for (const key of Object.keys(this._expenseClassFields)) document.getElementById(prefix + '-' + key).value = values[key] || (key === 'costTypeCode' ? 'uncategorized_cost' : '');
    }
    for (const key of Object.keys(this._expenseClassFields)) document.getElementById(prefix + '-' + key).disabled = mode.value !== 'manual';
    this._filterExpenseTypes(prefix);
    const name = context.dimensions.find(d => d.dimensionType === 'cost_type' && d.code === context.suggestion?.costTypeCode)?.name;
    document.getElementById(prefix + '-class-hint').textContent = mode.value === 'pending' ? '将保存为待归类，后续可在列表中补充。' : mode.value === 'manual' ? '按当前选择保存；共享运营可不指定业务层，能力轴可留空。' : name ? '默认建议：' + name + '。如不符合本笔用途，请切换手动确认。' : '未找到可靠默认映射，将保存为待归类。';
  },

  _readExpenseClassification(prefix) {
    const mode = document.getElementById(prefix + '-class-mode');
    if (!mode.closest('form')._classReady) throw new Error('请先加载成本归属选项');
    const result = { mode: mode.value, overrideReason: document.getElementById(prefix + '-class-reason').value.trim() };
    for (const key of Object.keys(this._expenseClassFields)) result[key] = document.getElementById(prefix + '-' + key).value;
    return result;
  },

  // === 支出录入 ===
  async renderExpensePage() {
    const page = $('#page-expense');
    if (!Auth.hasModuleAccess('expense')) { this._noAccess(page); return; }

    html(page, `
      <div class="card">
        <div class="card-title">新增支出记录</div>
        <form id="expense-form" class="form-grid">
          <div class="form-group">
            <label>日期</label>
            <div style="display:flex;gap:6px"><input type="date" id="exp-date" value="${todayStr()}" style="flex:1">${this._todayBtn('exp-date')}</div>
          </div>
          <div class="form-group"><label>支出类别</label><select id="exp-category" onchange="UI._loadExpenseClassification('exp')">${this._expenseCategoryOptions()}</select></div>
          <div class="form-group"><label for="exp-project">归属项目</label><input id="exp-project" value="运营" placeholder="项目/展览/活动名称" onchange="UI._loadExpenseClassification('exp')"></div>
          <div class="form-group"><label>金额</label><input type="number" id="exp-amount" min="0" step="0.01" placeholder="0.00" required></div>
          <div class="form-group full"><label>内容说明</label><input type="text" id="exp-desc" onchange="UI._loadExpenseClassification('exp')" placeholder="支出具体内容"></div>
          <div class="form-group"><label>经手人</label><input type="text" id="exp-handler" placeholder="经手人姓名"></div>
          <div class="form-group"><label>发票</label><select id="exp-invoice">${MODELS.INVOICE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>付款凭证</label><select id="exp-receipt">${MODELS.RECEIPT_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>关联活动</label><input type="text" id="exp-activity" onchange="UI._loadExpenseClassification('exp')" placeholder="关联展览/活动名称"></div>
          ${this._expenseClassificationHTML('exp')}
          <div class="form-actions full">
            <button type="submit" class="btn btn-primary" disabled>保存记录</button>
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">支出记录</div>
        <div class="filter-bar">
          <div class="form-group"><label>筛选月份</label><select id="exp-filter-month" onchange="UI._filterExpense()">${this._monthOptions()}</select></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('exp-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterExpense()">本月</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="UI._uploadSelectedExpenseAttachment()">上传票据</button>
          <button type="button" class="btn btn-sm btn-primary" onclick="UI._generateSelectedExpensePdf()">生成所选 PDF</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="exp-count"></span>
        </div>
        <div class="filter-bar"><label><input id="exp-pending-only" type="checkbox" ${this._expensePendingOnly ? 'checked' : ''} onchange="UI._expensePendingOnly=this.checked; UI._renderExpenseList()"> 只看待归类支出</label><span id="exp-class-count"></span></div>
        <div id="expense-list"><div class="loading-state"><div class="spinner"></div></div></div>
        <div id="expense-pdf-list" style="margin-top:16px"></div>
      </div>
    `);

    await this._loadExpenseClassification('exp');
    document.getElementById('exp-filter-month').value = this._expenseFilterMonth || todayStr().slice(0, 7);
    await this._renderExpenseList();
    await this._renderExpensePdfList();
  },

  _fillExpenseForm(r) {
    $('#exp-date').value = r.date;
    if ($('#exp-project')) $('#exp-project').value = r.project;
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

    const allRecords = (await Store.getByMonth('expense', filter)).filter(isOperationalExpenseRecord);
    let facts;
    try {
      facts = await Store._request('GET', '/rest/v1/business_cost_facts_v2?source_table=eq.expense&business_date=gte.' + encodeURIComponent(filter + '-01') + '&business_date=lte.' + encodeURIComponent(filter + '-31') + '&limit=5000');
    } catch (error) { html(el, '<p>成本归属加载失败，无法判断待归类状态。请稍后重试。</p>'); return; }
    const byId = new Map(facts.map(f => [f.sourceId, f]));
    const pending = r => !byId.has(r.id) || byId.get(r.id).costTypeCode === 'uncategorized_cost';
    const pendingCount = allRecords.filter(pending).length;
    const classCount = document.getElementById('exp-class-count');
    if (classCount) classCount.textContent = '本月待归类 ' + pendingCount + ' 笔 / ' + allRecords.length + ' 笔';
    const records = this._expensePendingOnly ? allRecords.filter(pending) : allRecords;
    const attachmentsByExpense = this._groupExpenseAttachments(await Store.getAll('expenseAttachments'));
    const countEl = $('#exp-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    const expenseTotal = records.reduce((s, r) => s + (+r.amount || 0), 0);
    const reimbursedTotal = records.reduce((s, r) => s + (r.reimbursementStatus === '已报销' ? (+r.amount || 0) : 0), 0);
    const pendingReimbursementTotal = Math.max(0, expenseTotal - reimbursedTotal);
    const summaryHtml = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">${this._expensePendingOnly ? '待归类支出合计' : '支出合计'}</div><div class="stat-value" style="color:var(--red)">¥${this._fmt(expenseTotal)}</div><div class="stat-sub">${filter}</div></div>
        <div class="stat-card"><div class="stat-label">已报销</div><div class="stat-value">¥${this._fmt(reimbursedTotal)}</div><div class="stat-sub">运营支出</div></div>
        <div class="stat-card"><div class="stat-label">待报销</div><div class="stat-value">¥${this._fmt(pendingReimbursementTotal)}</div><div class="stat-sub">运营支出</div></div>
      </div>`;

    if (!records.length) { html(el, summaryHtml + '<div class="empty-state"><div class="icon">🧾</div>暂无支出记录</div>'); return; }

    let h = summaryHtml + '<div class="table-wrap"><table class="data-table" style="min-width:1000px"><thead><tr><th><input type="checkbox" onchange="UI._toggleAllExpenseSelection(this.checked)"></th><th>日期</th><th>项目</th><th>类别</th><th>成本归属</th><th>金额</th><th>内容</th><th>经手人</th><th>票据</th><th>报销</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const isReimbursed = r.reimbursementStatus === '已报销';
      const reimbursementTag = isReimbursed ? 'tag-success' : 'tag-info';
      const reimbursementStatus = r.reimbursementStatus || '未报销';
      const attachmentStatus = this._renderExpenseAttachmentStatus(attachmentsByExpense[r.id] || [], r.id);
      const checked = this._selectedExpenseIds.has(r.id) ? ' checked' : '';
      h += `<tr>
        <td><input type="checkbox" class="exp-select" value="${r.id}"${checked} onchange="UI._toggleExpenseSelection('${r.id}', this.checked)"></td>
        <td>${r.date}</td>
        <td>${this._escHtml(r.project)}</td>
        <td>${this._escHtml(r.category)}</td>
        <td><span class="tag ${pending(r) ? 'tag-info' : 'tag-success'}">${pending(r) ? '待归类' : this._escHtml(byId.get(r.id).costTypeName)}</span><br>${this._escHtml(byId.get(r.id)?.businessLayerName || '共享运营 / 暂不指定')}<br>${this._escHtml(byId.get(r.id)?.capabilityAxisName || '')}</td>
        <td><strong>${this._fmt(r.amount)}</strong></td>
        <td>${r.description || '-'}</td>
        <td>${r.handler || '-'}</td>
        <td>${attachmentStatus}</td>
        <td>
          <span class="tag ${reimbursementTag}">${reimbursementStatus}</span>
        </td>
        <td class="row-actions">
          <button class="btn btn-sm btn-primary" onclick="UI._showExpenseAttachmentModal('${r.id}')">上传票据</button>
          <button class="btn btn-sm btn-gold" onclick="UI._generateExpensePdf(['${r.id}'])">PDF</button>
          <button class="btn btn-sm ${isReimbursed ? 'btn-secondary' : 'btn-primary'}" onclick="UI._toggleExpenseReimbursed('${r.id}', '${isReimbursed ? '未报销' : '已报销'}')">${isReimbursed ? '取消报销' : '已报销'}</button>
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
      project: $('#exp-project').value || '运营',
      category: $('#exp-category').value,
      amount: +($('#exp-amount').value || 0),
      description: $('#exp-desc').value,
      handler: $('#exp-handler').value,
      invoiceStatus: $('#exp-invoice').value,
      receiptStatus: $('#exp-receipt').value,
      relatedActivity: $('#exp-activity').value
    };
    const errs = validateExpense(data);
    if (errs.length) { this.toast(errs[0], 'error'); if (btn) { btn.disabled = false; btn.textContent = '保存记录'; } return; }

    try {
      const result = await Store._request('POST', '/rest/v1/expense-entry', { expense: createExpense(data), classification: this._readExpenseClassification('exp') });
      const shouldUpload = confirm('支出与成本归属已保存。是否现在上传发票或支付凭证？');
      this.toast('支出与成本归属已保存');
      await this.renderExpensePage();
      if (shouldUpload && result.expense?.id) await this._showExpenseAttachmentModal(result.expense.id);
    } catch (error) {
      this.toast('保存失败：' + error.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '保存记录'; }
    }
  },

  async _editExpense(id) {
    const r = await Store.getById('expense', id);
    if (!r) { this.toast('未找到支出记录', 'error'); return; }
    document.getElementById('expense-edit-modal')?.remove();
    const overlay = document.createElement('div');
    const safeId = this._escAttr(r.id);
    overlay.className = 'modal-overlay';
    overlay.id = 'expense-edit-modal';
    overlay.innerHTML = `
      <div class="modal-card modal-card-wide" onclick="event.stopPropagation()">
        <div class="modal-title">编辑支出记录</div>
        <form id="expense-edit-form" class="form-grid" onsubmit="event.preventDefault(); UI._saveExpenseEdit('${safeId}')">
          <div class="form-group"><label for="exp-edit-project">归属项目</label><input id="exp-edit-project" value="${this._escAttr(r.project || '运营')}" onchange="UI._loadExpenseClassification('exp-edit')"></div>
          <div class="form-group">
            <label>日期</label>
            <div style="display:flex;gap:6px"><input type="date" id="exp-edit-date" value="${this._escHtml(r.date || todayStr())}" style="flex:1">${this._todayBtn('exp-edit-date')}</div>
          </div>
          <div class="form-group"><label>支出类别</label><select id="exp-edit-category" onchange="UI._loadExpenseClassification('exp-edit')">${this._expenseCategoryOptions(r.category || '')}</select></div>
          <div class="form-group"><label>金额</label><input type="number" id="exp-edit-amount" min="0" step="0.01" placeholder="0.00" value="${this._escHtml(r.amount ?? '')}" required></div>
          <div class="form-group full"><label>内容说明</label><input type="text" id="exp-edit-desc" onchange="UI._loadExpenseClassification('exp-edit')" placeholder="支出具体内容" value="${this._escHtml(r.description || '')}"></div>
          <div class="form-group"><label>经手人</label><input type="text" id="exp-edit-handler" placeholder="经手人姓名" value="${this._escHtml(r.handler || '')}"></div>
          <div class="form-group"><label>发票</label><select id="exp-edit-invoice">${MODELS.INVOICE_STATUSES.map(s => `<option value="${this._escHtml(s)}"${s === r.invoiceStatus ? ' selected' : ''}>${this._escHtml(s)}</option>`).join('')}</select></div>
          <div class="form-group"><label>付款凭证</label><select id="exp-edit-receipt">${MODELS.RECEIPT_STATUSES.map(s => `<option value="${this._escHtml(s)}"${s === r.receiptStatus ? ' selected' : ''}>${this._escHtml(s)}</option>`).join('')}</select></div>
          <div class="form-group"><label>关联活动</label><input type="text" id="exp-edit-activity" onchange="UI._loadExpenseClassification('exp-edit')" placeholder="关联展览/活动名称" value="${this._escHtml(r.relatedActivity || '')}"></div>
          ${this._expenseClassificationHTML('exp-edit')}
          <div class="modal-actions full">
            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
            <button type="submit" class="btn btn-primary">保存修改</button>
          </div>
        </form>
      </div>`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    await this._loadExpenseClassification('exp-edit', id, true);
    document.getElementById('exp-edit-amount')?.focus();
  },

  async _saveExpenseEdit(id) {
    const form = document.getElementById('expense-edit-form');
    const btn = form?.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    const data = {
      date: $('#exp-edit-date').value,
      project: $('#exp-edit-project')?.value || '运营',
      category: $('#exp-edit-category').value,
      amount: +($('#exp-edit-amount').value || 0),
      description: $('#exp-edit-desc').value,
      handler: $('#exp-edit-handler').value,
      invoiceStatus: $('#exp-edit-invoice').value,
      receiptStatus: $('#exp-edit-receipt').value,
      relatedActivity: $('#exp-edit-activity').value
    };
    const errs = validateExpense(data);
    if (errs.length) {
      this.toast(errs[0], 'error');
      if (btn) { btn.disabled = false; btn.textContent = '保存修改'; }
      return;
    }
    try {
      await Store._request('PATCH', '/rest/v1/expense-entry?id=' + encodeURIComponent(id), { expense: data, classification: this._readExpenseClassification('exp-edit') });
      this.toast('支出记录已更新');
      document.getElementById('expense-edit-modal')?.remove();
      await this._renderExpenseList();
      await this._renderExpensePdfList();
    } catch (e) {
      this.toast('支出记录更新失败：' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '保存修改'; }
    }
  },

  async _deleteExpense(id) {
    if (!confirm('确认删除此支出记录？')) return;
    await Store.delete('expense', id);
    this.toast('已删除');
    await this._renderExpenseList();
  },

  async _toggleExpenseReimbursed(id, reimbursementStatus) {
    await Store.update('expense', id, { reimbursementStatus });
    this.toast(reimbursementStatus === '已报销' ? '已标记为已报销' : '已取消报销标记');
    await this._renderExpenseList();
  },

  _filterExpense() {
    this._expenseFilterMonth = document.getElementById('exp-filter-month').value;
    this._selectedExpenseIds.clear();
    this._renderExpenseList();
  },

  _toggleExpenseSelection(id, checked) {
    if (checked) this._selectedExpenseIds.add(id);
    else this._selectedExpenseIds.delete(id);
  },

  _toggleAllExpenseSelection(checked) {
    document.querySelectorAll('.exp-select').forEach(input => {
      input.checked = checked;
      if (checked) this._selectedExpenseIds.add(input.value);
      else this._selectedExpenseIds.delete(input.value);
    });
  },

  async _generateSelectedExpensePdf() {
    const ids = Array.from(this._selectedExpenseIds);
    if (!ids.length) { this.toast('请先勾选支出记录', 'error'); return; }
    await this._generateExpensePdf(ids);
  },

  async _uploadSelectedExpenseAttachment() {
    const ids = Array.from(this._selectedExpenseIds);
    if (!ids.length) { this.toast('请先勾选一条支出记录，或点击行内“上传票据”', 'error'); return; }
    if (ids.length > 1) { this.toast('一次上传票据请选择一条支出记录', 'error'); return; }
    await this._showExpenseAttachmentModal(ids[0]);
  },

  async _generateExpensePdf(expenseIds) {
    if (!Array.isArray(expenseIds) || !expenseIds.length) return;
    try {
      const title = expenseIds.length > 1
        ? `运营支出报销凭证包（${expenseIds.length}笔）`
        : '运营支出报销凭证';
      this.toast('正在生成 PDF...');
      const result = await Store.generateExpensePdf(expenseIds, title);
      this.toast('报销 PDF 已生成');
      this._selectedExpenseIds.clear();
      await this._renderExpenseList();
      await this._renderExpensePdfList();
      const url = this._resolveImageUrl(result.pdfUrl || result.pdf_url || '');
      if (url) window.open(url, '_blank');
    } catch (e) {
      this.toast('生成 PDF 失败：' + (e.message || e), 'error');
    }
  },

  async _renderExpensePdfList() {
    const target = $('#expense-pdf-list');
    if (!target) return;
    const rows = await Store.getAll('expenseReimbursements');
    if (!rows.length) {
      html(target, '<div class="empty-state" style="padding:18px"><div class="icon">📄</div>暂无已生成报销 PDF</div>');
      return;
    }
    const recent = rows.slice(0, 8);
    const body = recent.map(r => {
      const url = this._resolveImageUrl(r.pdfUrl || r.pdf_url || '');
      const expenseIds = Array.isArray(r.expenseIds || r.expense_ids) ? (r.expenseIds || r.expense_ids) : [];
      return `<tr>
        <td>${this._escHtml(r.title || '运营支出报销凭证包')}</td>
        <td>${expenseIds.length || '-'}</td>
        <td>¥${this._fmt(r.totalAmount || r.total_amount)}</td>
        <td>${r.createdAt ? this._fmtBeijingTime(r.createdAt) : '-'}</td>
        <td>${this._escHtml(r.generatedBy || r.generated_by || '-')}</td>
        <td><a class="btn btn-sm btn-primary" href="${this._escHtml(url)}" target="_blank" rel="noopener">下载</a></td>
      </tr>`;
    }).join('');
    html(target, `
      <div class="card" style="margin:0">
        <div class="card-title">已生成报销 PDF</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>名称</th><th>笔数</th><th>金额</th><th>生成时间</th><th>生成者</th><th>操作</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`);
  },

  _groupExpenseAttachments(rows = []) {
    return rows.reduce((acc, row) => {
      const id = row.expenseId || row.expense_id || '';
      if (!id) return acc;
      if (!acc[id]) acc[id] = [];
      acc[id].push(row);
      return acc;
    }, {});
  },

  _renderExpenseAttachmentStatus(rows = [], expenseId = '') {
    const invoiceCount = rows.filter(a => (a.attachmentType || a.attachment_type) === 'invoice').length;
    const paymentCount = rows.filter(a => (a.attachmentType || a.attachment_type) === 'payment').length;
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="tag ${invoiceCount ? 'tag-success' : 'tag-danger'}">发票 ${invoiceCount}</span>
        <span class="tag ${paymentCount ? 'tag-success' : 'tag-danger'}">凭证 ${paymentCount}</span>
        ${expenseId ? `<button type="button" class="btn btn-sm btn-secondary" onclick="UI._showExpenseAttachmentModal('${expenseId}')">上传</button>` : ''}
      </div>`;
  },

  async _showExpenseAttachmentModal(expenseId) {
    const expense = await Store.getById('expense', expenseId);
    if (!expense) { this.toast('未找到支出记录', 'error'); return; }
    document.getElementById('expense-attachment-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'expense-attachment-modal';
    overlay.innerHTML = `
      <div class="modal-card modal-card-wide">
        <div class="modal-title">票据附件</div>
        <div style="font-size:13px;color:var(--gray-700);margin-bottom:14px">
          <strong>${this._escHtml(expense.project || '-')}</strong> · ¥${this._fmt(expense.amount)} · ${this._escHtml(expense.description || '无说明')}
        </div>
        <div class="stats-grid" style="margin-bottom:14px">
          ${this._renderExpenseAttachmentUploadBox(expenseId, 'invoice', '发票图片')}
          ${this._renderExpenseAttachmentUploadBox(expenseId, 'payment', '支付凭证图片')}
        </div>
        <div id="expense-attachment-list"><div class="loading-state"><div class="spinner"></div><span>加载附件...</span></div></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    await this._refreshExpenseAttachmentList(expenseId, false);
  },

  _renderExpenseAttachmentUploadBox(expenseId, type, title) {
    const inputId = `expense-attach-${type}`;
    const buttonId = `${inputId}-button`;
    return `
      <div class="card" style="margin:0">
        <div class="card-title">${title}</div>
        <input type="file" id="${inputId}" accept="image/*" multiple>
        <div style="font-size:12px;color:var(--gray-500);margin-top:6px">支持 jpg/png/webp/gif，单张不超过 5MB，可多选。</div>
        <div id="${inputId}-status" class="upload-status upload-status-muted">请选择图片后点击上传。</div>
        <div class="form-actions" style="margin-top:10px">
          <button type="button" id="${buttonId}" class="btn btn-sm btn-primary" onclick="UI._uploadExpenseAttachments('${expenseId}', '${type}', '${inputId}')">上传</button>
        </div>
      </div>`;
  },

  async _refreshExpenseAttachmentList(expenseId, refreshExpenseList = true) {
    const target = $('#expense-attachment-list');
    if (!target) return;
    const rows = await Store.getExpenseAttachments(expenseId);
    const renderGroup = (type, title) => {
      const group = rows.filter(a => (a.attachmentType || a.attachment_type) === type);
      if (!group.length) return `<div class="empty-state" style="padding:20px">暂无${title}</div>`;
      return `<div class="expense-attachment-grid">${group.map(a => this._renderExpenseAttachmentItem(a)).join('')}</div>`;
    };
    html(target, `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">发票图片</div>
        ${renderGroup('invoice', '发票')}
      </div>
      <div class="card">
        <div class="card-title">支付凭证图片</div>
        ${renderGroup('payment', '支付凭证')}
      </div>
    `);
    if (refreshExpenseList) await this._renderExpenseList();
  },

  _renderExpenseAttachmentItem(a) {
    const url = this._resolveImageUrl(a.fileUrl || a.file_url || '');
    const name = this._escHtml(a.originalName || a.original_name || '附件');
    const size = ((+a.fileSize || +a.file_size || 0) / 1024).toFixed(0);
    return `
      <div class="expense-attachment-item">
        <a href="${this._escHtml(url)}" target="_blank" rel="noopener">
          <img src="${this._escHtml(url)}" alt="${name}" onerror="this.outerHTML='<div class=&quot;expense-attachment-thumb expense-attachment-thumb--error&quot;>加载失败</div>'">
        </a>
        <div class="expense-attachment-meta">
          <div title="${name}">${name}</div>
          <span>${size} KB</span>
        </div>
        <button type="button" class="btn btn-sm btn-danger" onclick="UI._deleteExpenseAttachment('${a.id}', '${a.expenseId || a.expense_id}')">删除</button>
      </div>`;
  },

  async _uploadExpenseAttachments(expenseId, type, inputId) {
    const input = document.getElementById(inputId);
    const status = document.getElementById(inputId + '-status');
    const button = document.getElementById(inputId + '-button');
    const files = Array.from(input?.files || []);
    const setStatus = (message, state = 'muted') => {
      if (!status) return;
      status.textContent = message;
      status.className = `upload-status upload-status-${state}`;
    };
    if (!files.length) {
      setStatus('请先选择图片。', 'error');
      this.toast('请先选择图片', 'error');
      return;
    }
    try {
      if (button) {
        button.disabled = true;
        button.textContent = '上传中...';
      }
      setStatus(`上传中 0/${files.length}...`, 'working');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片文件`);
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} 超过 5MB`);
        const uploaded = await Store.uploadExpenseAttachmentFile(file, type);
        await Store.add('expenseAttachments', createExpenseAttachment({
          expenseId,
          attachmentType: type,
          fileUrl: uploaded.url,
          originalName: uploaded.originalName || file.name,
          fileSize: uploaded.size || file.size,
          mimeType: uploaded.mimeType || file.type
        }));
        setStatus(`上传中 ${i + 1}/${files.length}...`, 'working');
      }
      await Store.update('expense', expenseId, type === 'invoice' ? { invoiceStatus: '有发票' } : { receiptStatus: '有凭证' });
      input.value = '';
      setStatus(`上传成功：${files.length} 张图片已保存。`, 'success');
      this.toast(`票据图片已上传（${files.length}张）`);
      await this._refreshExpenseAttachmentList(expenseId);
    } catch (e) {
      const message = e.message || e;
      setStatus('上传失败：' + message, 'error');
      this.toast('上传失败：' + message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '上传';
      }
    }
  },

  async _deleteExpenseAttachment(id, expenseId) {
    if (!confirm('确认删除此票据附件？')) return;
    const current = await Store.getById('expenseAttachments', id);
    await Store.delete('expenseAttachments', id);
    const type = current?.attachmentType || current?.attachment_type || '';
    if (type) {
      const remaining = await Store.getExpenseAttachments(expenseId);
      const sameTypeLeft = remaining.some(a => (a.attachmentType || a.attachment_type) === type);
      if (!sameTypeLeft) {
        await Store.update('expense', expenseId, type === 'invoice' ? { invoiceStatus: '待补' } : { receiptStatus: '待补' });
      }
    }
    this.toast('票据附件已删除');
    await this._refreshExpenseAttachmentList(expenseId);
  },

  // === 空间使用（重构 2026-07-10：财务卡 + 甘特图 + 子表付款）===
  async renderSpacePage() {
    const page = $('#page-space');
    if (!Auth.hasModuleAccess('space')) { this._noAccess(page); return; }
    const editing = this._editingSpaceId;
    const records = await Store.getAll('space');
    if (!Auth.can('create', 'space')) {
      html(page, `
        <div class="rent-stat-grid" id="rent-stat-grid">${this._renderRentStatCards(records)}</div>
        <div class="card">
          <div class="card-title">🏛 空间使用日历（本月）</div>
          <div class="filter-bar">
            <div class="form-group"><label>月份</label><input type="month" id="sp-gantt-month" value="${this._spaceGanttMonth || todayStr().slice(0,7)}" onchange="UI._onGanttMonthChange()"></div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('sp-gantt-month').value='${todayStr().slice(0,7)}'; UI._onGanttMonthChange()">本月</button>
          </div>
          <div id="space-gantt">${this._renderSpaceGantt(records, this._spaceGanttMonth || todayStr().slice(0,7))}</div>
        </div>
        <div class="card">
          <div class="card-title">空间使用记录</div>
          <div class="filter-bar">
            <div class="form-group"><label>筛选月份</label><select id="sp-filter-month" onchange="UI._filterSpace()">${this._monthOptions()}</select></div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('sp-filter-month').value='${todayStr().slice(0, 7)}'; UI._filterSpace()">本月</button>
            <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="sp-count"></span>
          </div>
          <div id="space-list"><div class="loading-state"><div class="spinner"></div></div></div>
        </div>
      `);
      document.getElementById('sp-filter-month').value = this._spaceFilterMonth || todayStr().slice(0, 7);
      await this._renderSpaceList();
      return;
    }

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
          <div class="form-group"><label>执行类型</label><select id="sp-type" onchange="UI._suggestSpaceBusiness()">${MODELS.SPACE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div class="form-group"><label>客户/合作方</label><input type="text" id="sp-client" placeholder="客户或合作方名称"></div>
          <div class="form-group"><label>执行状态</label><select id="sp-status" onchange="UI._suggestSpaceBusiness()">${MODELS.SPACE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="form-group"><label>租金类型</label>
            <select id="sp-rental-type" onchange="UI._toggleRentalType()">
              ${MODELS.RENTAL_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="sp-rental-amount-group"><label>应收金额</label><input type="number" id="sp-receivable" min="0" step="0.01" placeholder="0.00" value="0"></div>
          <div class="form-group"><label>预计到账日</label><input type="date" id="sp-expected-payment"></div>
          <div class="form-group"><label>业务类型<span class="required-mark">*</span></label><select id="sp-business-type" onchange="UI._markSpaceClassificationManual()"><option value="space_rental">空间租赁/合作</option><option value="brand_event">品牌活动/企业合作</option><option value="uncategorized_revenue">待确认项目</option></select><div class="form-hint" id="sp-business-hint">根据执行类型提供默认建议，可人工确认</div></div>
          <div class="form-group"><label>合作方式<span class="required-mark">*</span></label><select id="sp-cooperation-mode"><option value="">请选择</option><option value="租赁">租赁</option><option value="联办">联办</option><option value="赞助">赞助</option><option value="置换">置换</option><option value="自营">自营</option><option value="其他">其他</option></select></div>
          <div class="form-group"><label>经营状态<span class="required-mark">*</span></label><select id="sp-business-status"><option value="线索">线索</option><option value="洽谈">洽谈</option><option value="已签约">已签约</option><option value="执行中">执行中</option><option value="已完成">已完成</option><option value="已取消">已取消</option><option value="待确认">待确认</option></select></div>
          <div class="form-group"><label>合同/合作编号</label><input type="text" id="sp-contract-no" maxlength="100" placeholder="付费签约项目必填"></div>
          <div class="form-group"><label>项目负责人</label><input type="text" id="sp-project-owner" maxlength="100" placeholder="内部负责人或对接人"></div>
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
    await this._suggestSpaceBusiness(true);

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
        <td><span class="tag tag-success">已入账</span></td>
      </tr>
    `).join('');

    return `
      <div class="card-title">💰 到账明细（已收 ¥${this._fmt(total)} / 应收 ¥${this._fmt(req)}${unpaid > 0 ? ' · 待收 ¥' + this._fmt(unpaid) : ' · 已结清'}）<span style="font-size:12px;color:var(--gray-500);margin-left:8px">录入请到「📋 项目清单」</span></div>
      ${payments.length === 0 ? '<div class="empty-state">暂无到账记录</div>' : `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>日期</th><th>金额</th><th>方式</th><th>备注</th><th>状态</th></tr></thead>
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

  _markSpaceClassificationManual() {
    this._spaceClassificationSource = 'manual';
    const hint = $('#sp-business-hint');
    if (hint) hint.textContent = '已人工确认业务类型';
  },

  async _suggestSpaceBusiness(initial = false) {
    const type = $('#sp-type')?.value || '';
    const status = $('#sp-status')?.value || '';
    if (!type) return;
    try {
      const suggestion = await Store._request('GET', `/rest/v1/space-entry?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status)}`);
      if (initial || this._spaceClassificationSource !== 'manual') {
        if ($('#sp-business-type')) $('#sp-business-type').value = suggestion.businessTypeCode;
        if ($('#sp-business-status')) $('#sp-business-status').value = suggestion.businessStatus;
        this._spaceClassificationSource = 'suggested';
      }
      const hint = $('#sp-business-hint');
      if (hint) hint.textContent = suggestion.requiresConfirmation ? '该场景存在混合用途，请人工确认业务类型' : '已按执行类型给出默认建议，可人工修改';
    } catch (e) { console.warn('[space] 业务类型建议加载失败', e); }
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
    $('#sp-business-type').value = r.businessTypeCode || 'uncategorized_revenue';
    $('#sp-cooperation-mode').value = r.cooperationMode || '';
    $('#sp-business-status').value = r.businessStatus || '待确认';
    $('#sp-contract-no').value = r.contractNo || '';
    $('#sp-project-owner').value = r.projectOwner || '';
    this._spaceClassificationSource = r.businessTypeCode ? 'manual' : 'suggested';
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

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>空间</th><th>项目名称</th><th>业务类型</th><th>合作方式</th><th>合同编号</th><th>负责人</th><th>经营状态</th><th>应收/已收</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const statusTagClass = r.status === '已完成' ? 'tag-success' : r.status === '已取消' || r.status === '空闲' ? 'tag-danger' : 'tag-info';
      const expected = r.expectedPaymentDate || this._calcExpectedPaymentDate(r.date, r.endDate);
      h += `<tr>
        <td>${r.date}</td>
        <td>${this._escHtml(r.space)}</td>
        <td>${this._escHtml(r.projectName)}</td>
        <td><span class="tag ${(r.businessTypeCode || '') === 'uncategorized_revenue' ? 'tag-danger' : 'tag-info'}">${({space_rental:'空间租赁/合作',brand_event:'品牌活动/企业合作',uncategorized_revenue:'待确认项目'})[r.businessTypeCode] || '待确认项目'}</span><div class="form-hint">${this._escHtml(r.type)}</div></td>
        <td>${this._escHtml(r.cooperationMode || '-')}</td>
        <td>${this._escHtml(r.contractNo || '-')}</td>
        <td>${this._escHtml(r.projectOwner || '-')}</td>
        <td><span class="tag ${statusTagClass}">${this._escHtml(r.businessStatus || r.status)}</span></td>
        <td>${r.rentalType === '免费' ? '免费' : `¥${this._fmt(r.receivableAmount)} / ¥${this._fmt(r.receivedAmount || 0)}`}<div class="form-hint">预计 ${expected || '—'}</div></td>
        <td class="row-actions">
          ${Auth.can('edit', 'space') ? `<button class="btn btn-sm btn-secondary" onclick="UI._editSpace('${r.id}')">编辑</button>` : ''}
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
      businessTypeCode: $('#sp-business-type').value,
      cooperationMode: $('#sp-cooperation-mode').value,
      businessStatus: $('#sp-business-status').value,
      contractNo: $('#sp-contract-no').value.trim(),
      projectOwner: $('#sp-project-owner').value.trim(),
      notes: $('#sp-notes').value
    };

    if (!data.projectName) { this.toast('请输入项目/活动名称', 'error'); return; }
    if (!data.date) { this.toast('请选择日期', 'error'); return; }

    // 硬性冲突检测（仅对已确认/进行中状态）
    if (['已确认','进行中'].includes(data.status)) {
      try {
        const r = await fetch((SUPABASE_CONFIG.url || '') + '/rest/v1/space_usage/check-conflict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(typeof Auth !== 'undefined' && Auth.authHeaders ? Auth.authHeaders() : {}) },
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
        await Store._request('PATCH', `/rest/v1/space-entry?id=${encodeURIComponent(this._editingSpaceId)}`, { project: data, classificationSource: this._spaceClassificationSource || 'manual' });
        this.toast('空间使用记录已更新');
        this._editingSpaceId = null;
      } else {
        await Store._request('POST', '/rest/v1/space-entry', { project: createSpaceUsage(data), classificationSource: this._spaceClassificationSource || 'manual' });
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
    const list = (this._artworks || []).filter(a => this._isListed(a));
    if (!list.length) {
      this.toast('暂无已上架作品，请先由管理员确认上架', 'error');
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
      <div class="modal-card modal-card-wide">
        <div class="modal-title">📋 从作品库选择</div>
        <div class="filter-bar" style="margin-bottom:12px">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label>查询</label>
            <input type="text" id="picker-search" placeholder="按标题/艺术家/位置搜索..." autofocus>
          </div>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto">共 ${list.length} 件</span>
        </div>
        <div class="table-wrap modal-table-scroll">
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
    const idEl = $('#gal-artwork-id');
    const settlementEl = $('#gal-settlement-hint');
    if (idEl) idEl.value = a.id;
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
    if (settlementEl) settlementEl.textContent = `结算价快照：¥${this._fmt(a.settlementPrice ?? a.settlement_price)} · 零售价快照：¥${this._fmt(retail)}`;
    this._updateGalleryNet();
    document.querySelector('.modal-overlay')?.remove();
    this.toast(`已选择：${a.artworkNo ? '['+a.artworkNo+'] ' : ''}${a.title}`);
  },

  async renderGalleryPage() {
    const page = $('#page-gallery');
    if (!Auth.hasModuleAccess('gallery')) { this._noAccess(page); return; }
    const editing = this._editingGalleryId;
    await this._loadArtworks();
    if (!Auth.can('create', 'gallery')) {
      html(page, `
        <div class="stats-grid" id="gallery-sales-stats">
          <div class="stat-card"><div class="stat-label">本年画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
          <div class="stat-card"><div class="stat-label">本月画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
          <div class="stat-card"><div class="stat-label">本日画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
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
      await this._renderGallerySalesStats();
      await this._renderGalleryList();
      return;
    }

    html(page, `
      <div class="stats-grid" id="gallery-sales-stats">
        <div class="stat-card"><div class="stat-label">本年画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
        <div class="stat-card"><div class="stat-label">本月画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
        <div class="stat-card"><div class="stat-label">本日画廊销售</div><div class="stat-value">¥0.00</div><div class="stat-sub">--</div></div>
      </div>
      <div class="card">
        <div class="card-title">${editing ? '编辑画廊销售记录' : '新增画廊销售记录'}</div>
        <div class="form-grid">
          <div class="form-section">
            <div class="form-section-title">📅 交易信息</div>
            <div class="form-group"><label>日期<span class="required-mark">*</span></label>
              <div style="display:flex;gap:6px"><input type="date" id="gal-date" value="${todayStr()}" style="flex:1">${this._todayBtn('gal-date')}</div>
            </div>
            <div class="form-group"><label>状态</label>
              <select id="gal-status">
                <option value="已售出">已售出</option>
                <option value="已预定">已预定</option>
              </select>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">🖼️ 作品信息</div>
            <div class="form-group full">
              <label>作品名称<span class="required-mark">*</span></label>
              <div style="display:flex;gap:6px">
                <input type="hidden" id="gal-artwork-id">
                <input type="text" id="gal-artwork" placeholder="请从作品库选择" readonly required style="flex:1;background:var(--cream)">
                <button type="button" class="btn btn-secondary" onclick="UI._pickGalleryArtwork()" title="从产品库-画廊的作品档案中选择">📋 选作品</button>
              </div>
              <div class="form-hint" id="gal-settlement-hint">必须明确关联已上架作品，保存时锁定价格快照</div>
            </div>
            <div class="form-group"><label>作品编号</label>
              <input type="text" id="gal-artwork-no" placeholder="选品后自动填充" readonly style="background:var(--cream);font-family:monospace">
            </div>
            <div class="form-group"><label>艺术家</label>
              <input type="text" id="gal-artist" placeholder="选填">
            </div>
            <div class="form-group full"><label>关联展览</label>
              <input type="text" id="gal-exhibition" placeholder="选填，如：云南重彩画展">
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">
              💰 价格明细
              <span class="form-section-badge">⟳ 自动计算</span>
            </div>
            <div class="form-group"><label>成交数量<span class="required-mark">*</span></label>
              <input type="number" id="gal-quantity" min="1" step="1" value="1" required oninput="UI._updateGalleryNet()">
              <div class="form-hint" id="gal-max-qty-hint"></div>
            </div>
            <div class="form-group"><label>成交单价（元）<span class="required-mark">*</span></label>
              <input type="number" id="gal-price" min="0" step="0.01" placeholder="0.00" required oninput="UI._updateGalleryNet()">
            </div>
            <div class="form-group"><label>佣金/手续费（元）</label>
              <input type="number" id="gal-commission" min="0" step="0.01" placeholder="0.00" value="0" oninput="UI._updateGalleryNet()">
            </div>
            <div class="form-group full">
              <div class="calc-summary">
                <div class="calc-cell">
                  <div class="calc-label">总金额（单价×数量）</div>
                  <div class="calc-value calc-gold" id="gal-amount">¥0.00</div>
                </div>
                <div class="calc-cell calc-cell-divider">
                  <div class="calc-label">净收入</div>
                  <div class="calc-value calc-green" id="gal-net">¥0.00</div>
                </div>
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">📝 收单与备注</div>
            <div class="form-group"><label>买家</label>
              <input type="text" id="gal-buyer" placeholder="选填">
            </div>
            <div class="form-group"><label>收款方式</label>
              <select id="gal-payment">
                <option value="扫码支付">扫码支付</option>
                <option value="现金">现金</option>
                <option value="对公转账">对公转账</option>
              </select>
            </div>
            <div class="form-group"><label>销售渠道</label>
              <select id="gal-channel"><option value="馆内画廊">馆内画廊</option><option value="展览现场">展览现场</option><option value="线上咨询">线上咨询</option><option value="其他">其他</option></select>
            </div>
            <div class="form-group"><label>经手人</label>
              <input type="text" id="gal-handler" placeholder="经手人姓名">
            </div>
            <div class="form-group full"><label>备注</label>
              <input type="text" id="gal-notes" placeholder="选填">
            </div>
          </div>

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
    await this._renderGallerySalesStats();
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
    $('#gal-artwork-id').value = r.artworkId || r.artwork_id || '';
    $('#gal-artist').value = r.artist || '';
    $('#gal-quantity').value = r.saleQuantity || r.sale_quantity || 1;
    $('#gal-price').value = r.price || 0;
    $('#gal-commission').value = r.commission || 0;
    $('#gal-buyer').value = r.buyerName || '';
    $('#gal-payment').value = r.paymentMethod || '扫码支付';
    $('#gal-channel').value = r.galleryChannel || '馆内画廊';
    $('#gal-status').value = ['已售出', '已预定'].includes(r.status) ? r.status : '已售出';
    $('#gal-exhibition').value = r.relatedExhibition || '';
    $('#gal-handler').value = r.handler || '';
    $('#gal-notes').value = r.notes || '';
    const hint = $('#gal-settlement-hint');
    if (hint) hint.textContent = (r.artworkId || r.artwork_id)
      ? `当前快照：结算价 ¥${this._fmt(r.settlementPriceSnapshot)} · 零售价 ¥${this._fmt(r.retailPriceSnapshot)}`
      : '旧记录未明确关联作品，保存前必须重新选作品';
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

    const artworkId = $('#gal-artwork-id')?.value || '';
    data.galleryChannel = $('#gal-channel')?.value || '馆内画廊';
    if (!artworkId) { this.toast('请从作品库明确选择作品', 'error'); return; }

    const errs = validateGallerySale(data);
    if (errs.length) { this.toast(errs[0], 'error'); return; }

    const btn = document.querySelector('#page-gallery .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    try {
      if (this._editingGalleryId) {
        await Store._request('PATCH', `/rest/v1/gallery-entry?id=${encodeURIComponent(this._editingGalleryId)}`, { sale: data, artworkId });
        this.toast('画廊记录已更新');
        this._editingGalleryId = null;
      } else {
        await Store._request('POST', '/rest/v1/gallery-entry', { sale: createGallerySale(data), artworkId });
        this.toast('画廊销售记录已保存');
      }
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

  _getGallerySaleNet(r) {
    const qty = +(r.saleQuantity || r.sale_quantity || 1);
    return Math.max(0, ((r.price || 0) * qty) - (r.commission || 0));
  },

  async _renderGalleryList() {
    const filter = document.getElementById('gal-filter-month')?.value || todayStr().slice(0, 7);
    const el = $('#gallery-list');
    if (!el) return;

    const records = await Store.getByMonth('gallery', filter);
    const countEl = $('#gal-count');
    if (countEl) countEl.textContent = `${records.length} 条记录`;

    if (!records.length) { html(el, '<div class="empty-state"><div class="icon">🖼️</div>暂无画廊销售记录</div>'); return; }

    let h = '<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>作品名称</th><th>作品关联</th><th>成交总额</th><th>结算成本</th><th>贡献</th><th>买家</th><th>状态</th><th>收款方式</th><th>操作</th></tr></thead><tbody>';
    records.forEach(r => {
      const net = Math.max(0, this._getGallerySaleNet(r) - (r.refundAmount || 0));
      const statusClass = r.status === '已售出' ? 'tag-success' : (r.status === '已预定' || r.status === '部分退款') ? 'tag-info' : 'tag-danger';
      const statusText = (r.refundAmount || 0) > 0 ? `${r.status || '已售出'} ¥${this._fmt(r.refundAmount)}` : (r.status || '已售出');
      const canAdjust = Auth.isAdmin && this._canAdjustRecord(r);
      const qty = +(r.saleQuantity || 1);
      const gross = +(r.grossAmountSnapshot ?? (r.price * qty));
      const cost = +(r.settlementPriceSnapshot || 0) * qty;
      const contribution = Math.max(0, net - cost);
      h += `<tr>
        <td>${r.date}</td>
        <td>${r.artworkName || '-'}</td>
        <td>${r.artworkId ? `<span class="tag tag-success">${r.artworkNo || '已关联'}</span>` : '<span class="tag tag-danger">待关联</span>'}</td>
        <td><strong>¥${this._fmt(gross)}</strong><div class="form-hint">${qty} 件</div></td>
        <td>¥${this._fmt(cost)}</td>
        <td><strong>¥${this._fmt(contribution)}</strong><div class="form-hint">扣佣金/退款后</div></td>
        <td>${r.buyerName || '-'}</td>
        <td><span class="tag ${statusClass}">${statusText}</span></td>
        <td>${r.paymentMethod || '-'}</td>
        <td class="row-actions">
          ${Auth.can('edit', 'gallery') && this._canEditOriginalRecord(r) ? `<button class="btn btn-sm btn-secondary" onclick="UI._editGallery('${r.id}')">编辑</button>` : ''}
          ${canAdjust ? `<button class="btn btn-sm btn-secondary" onclick="UI._refundGallery('${r.id}')">退款</button>` : ''}
          ${canAdjust ? `<button class="btn btn-sm btn-danger" onclick="UI._voidGallery('${r.id}')">作废</button>` : ''}
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    html(el, h);
  },

  /**
   * 画廊销售统计卡：全年 / 本月 / 本日（净收入 = price - commission，与全代码口径一致）
   * 一次 getAll + 内存按日期前缀过滤，避免多次网络往返
   */
  async _renderGallerySalesStats() {
    const wrap = document.getElementById('gallery-sales-stats');
    if (!wrap) return;
    const today = todayStr();
    const ym = today.slice(0, 7);
    const year = today.slice(0, 4);
    let all = [];
    try {
      all = await Store.getAll('gallery') || [];
    } catch (e) {
      console.warn('[gallery-stats] getAll failed:', e);
    }
    const buckets = { year: { sum: 0, count: 0 }, month: { sum: 0, count: 0 }, day: { sum: 0, count: 0 } };
    all.forEach(r => {
      if ((r.status || '已售出') === '已作废') return;
      const d = String(r.date || '').slice(0, 10);
      const net = Math.max(0, this._getGallerySaleNet(r) - (r.refundAmount || 0));
      if (d.startsWith(year))    { buckets.year.sum  += net; buckets.year.count++; }
      if (d.startsWith(ym))      { buckets.month.sum += net; buckets.month.count++; }
      if (d === today)           { buckets.day.sum   += net; buckets.day.count++; }
    });
    const cards = wrap.querySelectorAll('.stat-card');
    const set = (i, label, sum, count, sub) => {
      const c = cards[i]; if (!c) return;
      c.querySelector('.stat-label').textContent = label;
      c.querySelector('.stat-value').textContent = '¥' + this._fmt(Math.max(0, sum));
      c.querySelector('.stat-sub').textContent = sub;
    };
    set(0, '本年画廊销售', buckets.year.sum,  buckets.year.count,  `${year} 年 · ${buckets.year.count} 笔`);
    set(1, '本月画廊销售', buckets.month.sum, buckets.month.count, `${ym} · ${buckets.month.count} 笔`);
    set(2, '本日画廊销售', buckets.day.sum,   buckets.day.count,   `今天 · ${buckets.day.count} 笔`);
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
    const remainingCash = this._getGalleryCashAmount(deletedRecord);
    if (remainingCash > 0) {
      await this._recordCashMovement({
        id: 'cash_delete_gallery_' + id + '_' + Date.now().toString(36),
        date: deletedRecord.date || todayStr(),
        type: 'cash_delete',
        amount: -remainingCash,
        sourceType: 'gallery',
        sourceId: id,
        reason: '删除画廊现金销售记录',
        notes: '删除画廊销售记录时同步冲销柜台现金'
      });
    }
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
    this._loadCounterCashPanel();
  },

  async _voidGallery(id) {
    if (!this._requireAdminAdjustment()) return;
    const record = await Store.getById('gallery', id);
    if (!record || !this._canAdjustRecord(record)) {
      this.toast('该记录已不能作废', 'error');
      return;
    }
    const reason = (prompt('请输入作废原因') || '').trim();
    if (!reason) { this.toast('已取消作废'); return; }
    await Store._request('POST', `/rest/v1/gallery-entry?id=${encodeURIComponent(id)}&action=void`, { reason });
    this.toast('画廊销售记录已作废');
    await this._renderGalleryList();
    await this._renderGallerySalesStats();
    this._loadCounterCashPanel();
  },

  async _refundGallery(id) {
    if (!this._requireAdminAdjustment()) return;
    const record = await Store.getById('gallery', id);
    if (!record || !this._canAdjustRecord(record)) {
      this.toast('该记录已不能退款', 'error');
      return;
    }
    const total = this._getGallerySaleNet(record);
    const refunded = record.refundAmount || 0;
    const remaining = Math.max(0, total - refunded);
    if (remaining <= 0) {
      this.toast('该记录已无可退金额', 'error');
      return;
    }
    const amount = Number(prompt(`请输入退款金额，最多 ¥${this._fmt(remaining)}`, remaining.toFixed(2)));
    if (!Number.isFinite(amount) || amount <= 0) { this.toast('已取消退款'); return; }
    if (amount > remaining) {
      this.toast('退款金额不能超过可退金额', 'error');
      return;
    }
    const reason = (prompt('请输入退款原因') || '').trim();
    if (!reason) { this.toast('已取消退款'); return; }
    const payoutMethod = (prompt('请输入实际退款方式：现金 / 原路退回 / 对公转账', record.paymentMethod === '现金' ? '现金' : '原路退回') || '').trim();
    if (!['现金', '原路退回', '对公转账'].includes(payoutMethod)) { this.toast('请选择有效退款方式', 'error'); return; }
    await Store._request('POST', `/rest/v1/gallery-entry?id=${encodeURIComponent(id)}&action=refund`, { amount, reason, payoutMethod });
    this.toast('画廊退款已记录');
    await this._renderGalleryList();
    await this._renderGallerySalesStats();
    this._loadCounterCashPanel();
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
    if (!Auth.isAdmin && !['creative', 'gallery'].includes(this._productTab)) this._productTab = 'creative';
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
        ${Auth.isAdmin ? `<button class="sub-tab-btn ${tab==='ticket'?'active':''}" data-ptab="ticket">🎫 门票 <span class="badge">${counts.ticket}</span></button>
        <button class="sub-tab-btn ${tab==='coffee'?'active':''}" data-ptab="coffee">☕ 咖啡 <span class="badge">${counts.coffee}</span></button>` : ''}
        <button class="sub-tab-btn ${tab==='creative'?'active':''}" data-ptab="creative">📦 文创/零售 <span class="badge">${counts.creative}</span></button>
        ${Auth.isAdmin ? `<button class="sub-tab-btn ${tab==='workshop'?'active':''}" data-ptab="workshop">🔧 工坊 <span class="badge">${counts.workshop}</span></button>` : ''}
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
    if (!Auth.isAdmin) {
      return '<div class="card"><p style="color:var(--gray-500)">该配置仅管理员可维护</p></div>';
    }
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
  async _openProductAliases() {
    if (!Auth.can('edit', 'creative-products')) return this.toast('无权维护商品别名', 'error');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-card modal-card-wide">
      <div class="modal-title">商品别名</div>
      <p>将常用名称关联到标准商品。可限定单价，区分同名商品；停用后不再匹配未归类记录。已保存的销售快照保持不变。</p>
      <div data-alias-status role="status">正在加载…</div>
      <form data-alias-form>
        <div class="form-group"><label for="alias-name">别名</label><input id="alias-name" required maxlength="100" placeholder="例如：水"></div>
        <div class="form-group"><label for="alias-product">标准商品</label><select id="alias-product" required><option value="">请选择商品</option>${this._creativeProducts.filter(p => this._cpBool(p.isActive, true)).map(p => `<option value="${this._escHtml(p.id)}">${this._escHtml([p.standardName || p.name, p.packageSpec, p.sku].filter(Boolean).join(' · '))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="alias-price">匹配单价（留空表示不限）</label><input id="alias-price" type="number" min="0" step="0.01"></div>
        <div class="form-group"><label for="alias-notes">备注</label><input id="alias-notes" maxlength="500"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-alias-reset>清空</button><button type="submit" class="btn btn-primary" disabled>保存别名</button></div>
      </form>
      <div class="form-group"><label for="alias-search">查找别名</label><input id="alias-search" data-alias-search placeholder="搜索别名或标准商品"></div>
      <div class="table-wrap" data-alias-list></div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" data-alias-close>关闭</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const submit = form.querySelector('[type=submit]');
    const status = overlay.querySelector('[data-alias-status]');
    const list = overlay.querySelector('[data-alias-list]');
    let rows = [], editingId = null, busy = false;
    const reset = () => { form.reset(); editingId = null; submit.textContent = '保存别名'; };
    const render = () => {
      const q = overlay.querySelector('[data-alias-search]').value.trim().toLowerCase();
      list.innerHTML = `<table class="data-table"><thead><tr><th>别名</th><th>标准商品 / 规格</th><th>单价</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.filter(r => [r.aliasName, r.standardName].some(v => String(v || '').toLowerCase().includes(q))).map(r => `<tr><td>${this._escHtml(r.aliasName)}</td><td>${this._escHtml(r.standardName)}<br>${this._escHtml(r.packageSpec || '')}</td><td>${r.unitPrice == null ? '不限' : this._fmt(r.unitPrice)}</td><td>${r.isActive ? '启用' : '停用'}</td><td><button type="button" class="btn btn-sm btn-secondary" data-alias-edit="${this._escHtml(r.id)}">编辑</button> <button type="button" class="btn btn-sm btn-secondary" data-alias-toggle="${this._escHtml(r.id)}">${r.isActive ? '停用' : '启用'}</button></td></tr>`).join('') || '<tr><td colspan="5">暂无匹配别名</td></tr>'}</tbody></table>`;
    };
    const load = async () => {
      rows = await Store._request('GET', '/rest/v1/product_aliases?order=created_at.desc&limit=5000');
      status.textContent = `共 ${rows.length} 条别名`;
      render();
      submit.disabled = false;
    };
    overlay.querySelector('[data-alias-close]').onclick = () => { if (!busy) overlay.remove(); };
    overlay.querySelector('[data-alias-reset]').onclick = () => { if (!busy) reset(); };
    overlay.querySelector('[data-alias-search]').oninput = render;
    list.onclick = async e => {
      if (busy) return;
      const edit = e.target.closest('[data-alias-edit]');
      const toggle = e.target.closest('[data-alias-toggle]');
      const row = rows.find(r => r.id === (edit?.dataset.aliasEdit || toggle?.dataset.aliasToggle));
      if (!row) return;
      if (edit) {
        editingId = row.id;
        form.querySelector('#alias-name').value = row.aliasName;
        form.querySelector('#alias-product').value = row.standardProductId;
        form.querySelector('#alias-price').value = row.unitPrice ?? '';
        form.querySelector('#alias-notes').value = row.notes || '';
        submit.textContent = '保存修改';
      } else {
        busy = true;
        submit.disabled = true;
        try { await Store.update('productAliases', row.id, { isActive: !row.isActive }); await load(); }
        catch (error) { status.textContent = '状态更新失败：' + error.message; }
        finally { busy = false; submit.disabled = false; }
      }
    };
    form.onsubmit = async e => {
      e.preventDefault();
      if (busy) return;
      const aliasName = form.querySelector('#alias-name').value.trim();
      const standardProductId = form.querySelector('#alias-product').value;
      const rawPrice = form.querySelector('#alias-price').value;
      if (!aliasName || !standardProductId) { status.textContent = '请填写别名并选择标准商品'; return; }
      const record = { aliasName, standardProductId, unitPrice: rawPrice === '' ? null : Number(rawPrice), notes: form.querySelector('#alias-notes').value.trim() };
      busy = true;
      submit.disabled = true;
      try {
        if (editingId) await Store.update('productAliases', editingId, record);
        else await Store.add('productAliases', { id: createId(), ...record, isActive: true });
        reset();
        await load();
        this.toast('别名已保存');
      } catch (error) { status.textContent = '保存失败：' + error.message; }
      finally { busy = false; submit.disabled = false; }
    };
    try { await load(); }
    catch (error) { status.textContent = '别名数据加载失败，请稍后重试：' + error.message; }
  },

  _renderCreativeTab() {
    const keyword = (this._productSearch.creative || '').trim().toLowerCase();
    let list = this._creativeProducts;
    if (this._cpFilterSupplier) list = list.filter(p => p.supplier === this._cpFilterSupplier);
    if (keyword) list = list.filter(p =>
      String(p.name || '').toLowerCase().includes(keyword) ||
      String(p.standardName || p.standard_name || '').toLowerCase().includes(keyword) ||
      String(p.sku || '').toLowerCase().includes(keyword) ||
      String(p.barcode || '').toLowerCase().includes(keyword) ||
      String(p.businessTypeCode || p.business_type_code || '').toLowerCase().includes(keyword) ||
      String(p.packageSpec || p.package_spec || '').toLowerCase().includes(keyword) ||
      String(p.supplier || '').toLowerCase().includes(keyword) ||
      String(p.notes || '').toLowerCase().includes(keyword)
    );
    const suppliers = this._cpSuppliers();
    const totalPages = Math.max(1, Math.ceil(list.length / this._CP_PAGE_SIZE));
    if (this._cpPage >= totalPages) this._cpPage = totalPages - 1;
    const start = this._cpPage * this._CP_PAGE_SIZE;
    const pageItems = list.slice(start, start + this._CP_PAGE_SIZE);
    const canApprove = this._canApproveProducts();
    const canExport = Auth.can('export', 'creative-products');
    const canDelete = this._canDeleteCatalog();

    const toolbar = `<div class="filter-bar" style="flex-wrap:wrap;gap:8px">
      <div class="form-group" style="min-width:220px;margin-bottom:0">
        <label>查询</label>
        <input type="text" id="prod-search-creative" placeholder="按名称/标准名/SKU/条码/规格/供应商搜索..." value="${this._escHtml(this._productSearch.creative || '')}" oninput="UI._onProductSearch('creative', this.value)">
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
      <button type="button" class="btn btn-sm btn-secondary" onclick="UI._openProductAliases()">商品别名</button>
      ${canExport ? '<button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeProducts()">📤 导出产品</button>' : ''}
      ${canExport ? '<button type="button" class="btn btn-sm btn-secondary" onclick="UI._exportCreativeSales()">📄 销售清单</button>' : ''}
      <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="cp-count">${list.length} 个${keyword||this._cpFilterSupplier ? ' (筛选后)' : ''} · 共 ${this._creativeProducts.length} 个</span>
    </div>`;

    let table = '<div class="table-wrap"><table class="data-table"><thead><tr><th>名称</th><th>标准名称</th><th>SKU/条码</th><th>归属/规格</th><th>供应商</th><th>进货价</th><th>零售价</th><th>库存</th><th>状态</th><th>备注</th><th style="width:130px">操作</th></tr></thead><tbody>';
    if (!pageItems.length) {
      table += `<tr><td colspan="11" style="text-align:center;color:var(--gray-500);padding:16px">${keyword ? '没有匹配项' : '暂无文创产品，请新增或导入'}</td></tr>`;
    } else {
      pageItems.forEach(p => {
        const status = this._approvalStatus(p);
        const standardName = p.standardName || p.standard_name || p.name || '-';
        const businessTypeCode = p.businessTypeCode || p.business_type_code || '';
        const isBeverage = this._cpBool(p.isBeverage ?? p.is_beverage, businessTypeCode === 'beverage_retail');
        const isActive = this._cpBool(p.isActive ?? p.is_active, true);
        const isCountableStock = this._cpBool(p.isCountableStock ?? p.is_countable_stock, true);
        const packageSpec = p.packageSpec || p.package_spec || '-';
        const barcode = p.barcode || '';
        table += `<tr>
          <td>${this._escHtml(p.name || '-')}</td>
          <td>${this._escHtml(standardName)}</td>
          <td>
            <div>${this._escHtml(p.sku || '-')}</div>
            ${barcode ? `<div style="font-size:11px;color:var(--gray-500)">${this._escHtml(barcode)}</div>` : ''}
          </td>
          <td>
            <span class="tag ${isBeverage ? 'tag-info' : 'tag-success'}">${this._escHtml(this._cpBusinessTypeLabel(businessTypeCode, isBeverage))}</span>
            <div style="font-size:11px;color:var(--gray-500);margin-top:4px">${this._escHtml(packageSpec)}</div>
          </td>
          <td>${this._escHtml(p.supplier || '-')}</td>
          <td>¥${this._fmt(p.costPrice)}</td>
          <td><strong>¥${this._fmt(p.retailPrice)}</strong></td>
          <td><span class="tag ${(p.stock || 0) <= 0 ? 'tag-danger' : 'tag-success'}">${isCountableStock ? (p.stock || 0) : '不计'}</span><span style="margin-left:4px">${this._escHtml(p.unit || '个')}</span></td>
          <td>${this._approvalTag(p)}${isActive ? '' : '<br><span class="tag tag-danger" style="margin-top:4px">停用</span>'}</td>
          <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${this._escHtml(p.notes || '-')}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-secondary" onclick="UI._editCreativeProduct('${p.id}')">编辑</button>
            ${canApprove && status !== '已上架' ? `<button class="btn btn-sm btn-primary" onclick="UI._approveCreativeProduct('${p.id}')">上架</button>` : ''}
            ${canApprove && status === '已上架' ? `<button class="btn btn-sm btn-secondary" onclick="UI._unlistCreativeProduct('${p.id}')">下架</button>` : ''}
            ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="UI._deleteCreativeProduct('${p.id}')">删除</button>` : ''}
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
    const canApprove = this._canApproveProducts();
    const canDelete = this._canDeleteCatalog();

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

    let table = '<div class="table-wrap"><table class="data-table"><thead><tr><th style="width:80px">编号</th><th style="width:64px">缩略图</th><th>标题</th><th>艺术家</th><th style="width:90px">库存</th><th style="width:100px">零售价</th><th style="width:110px">最近售出</th><th>作品状态</th><th>上架状态</th><th>位置</th><th style="width:130px">操作</th></tr></thead><tbody>';
    if (!list.length) {
      table += `<tr><td colspan="11" style="text-align:center;color:var(--gray-500);padding:16px">${keyword || chip !== 'all' ? '没有匹配项' : '暂无作品档案，请新增或导入'}</td></tr>`;
    } else {
      list.forEach(a => {
        const statusClass = a.status === '在库' ? 'tag-success' : a.status === '在展' ? 'tag-info' : a.status === '已售' ? 'tag-danger' : a.status === '借出' ? 'tag-warning' : 'tag-default';
        const approvalStatus = this._approvalStatus(a);
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
          <td>${this._approvalTag(a)}</td>
          <td style="max-width:120px">${this._escHtml(a.location || '-')}</td>
          <td class="row-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-secondary" onclick="UI._editArtwork('${a.id}')">编辑</button>
            ${canApprove && approvalStatus !== '已上架' ? `<button class="btn btn-sm btn-primary" onclick="UI._approveArtwork('${a.id}')">上架</button>` : ''}
            ${canApprove && approvalStatus === '已上架' ? `<button class="btn btn-sm btn-secondary" onclick="UI._unlistArtwork('${a.id}')">下架</button>` : ''}
            ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="UI._deleteArtwork('${a.id}')">删除</button>` : ''}
          </td>
        </tr>
        <tr class="artwork-detail-row" id="aw-detail-${this._escHtml(a.id)}" style="display:none;background:var(--cream)">
          <td colspan="11" style="padding:12px 16px">
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
    const currentApproval = this._approvalStatus(d);
    overlay.innerHTML = `
      <div class="modal-card modal-card-form">
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
          <div class="form-group"><label>上架状态</label>
            ${Auth.isAdmin ? `<select id="aw-approval">
              ${['草稿','待确认','已上架','已下架'].map(s => `<option value="${s}"${currentApproval === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>` : `<div style="padding:8px;background:var(--cream);border-radius:var(--radius-sm)">保存后进入待确认</div>`}
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
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button type="button" class="btn btn-primary" id="aw-save-btn">${isEdit ? '保存修改' : '创建作品'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

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
          headers: typeof Auth !== 'undefined' && Auth.authHeaders ? Auth.authHeaders() : {},
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
      const saveBtn = overlay.querySelector('#aw-save-btn');
      if (saveBtn?.disabled) return;
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
        approvalStatus: Auth.isAdmin ? overlay.querySelector('#aw-approval').value : '待确认',
        submittedBy: d.submittedBy || d.submitted_by || Auth.currentUser?.displayName || Auth.currentUser?.username || '',
        approvedBy: Auth.isAdmin && overlay.querySelector('#aw-approval')?.value === '已上架' ? (Auth.currentUser?.displayName || Auth.currentUser?.username || '') : (d.approvedBy || d.approved_by || ''),
        approvedAt: Auth.isAdmin && overlay.querySelector('#aw-approval')?.value === '已上架' ? new Date().toISOString() : (d.approvedAt || d.approved_at || null),
        imageUrl: overlay.querySelector('#aw-image-stored').value.trim(),
        notes: overlay.querySelector('#aw-notes').value.trim(),
        updatedAt: new Date().toISOString()
      };
      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = '保存中...';
        }
        if (isEdit && d.id) {
          await Store.update('artworks', d.id, record);
          UI.toast(Auth.isAdmin ? '作品已更新，列表已刷新' : '作品已更新，等待管理员确认，列表已刷新');
        } else {
          await Store.add('artworks', createArtwork(record));
          UI.toast(Auth.isAdmin ? '作品已新增，列表已刷新' : '作品已提交待确认，列表已刷新');
        }
        await UI._loadArtworks();
        UI._refreshCurrentProductTab();
        overlay.remove();
      } catch (e) {
        UI.toast('保存失败：' + (e.message || e), 'error');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '保存修改' : '创建作品';
        }
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

  async _approveArtwork(id) {
    if (!this._canApproveProducts()) { this.toast('仅管理员可确认上架', 'error'); return; }
    await Store.update('artworks', id, {
      approvalStatus: '已上架',
      approvedBy: Auth.currentUser?.displayName || Auth.currentUser?.username || '',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.toast('作品已上架');
    await this._loadArtworks();
    this._refreshCurrentProductTab();
  },

  async _unlistArtwork(id) {
    if (!this._canApproveProducts()) { this.toast('仅管理员可下架', 'error'); return; }
    if (!confirm('确认下架该作品？下架后不会出现在画廊销售可选列表。')) return;
    await Store.update('artworks', id, {
      approvalStatus: '已下架',
      updatedAt: new Date().toISOString()
    });
    this.toast('作品已下架');
    await this._loadArtworks();
    this._refreshCurrentProductTab();
  },

  async _deleteArtwork(id) {
    if (!this._canDeleteCatalog()) { this.toast('仅管理员可删除', 'error'); return; }
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
      <div class="modal-card modal-card-sm">
        <div class="modal-title">${isEdit ? '编辑' + label : '新增' + label}</div>
        <div class="form-grid">
          <div class="form-group full"><label>名称 *</label><input type="text" id="cfg-name" value="${this._escHtml(d.name || '')}" placeholder="如 普通票 / 手冲咖啡 / 果壳风铃" autofocus></div>
          <div class="form-group full"><label>单价（元）*</label><input type="number" id="cfg-price" min="0" step="0.01" value="${d.price || ''}" placeholder="0.00"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button type="button" class="btn btn-primary" id="cfg-save-btn">${isEdit ? '保存修改' : '创建'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cfg-save-btn').addEventListener('click', async () => {
      const saveBtn = overlay.querySelector('#cfg-save-btn');
      if (saveBtn?.disabled) return;
      const name = overlay.querySelector('#cfg-name').value.trim();
      const price = parseFloat(overlay.querySelector('#cfg-price').value);
      if (!name) { UI.toast('请输入名称', 'error'); return; }
      if (isNaN(price) || price < 0) { UI.toast('请输入有效单价', 'error'); return; }
      const newItem = { name, price };
      const listKeyMap = { ticket: 'ticketProducts', coffee: 'coffeeProducts', workshop: 'WORKSHOP_PRODUCTS' };
      const dbKeyMap = { ticket: 'ticket_products', coffee: 'coffee_products', workshop: 'workshop_products' };
      const listKey = listKeyMap[type];
      const dbKey = dbKeyMap[type];
      const currentItems = MODELS[listKey] || [];
      const nextItems = currentItems.slice();
      if (isEdit) {
        const idx = currentItems.indexOf(item);
        if (idx < 0) { UI.toast('产品不存在', 'error'); return; }
        nextItems[idx] = newItem;
      } else {
        nextItems.push(newItem);
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
      }
      const saved = await Store.saveConfig(dbKey, nextItems);
      if (!saved) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '保存修改' : '创建';
        }
        return;
      }
      MODELS[listKey] = nextItems;
      // 同步旧常量（票务/咖啡）
      if (type === 'ticket') {
        MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10;
        MODELS.COMBO_PRICE = MODELS.ticketProducts.length > 1 ? MODELS.ticketProducts[1].price : 25;
      }
      if (type === 'coffee') MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15;
      UI.toast(isEdit ? '已更新，列表已刷新' : '已新增，列表已刷新');
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
    const nextItems = items.slice();
    nextItems.splice(idx, 1);
    const saved = await Store.saveConfig(dbKey, nextItems);
    if (!saved) return;
    MODELS[listKey] = nextItems;
    if (type === 'ticket') {
      MODELS.TICKET_PRICE = MODELS.ticketProducts[0]?.price || 10;
      MODELS.COMBO_PRICE = MODELS.ticketProducts.length > 1 ? MODELS.ticketProducts[1].price : 25;
    }
    if (type === 'coffee') MODELS.COFFEE_PRICE = MODELS.coffeeProducts[0]?.price || 15;
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
    const currentApproval = this._approvalStatus(d);
    const currentIsBeverage = this._cpBool(d.isBeverage ?? d.is_beverage, (d.businessTypeCode || d.business_type_code) === 'beverage_retail');
    const currentBusinessType = this._normalizeCpBusinessType(d.businessTypeCode || d.business_type_code, currentIsBeverage);
    const currentIsActive = this._cpBool(d.isActive ?? d.is_active, true);
    const currentIsCountableStock = this._cpBool(d.isCountableStock ?? d.is_countable_stock, true);
    overlay.innerHTML = `
      <div class="modal-card modal-card-md">
        <div class="modal-title">${isEdit ? '编辑文创产品' : '新增文创产品'}</div>
        <div class="form-grid">
          <div class="form-group"><label>产品名称 *</label><input type="text" id="cp-name" value="${this._escHtml(d.name || '')}" placeholder="必填"></div>
          <div class="form-group"><label>标准名称</label><input type="text" id="cp-standard-name" value="${this._escHtml(d.standardName || d.standard_name || d.name || '')}" placeholder="用于合并同一产品"></div>
          <div class="form-group"><label>SKU/编码</label><input type="text" id="cp-sku" value="${this._escHtml(d.sku || '')}" placeholder="选填"></div>
          <div class="form-group"><label>条码</label><input type="text" id="cp-barcode" value="${this._escHtml(d.barcode || '')}" placeholder="选填"></div>
          <div class="form-group"><label>业务归属</label><select id="cp-business-type">
            ${this._cpBusinessTypeOptions().map(item => `<option value="${item.code}"${currentBusinessType === item.code ? ' selected' : ''}>${item.label}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>包装规格</label><input type="text" id="cp-package-spec" value="${this._escHtml(d.packageSpec || d.package_spec || '')}" placeholder="如 330ml 瓶装"></div>
          <div class="form-group"><label>供应商</label><input type="text" id="cp-supplier" value="${this._escHtml(d.supplier || '')}" placeholder="选填"></div>
          <div class="form-group"><label>进货价</label><input type="number" id="cp-cost" min="0" step="0.01" value="${d.costPrice || 0}" placeholder="0.00"></div>
          <div class="form-group"><label>零售价 *</label><input type="number" id="cp-retail" min="0" step="0.01" value="${d.retailPrice || 0}" placeholder="0.00"></div>
          <div class="form-group"><label>库存数量</label><input type="number" id="cp-stock" min="0" step="1" value="${d.stock || 0}" placeholder="0"></div>
          <div class="form-group"><label>单位</label><select id="cp-unit">
            ${['个','件','套','只','对','盒','包','瓶','听'].map(u => `<option value="${u}"${(d.unit||'个') === u ? ' selected' : ''}>${u}</option>`).join('')}
          </select></div>
          <div class="form-group"><label>商品属性</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px"><input type="checkbox" id="cp-is-beverage" ${currentIsBeverage ? 'checked' : ''}> 饮料商品</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px"><input type="checkbox" id="cp-is-countable-stock" ${currentIsCountableStock ? 'checked' : ''}> 参与库存计数</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="cp-is-active" ${currentIsActive ? 'checked' : ''}> 参与经营统计</label>
          </div>
          <div class="form-group"><label>上架状态</label>
            ${Auth.isAdmin ? `<select id="cp-approval">
              ${['草稿','待确认','已上架','已下架'].map(s => `<option value="${s}"${currentApproval === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select>` : `<div style="padding:8px;background:var(--cream);border-radius:var(--radius-sm)">保存后进入待确认</div>`}
          </div>
          <div class="form-group full"><label>备注</label><input type="text" id="cp-notes" value="${this._escHtml(d.notes || '')}" placeholder="选填"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button type="button" class="btn btn-primary" id="cp-save-btn">${isEdit ? '保存修改' : '创建产品'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#cp-save-btn').addEventListener('click', async () => {
      const saveBtn = overlay.querySelector('#cp-save-btn');
      if (saveBtn?.disabled) return;
      const name = overlay.querySelector('#cp-name').value.trim();
      if (!name) { UI.toast('请输入产品名称', 'error'); return; }
      const selectedBusinessType = overlay.querySelector('#cp-business-type')?.value || '';
      const isBeverage = (overlay.querySelector('#cp-is-beverage')?.checked || false) || selectedBusinessType === 'beverage_retail';
      const businessTypeCode = this._normalizeCpBusinessType(isBeverage ? 'beverage_retail' : selectedBusinessType, isBeverage);
      const record = {
        name,
        standardName: overlay.querySelector('#cp-standard-name').value.trim() || name,
        businessTypeCode,
        packageSpec: overlay.querySelector('#cp-package-spec').value.trim(),
        barcode: overlay.querySelector('#cp-barcode').value.trim(),
        isBeverage,
        isCountableStock: overlay.querySelector('#cp-is-countable-stock')?.checked !== false,
        isActive: overlay.querySelector('#cp-is-active')?.checked !== false,
        sku: overlay.querySelector('#cp-sku').value.trim(),
        supplier: overlay.querySelector('#cp-supplier').value.trim(),
        costPrice: +overlay.querySelector('#cp-cost').value || 0,
        retailPrice: +overlay.querySelector('#cp-retail').value || 0,
        stock: +overlay.querySelector('#cp-stock').value || 0,
        unit: overlay.querySelector('#cp-unit').value,
        approvalStatus: Auth.isAdmin ? overlay.querySelector('#cp-approval').value : '待确认',
        submittedBy: d.submittedBy || d.submitted_by || Auth.currentUser?.displayName || Auth.currentUser?.username || '',
        approvedBy: Auth.isAdmin && overlay.querySelector('#cp-approval')?.value === '已上架' ? (Auth.currentUser?.displayName || Auth.currentUser?.username || '') : (d.approvedBy || d.approved_by || ''),
        approvedAt: Auth.isAdmin && overlay.querySelector('#cp-approval')?.value === '已上架' ? new Date().toISOString() : (d.approvedAt || d.approved_at || null),
        notes: overlay.querySelector('#cp-notes').value.trim(),
        updatedAt: new Date().toISOString()
      };
      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = '保存中...';
        }
        if (isEdit && d.id) {
          await Store.update('creativeProducts', d.id, record);
          UI.toast(Auth.isAdmin ? '产品已更新，列表已刷新' : '产品已更新，等待管理员确认，列表已刷新');
        } else {
          await Store.add('creativeProducts', createCreativeProduct(record));
          UI.toast(Auth.isAdmin ? '产品已新增，列表已刷新' : '产品已提交待确认，列表已刷新');
        }
        await UI._loadCreativeProducts();
        await UI._refreshCurrentProductTab();
        overlay.remove();
      } catch (e) {
        UI.toast('保存失败：' + (e.message || e), 'error');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '保存修改' : '创建产品';
        }
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

  async _approveCreativeProduct(id) {
    if (!this._canApproveProducts()) { this.toast('仅管理员可确认上架', 'error'); return; }
    await Store.update('creativeProducts', id, {
      approvalStatus: '已上架',
      approvedBy: Auth.currentUser?.displayName || Auth.currentUser?.username || '',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.toast('产品已上架');
    await this._loadCreativeProducts();
    this._refreshCurrentProductTab();
  },

  async _unlistCreativeProduct(id) {
    if (!this._canApproveProducts()) { this.toast('仅管理员可下架', 'error'); return; }
    if (!confirm('确认下架该产品？下架后不会出现在收银台可选列表。')) return;
    await Store.update('creativeProducts', id, {
      approvalStatus: '已下架',
      updatedAt: new Date().toISOString()
    });
    this.toast('产品已下架');
    await this._loadCreativeProducts();
    this._refreshCurrentProductTab();
  },

  async _deleteCreativeProduct(id) {
    if (!this._canDeleteCatalog()) { this.toast('仅管理员可删除', 'error'); return; }
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
            await Store.add('creativeProducts', createCreativeProduct({
              ...row,
              approvalStatus: Auth.isAdmin ? '已上架' : '待确认',
              submittedBy: Auth.currentUser?.displayName || Auth.currentUser?.username || ''
            }));
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
              const isBeverage = this._cpBool(this._getCPField(r, ['是否饮料','饮料','isBeverage','is_beverage']), false);
              return {
                name: String(nameVal || '').trim(),
                standardName: String(this._getCPField(r, ['标准名称','归一名称','standardName','standard_name']) || nameVal || '').trim(),
                businessTypeCode: this._normalizeCpBusinessType(this._getCPField(r, ['业务归属','业务类型','businessTypeCode','business_type_code']), isBeverage),
                packageSpec: String(this._getCPField(r, ['包装规格','规格','packageSpec','package_spec']) || '').trim(),
                barcode: String(this._getCPField(r, ['条码','barcode','Barcode']) || '').trim(),
                isBeverage,
                isCountableStock: this._cpBool(this._getCPField(r, ['是否计库存','参与库存计数','isCountableStock','is_countable_stock']), true),
                isActive: this._cpBool(this._getCPField(r, ['是否启用','参与经营统计','isActive','is_active']), true),
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
              const isBeverage = this._cpBool(this._getCPField(row, ['是否饮料','饮料','isBeverage','is_beverage']), false);
              results.push({
                name: String(nameVal || '').trim(),
                standardName: String(this._getCPField(row, ['标准名称','归一名称','standardName','standard_name']) || nameVal || '').trim(),
                businessTypeCode: this._normalizeCpBusinessType(this._getCPField(row, ['业务归属','业务类型','businessTypeCode','business_type_code']), isBeverage),
                packageSpec: String(this._getCPField(row, ['包装规格','规格','packageSpec','package_spec']) || '').trim(),
                barcode: String(this._getCPField(row, ['条码','barcode','Barcode']) || '').trim(),
                isBeverage,
                isCountableStock: this._cpBool(this._getCPField(row, ['是否计库存','参与库存计数','isCountableStock','is_countable_stock']), true),
                isActive: this._cpBool(this._getCPField(row, ['是否启用','参与经营统计','isActive','is_active']), true),
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
    if (!Auth.can('export', 'creative-products')) {
      this.toast('当前账号无权限导出产品数据', 'error');
      return;
    }
    await this._loadCreativeProducts();
    if (!this._creativeProducts.length) { this.toast('没有产品可导出', 'error'); return; }
    const headers = ['产品名称','标准名称','业务归属','包装规格','条码','是否饮料','是否计库存','是否启用','SKU','供应商','进货价','零售价','库存','单位','备注'];
    const rows = this._creativeProducts.map(p => [
      p.name || '',
      p.standardName || p.standard_name || p.name || '',
      this._cpBusinessTypeLabel(p.businessTypeCode || p.business_type_code, this._cpBool(p.isBeverage ?? p.is_beverage, false)),
      p.packageSpec || p.package_spec || '',
      p.barcode || '',
      this._cpBool(p.isBeverage ?? p.is_beverage, false) ? '是' : '否',
      this._cpBool(p.isCountableStock ?? p.is_countable_stock, true) ? '是' : '否',
      this._cpBool(p.isActive ?? p.is_active, true) ? '是' : '否',
      p.sku || '', p.supplier || '',
      (+p.costPrice || 0).toFixed(2), (+p.retailPrice || 0).toFixed(2),
      p.stock || 0, p.unit || '个', p.notes || ''
    ]);
    this._downloadCSV(headers, rows, '文创产品列表');
  },

  async _exportCreativeSales() {
    if (!Auth.can('export', 'creative-products')) {
      this.toast('当前账号无权限导出销售清单', 'error');
      return;
    }
    const { start, end } = ImportExport._getExportDates();
    await this._loadCreativeProducts();
    const productMetaByName = this._creativeProductMetaMap();
    const all = await Store.getAll('revenue');
    let records = ImportExport._filterByDateRange(all, start, end);
    // 只筛选有文创产品的记录
    records = records.filter(r => {
      const items = Array.isArray(r.retailItems) ? r.retailItems : [];
      return items.length > 0;
    });
    if (!records.length) { this.toast('所选范围内无文创销售记录', 'error'); return; }

    // 展开每条 retailItems
    const headers = ['日期','产品名称','标准名称','业务归属','包装规格','是否饮料','供应商','进货价','数量','单价','金额','收款方式','经手人','备注','创建时间'];
    const rows = [];
    // 字段名兼容：服务端 toCamel 不递归 JSONB 数组，所以读出来时是 snake（product_name/unit_price）；
    // 少数旧数据可能保留录入时的 camel（productName/unitPrice）。两种都要支持。
    const itemName = i => i.productName ?? i.product_name ?? '';
    const itemPrice = i => i.unitPrice ?? i.unit_price ?? 0;
    records.forEach(r => {
      const items = Array.isArray(r.retailItems) ? r.retailItems : [];
      items.forEach(item => {
        const name = itemName(item);
        const meta = productMetaByName.get(this._normalizeCreativeProductName(name)) || {};
        rows.push([
          r.date,
          name,
          meta.standardName || '',
          meta.businessType || '',
          meta.packageSpec || '',
          meta.isBeverage ? '是' : '否',
          meta.supplier || '',
          meta.costPrice === '' ? '' : (+meta.costPrice || 0).toFixed(2),
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

  _creativeProductMetaMap() {
    const map = new Map();
    (this._creativeProducts || []).forEach(p => {
      const key = this._normalizeCreativeProductName(p.name || '');
      const meta = {
        standardName: p.standardName || p.standard_name || p.name || '',
        businessType: this._cpBusinessTypeLabel(p.businessTypeCode || p.business_type_code, this._cpBool(p.isBeverage ?? p.is_beverage, false)),
        packageSpec: p.packageSpec || p.package_spec || '',
        isBeverage: this._cpBool(p.isBeverage ?? p.is_beverage, false),
        supplier: p.supplier || '',
        costPrice: p.costPrice ?? p.cost_price ?? ''
      };
      if (key && !map.has(key)) {
        map.set(key, meta);
      }
      const standardKey = this._normalizeCreativeProductName(p.standardName || p.standard_name || '');
      if (standardKey && !map.has(standardKey)) map.set(standardKey, meta);
    });
    return map;
  },

  _normalizeCreativeProductName(name) {
    return String(name || '').trim().toLowerCase();
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
    const headers = ['产品名称','标准名称','业务归属','包装规格','条码','是否饮料','是否计库存','是否启用','SKU','供应商','进货价','零售价','库存','单位','备注'];
    const example = ['纯悦水','纯悦水','饮料零售','550ml 瓶装','','是','是','是','DR-001','示例供应商','1.8','4','100','瓶','示例饮料'];
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
            await Store.add('artworks', createArtwork({
              ...row,
              approvalStatus: Auth.isAdmin ? '已上架' : '待确认',
              submittedBy: Auth.currentUser?.displayName || Auth.currentUser?.username || ''
            }));
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

  // === 日结报表 ===
  async renderDailyClosingPage() {
    const page = $('#page-daily-closing');
    if (!Auth.hasModuleAccess('daily-closing')) { this._noAccess(page); return; }
    const date = this._dailyClosingDate || todayStr();
    html(page, `
      <div>
        <div class="card-title">📋 日结报表</div>
        <div class="filter-bar">
          <div class="form-group"><label>日结日期</label><input type="date" id="daily-close-date" value="${date}" onchange="UI._reloadDailyClosing()"></div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('daily-close-date').value='${todayStr()}'; UI._reloadDailyClosing()">今天</button>
          <button type="button" class="btn btn-sm btn-primary" onclick="UI._loadDailyClosing()">刷新</button>
          <span style="font-size:12px;color:var(--gray-500);margin-left:auto" id="daily-close-status"></span>
        </div>
        <div id="daily-closing-month-list" style="margin-bottom:16px"></div>
        <div id="daily-closing-body"><div class="loading-state" style="padding:40px"><div class="spinner"></div><span>加载日结数据...</span></div></div>
      </div>
    `);
    await this._loadDailyClosing();
  },

  _sumBy(rows, key, valueKey = 'netAmount') {
    return rows.reduce((acc, row) => {
      const name = row[key] || '未分类';
      acc[name] = (acc[name] || 0) + (+row[valueKey] || 0);
      return acc;
    }, {});
  },

  _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  _rowsFromSummary(obj, labelName = '项目', labelMap = {}) {
    const entries = Object.entries(obj || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (!entries.length) return `<tr><td colspan="2" style="color:var(--gray-500)">暂无数据</td></tr>`;
    return entries.map(([label, value]) => `<tr><td>${this._esc(labelMap[label] || label)}</td><td><strong>¥${this._fmt(value)}</strong></td></tr>`).join('');
  },

  async _reloadDailyClosing() {
    this._dailyClosingDate = document.getElementById('daily-close-date')?.value || todayStr();
    await this._loadDailyClosing();
  },

  async _openDailyClosingDate(date) {
    if (!date) return;
    this._dailyClosingDate = date;
    const input = document.getElementById('daily-close-date');
    if (input) input.value = date;
    await this._loadDailyClosing();
  },

  _monthRangeFromDate(date) {
    const ym = (date || todayStr()).slice(0, 7);
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { ym, start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` };
  },

  _monthLedgerDates(ym) {
    const today = todayStr();
    const currentYm = today.slice(0, 7);
    const [year, month] = ym.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const endDay = ym === currentYm ? Number(today.slice(8, 10)) : (ym < currentYm ? lastDay : 0);
    const dates = [];
    for (let day = endDay; day >= 1; day--) {
      dates.push(`${ym}-${String(day).padStart(2, '0')}`);
    }
    return dates;
  },

  _summaryInline(obj, labelMap = {}) {
    const entries = Object.entries(obj || {})
      .filter(([, value]) => Math.abs(+value || 0) > 0.0001)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (!entries.length) return '<span style="color:var(--gray-500)">-</span>';
    return entries.map(([label, value]) => `
      <div style="white-space:nowrap">${this._esc(labelMap[label] || label)} <strong>¥${this._fmt(value)}</strong></div>
    `).join('');
  },

  _renderDailyClosingMonthList(closings, selectedDate, ym, facts = []) {
    const closingsByDate = new Map((closings || []).map(c => [c.date, c]));
    const factsByDate = (facts || []).reduce((acc, row) => {
      if (!row.date) return acc;
      if (!acc.has(row.date)) acc.set(row.date, []);
      acc.get(row.date).push(row);
      return acc;
    }, new Map());
    const dates = [...new Set([
      ...this._monthLedgerDates(ym),
      ...factsByDate.keys(),
      ...closingsByDate.keys()
    ])]
      .filter(d => String(d || '').startsWith(ym))
      .sort((a, b) => String(b || '').localeCompare(String(a || '')));
    const statusClass = (status) => status === '已复核' ? 'tag-success' : status === '已确认' ? 'tag-info' : status === '未结存' ? 'tag-danger' : 'tag-warning';
    const diffColor = (value) => (+value || 0) === 0 ? 'var(--gray-700)' : (+value || 0) > 0 ? 'var(--green-700)' : 'var(--red)';
    const tableRows = dates.length ? dates.map(date => {
      const c = closingsByDate.get(date) || null;
      const dayFacts = factsByDate.get(date) || [];
      const byCategory = dayFacts.length
        ? this._sumBy(dayFacts, 'category')
        : (c?.revenueSummary?.byCategory || c?.revenue_summary?.byCategory || {});
      const byPayment = dayFacts.length
        ? this._sumBy(dayFacts.filter(r => (+r.netAmount || 0) > 0), 'paymentMethod')
        : (c?.paymentSummary || c?.payment_summary || {});
      const systemNet = dayFacts.length
        ? dayFacts.reduce((s, r) => s + (+r.netAmount || 0), 0)
        : +(c?.systemNetAmount ?? c?.system_net_amount ?? 0);
      const confirmed = c ? +(c.confirmedAmount ?? c.confirmed_amount ?? 0) : null;
      const diff = c ? +(c.differenceAmount ?? c.difference_amount ?? ((confirmed || 0) - systemNet)) : null;
      const active = date === selectedDate ? ' style="background:var(--green-50)"' : '';
      const status = c ? (c.status || '草稿') : '未结存';
      const canQuickClose = Auth.can('create', 'daily-closing') && status !== '已确认' && status !== '已复核';
      const quickCloseBtn = canQuickClose
        ? `<button type="button" class="btn btn-sm btn-primary" onclick="UI._quickArchiveDailyClosing('${this._esc(date)}', this)">快速结存</button>`
        : '';
      return `
        <tr${active}>
          <td><strong>${this._esc(date)}</strong></td>
          <td><span class="tag ${statusClass(status)}">${this._esc(status)}</span></td>
          <td><strong>¥${this._fmt(systemNet)}</strong><div style="font-size:12px;color:var(--gray-500)">${dayFacts.length} 条收入事实</div></td>
          <td>${c ? `<strong>¥${this._fmt(confirmed)}</strong>` : '<span style="color:var(--gray-500)">待结存</span>'}</td>
          <td>${c ? `<strong style="color:${diffColor(diff)}">¥${this._fmt(diff)}</strong>` : '<span style="color:var(--gray-500)">-</span>'}</td>
          <td>${this._summaryInline(byCategory)}</td>
          <td>${this._summaryInline(byPayment)}</td>
          <td>${this._esc(c?.closerName || c?.closer_name || '-')}</td>
          <td><div class="row-actions">${quickCloseBtn}<button type="button" class="btn btn-sm btn-secondary" onclick="UI._openDailyClosingDate('${this._esc(date)}')">查看</button></div></td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="9" style="color:var(--gray-500)">本月暂无收入事实或日结记录</td></tr>';

    return `
      <div class="card">
        <div class="card-title">${ym} 日结台账</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>日期</th><th>结存状态</th><th>系统净收入</th><th>实收确认</th><th>差异</th><th>品类收入</th><th>收款方式</th><th>结账人</th><th>操作</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  async _quickArchiveDailyClosing(date, btn) {
    if (!Auth.can('create', 'daily-closing')) {
      this.toast('当前账号无权限结存日结', 'error');
      return;
    }
    if (!date) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '结存中...';
    }
    try {
      const [facts, expenses, adjustments, cashMovements, closings] = await Promise.all([
        Store.getByDateRange('revenueFacts', date, date),
        Store.getByDateRange('expense', date, date),
        Store.getAll('transactionAdjustments'),
        Store.getAll('cashMovements'),
        Store.getByDateRange('dailyClosings', date, date)
      ]);
      const dayFacts = (facts || []).filter(r => r.date === date);
      const dayExpenses = (expenses || []).filter(r => r.date === date);
      const dayAdjustments = (adjustments || []).filter(a => UI._fmtBeijingTime(a.createdAt || a.created_at).slice(0, 10) === date);
      const dayCashMovements = (cashMovements || []).filter(m => m.date === date);
      const closing = (closings || []).find(c => c.date === date) || null;
      if (closing?.status === '已复核') {
        this.toast('该日期已复核，无需快速结存');
        await this._openDailyClosingDate(date);
        return;
      }
      const systemNet = dayFacts.reduce((s, r) => s + (+r.netAmount || 0), 0);
      const grossPositive = dayFacts.filter(r => (+r.netAmount || 0) > 0).reduce((s, r) => s + (+r.netAmount || 0), 0);
      const refundTotal = dayFacts.filter(r => (+r.netAmount || 0) < 0).reduce((s, r) => s + (+r.netAmount || 0), 0);
      const operationalDayExpenses = dayExpenses.filter(isOperationalExpenseRecord);
      const bySource = this._sumBy(dayFacts, 'source');
      const byCategory = this._sumBy(dayFacts, 'category');
      const byPayment = this._sumBy(dayFacts.filter(r => (+r.netAmount || 0) > 0), 'paymentMethod');
      const cashOpening = this._sumCashMovements(cashMovements, m => m.date < date);
      const cashIn = this._sumCashMovements(dayCashMovements, m => (+m.amount || 0) > 0);
      const cashDeposit = -this._sumCashMovements(dayCashMovements, m => m.type === 'cash_deposit');
      const cashOut = -this._sumCashMovements(dayCashMovements, m => (+m.amount || 0) < 0 && m.type !== 'cash_deposit');
      const cashClosing = cashOpening + this._sumCashMovements(dayCashMovements);
      const adjustmentSummary = dayAdjustments.reduce((acc, a) => {
        const key = a.action || 'adjustment';
        acc[key] = (acc[key] || 0) + (+a.amount || 0);
        return acc;
      }, {});
      const record = createDailyClosing({
        id: closing?.id || undefined,
        date,
        systemNetAmount: systemNet,
        confirmedAmount: systemNet,
        differenceAmount: 0,
        revenueSummary: { bySource, byCategory, facts: dayFacts.length, grossPositive, refundTotal },
        paymentSummary: byPayment,
        expenseSummary: {
          expenseOut: operationalDayExpenses.reduce((s, r) => s + (+r.amount || 0), 0),
          pendingReceipt: operationalDayExpenses.filter(r => r.receiptStatus === '待补' || r.invoiceStatus === '待补').length,
          count: operationalDayExpenses.length
        },
        adjustmentSummary,
        cashSummary: { cashOpening, cashIn, cashDeposit, cashOut, cashClosing, count: dayCashMovements.length },
        closerId: Auth.currentUser?.id || '',
        closerName: Auth.currentUser?.displayName || Auth.currentUser?.username || '',
        reviewerName: closing?.reviewerName || closing?.reviewer_name || '',
        status: '已确认',
        notes: closing?.notes || ''
      });
      record.updatedAt = new Date().toISOString();
      if (closing?.id) {
        await Store.update('dailyClosings', closing.id, record);
      } else {
        await Store.add('dailyClosings', record);
      }
      this.toast(`${date} 已快速结存`);
      await this._openDailyClosingDate(date);
    } catch (e) {
      this.toast('快速结存失败：' + (e.message || e), 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '快速结存';
      }
    }
  },

  async _loadDailyClosing() {
    const body = $('#daily-closing-body');
    if (!body) return;
    const date = document.getElementById('daily-close-date')?.value || this._dailyClosingDate || todayStr();
    this._dailyClosingDate = date;
    const statusEl = $('#daily-close-status');
    if (statusEl) statusEl.textContent = '加载中...';
    const monthListEl = $('#daily-closing-month-list');
    const monthRange = this._monthRangeFromDate(date);
    if (monthListEl) monthListEl.innerHTML = '<div class="card"><div class="loading-state" style="padding:24px"><div class="spinner"></div><span>加载本月日结列表...</span></div></div>';

    const canEditDaily = Auth.can('create', 'daily-closing');
    const [monthFacts, expenses, adjustments, cashMovements, monthClosings] = await Promise.all([
      Store.getByDateRange('revenueFacts', monthRange.start, monthRange.end),
      canEditDaily ? Store.getByDateRange('expense', date, date) : Promise.resolve([]),
      canEditDaily ? Store.getAll('transactionAdjustments') : Promise.resolve([]),
      canEditDaily ? Store.getAll('cashMovements') : Promise.resolve([]),
      Store.getByDateRange('dailyClosings', monthRange.start, monthRange.end)
    ]);
    if (monthListEl) monthListEl.innerHTML = this._renderDailyClosingMonthList(monthClosings, date, monthRange.ym, monthFacts);

    const dayFacts = (monthFacts || []).filter(r => r.date === date);
    const dayExpenses = (expenses || []).filter(r => r.date === date);
    const dayAdjustments = (adjustments || []).filter(a => UI._fmtBeijingTime(a.createdAt || a.created_at).slice(0, 10) === date);
    const dayCashMovements = (cashMovements || []).filter(m => m.date === date);
    const closing = (monthClosings || []).find(c => c.date === date) || null;

    const systemNet = dayFacts.reduce((s, r) => s + (+r.netAmount || 0), 0);
    const grossPositive = dayFacts.filter(r => (+r.netAmount || 0) > 0).reduce((s, r) => s + (+r.netAmount || 0), 0);
    const refundTotal = dayFacts.filter(r => (+r.netAmount || 0) < 0).reduce((s, r) => s + (+r.netAmount || 0), 0);
    const operationalDayExpenses = dayExpenses.filter(isOperationalExpenseRecord);
    const expenseOut = operationalDayExpenses.reduce((s, r) => s + (+r.amount || 0), 0);
    const pendingReceipt = operationalDayExpenses.filter(r => r.receiptStatus === '待补' || r.invoiceStatus === '待补').length;
    const bySource = this._sumBy(dayFacts, 'source');
    const byCategory = this._sumBy(dayFacts, 'category');
    const byPayment = this._sumBy(dayFacts.filter(r => (+r.netAmount || 0) > 0), 'paymentMethod');
    const cashOpening = this._sumCashMovements(cashMovements, m => m.date < date);
    const cashIn = this._sumCashMovements(dayCashMovements, m => (+m.amount || 0) > 0);
    const cashDeposit = -this._sumCashMovements(dayCashMovements, m => m.type === 'cash_deposit');
    const cashOut = -this._sumCashMovements(dayCashMovements, m => (+m.amount || 0) < 0 && m.type !== 'cash_deposit');
    const cashClosing = cashOpening + this._sumCashMovements(dayCashMovements);
    const cashSummary = { cashOpening, cashIn, cashDeposit, cashOut, cashClosing, count: dayCashMovements.length };
    const adjustmentSummary = dayAdjustments.reduce((acc, a) => {
      const key = a.action || 'adjustment';
      acc[key] = (acc[key] || 0) + (+a.amount || 0);
      return acc;
    }, {});

    const confirmed = closing ? (+closing.confirmedAmount || 0) : systemNet;
    const diff = confirmed - systemNet;
    const status = closing?.status || '未保存';
    const statusClass = status === '已复核' ? 'tag-success' : status === '已确认' ? 'tag-info' : 'tag-warning';
    if (statusEl) statusEl.innerHTML = `<span class="tag ${statusClass}">${status}</span>`;

    const adjustmentRows = dayAdjustments.length ? dayAdjustments.map(a => `
      <tr>
        <td>${UI._fmtBeijingTime(a.createdAt || a.created_at)}</td>
        <td>${this._esc(a.targetType || '')}</td>
        <td>${this._esc(a.action || '')}</td>
        <td><strong>¥${this._fmt(a.amount || 0)}</strong></td>
        <td>${this._esc(a.operatorName || '')}</td>
        <td>${this._esc(a.reason || '')}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" style="color:var(--gray-500)">暂无退款/作废调整</td></tr>';

    html(body, `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">系统净收入</div><div class="stat-value">¥${this._fmt(systemNet)}</div><div class="stat-sub">${dayFacts.length} 条收入事实</div></div>
        <div class="stat-card"><div class="stat-label">正向收入</div><div class="stat-value">¥${this._fmt(grossPositive)}</div><div class="stat-sub">退款前口径</div></div>
        <div class="stat-card"><div class="stat-label">退款扣减</div><div class="stat-value" style="color:var(--red)">¥${this._fmt(refundTotal)}</div><div class="stat-sub">${dayAdjustments.length} 条调整流水</div></div>
        <div class="stat-card"><div class="stat-label">运营支出</div><div class="stat-value" style="color:var(--red)">¥${this._fmt(expenseOut)}</div><div class="stat-sub">${pendingReceipt} 条票据待补</div></div>
      </div>

      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">柜台现金期初</div><div class="stat-value">¥${this._fmt(cashOpening)}</div><div class="stat-sub">截至前一日</div></div>
        <div class="stat-card"><div class="stat-label">现金收款</div><div class="stat-value">¥${this._fmt(cashIn)}</div><div class="stat-sub">${dayCashMovements.filter(m => (+m.amount || 0) > 0).length} 条入柜台流水</div></div>
        <div class="stat-card"><div class="stat-label">存现金</div><div class="stat-value" style="color:var(--green-700)">¥${this._fmt(cashDeposit)}</div><div class="stat-sub">转为账户资金，不新增收入</div></div>
        <div class="stat-card"><div class="stat-label">柜台现金期末</div><div class="stat-value">¥${this._fmt(cashClosing)}</div><div class="stat-sub">现金退款/冲销 ¥${this._fmt(cashOut)}</div></div>
      </div>

      <div class="stats-grid" style="margin-bottom:16px">
        <div class="card">
          <div class="card-title">按来源</div>
          <div class="table-wrap"><table class="data-table"><tbody>${this._rowsFromSummary(bySource, '项目', { pos: '收银台' })}</tbody></table></div>
        </div>
        <div class="card">
          <div class="card-title">按品类</div>
          <div class="table-wrap"><table class="data-table"><tbody>${this._rowsFromSummary(byCategory)}</tbody></table></div>
        </div>
        <div class="card">
          <div class="card-title">收款方式</div>
          <div class="table-wrap"><table class="data-table"><tbody>${this._rowsFromSummary(byPayment)}</tbody></table></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">退款/作废/调整流水</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>时间</th><th>对象</th><th>动作</th><th>金额</th><th>操作人</th><th>原因</th></tr></thead>
            <tbody>${adjustmentRows}</tbody>
          </table>
        </div>
      </div>

      ${Auth.can('create', 'daily-closing') ? `<div class="card">
        <div class="card-title">日结确认</div>
        <div class="form-grid">
          <div class="form-group"><label>系统净收入</label><input type="number" id="daily-system-net" value="${systemNet.toFixed(2)}" readonly></div>
          <div class="form-group"><label>实收确认金额</label><input type="number" id="daily-confirmed" value="${confirmed.toFixed(2)}" step="0.01" oninput="UI._updateDailyClosingDiff()"></div>
          <div class="form-group"><label>差异金额</label><input type="number" id="daily-diff" value="${diff.toFixed(2)}" readonly></div>
          <div class="form-group"><label>结账人</label><input type="text" id="daily-closer" value="${this._esc(closing?.closerName || Auth.currentUser?.displayName || '')}"></div>
          <div class="form-group"><label>复核人</label><input type="text" id="daily-reviewer" value="${this._esc(closing?.reviewerName || '')}"></div>
          <div class="form-group"><label>状态</label><select id="daily-status">
            ${['草稿','已确认','已复核'].map(s => `<option value="${s}"${s === (closing?.status || '草稿') ? ' selected' : ''}>${s}</option>`).join('')}
          </select></div>
          <div class="form-group full"><label>差异说明/备注</label><textarea id="daily-notes" rows="3">${this._esc(closing?.notes || '')}</textarea></div>
        </div>
        <div class="form-actions full">
          <button type="button" class="btn btn-primary" onclick="UI._saveDailyClosing()">保存日结</button>
        </div>
      </div>` : ''}
    `);

    this._dailyClosingSnapshot = {
      existingId: closing?.id || '',
      date,
      systemNet,
      revenueSummary: { bySource, byCategory, facts: dayFacts.length, grossPositive, refundTotal },
      paymentSummary: byPayment,
      expenseSummary: { expenseOut, pendingReceipt, count: operationalDayExpenses.length },
      adjustmentSummary,
      cashSummary
    };
  },

  _updateDailyClosingDiff() {
    const systemNet = +($('#daily-system-net')?.value || 0);
    const confirmed = +($('#daily-confirmed')?.value || 0);
    const diff = $('#daily-diff');
    if (diff) diff.value = (confirmed - systemNet).toFixed(2);
  },

  async _saveDailyClosing() {
    const snap = this._dailyClosingSnapshot;
    if (!snap) { this.toast('请先加载日结数据', 'error'); return; }
    const confirmedAmount = +($('#daily-confirmed')?.value || 0);
    const status = $('#daily-status')?.value || '草稿';
    if (status === '已复核' && !Auth.isAdmin) {
      this.toast('仅管理员可标记为已复核', 'error');
      return;
    }
    const record = createDailyClosing({
      id: snap.existingId || undefined,
      date: snap.date,
      systemNetAmount: snap.systemNet,
      confirmedAmount,
      differenceAmount: confirmedAmount - snap.systemNet,
      revenueSummary: snap.revenueSummary,
      paymentSummary: snap.paymentSummary,
      expenseSummary: snap.expenseSummary,
      adjustmentSummary: snap.adjustmentSummary,
      cashSummary: snap.cashSummary,
      closerId: Auth.currentUser?.id || '',
      closerName: $('#daily-closer')?.value.trim() || Auth.currentUser?.displayName || '',
      reviewerName: $('#daily-reviewer')?.value.trim() || '',
      status,
      notes: $('#daily-notes')?.value.trim() || ''
    });
    record.updatedAt = new Date().toISOString();
    if (snap.existingId) {
      await Store.update('dailyClosings', snap.existingId, record);
      this.toast('日结已更新');
    } else {
      const saved = await Store.add('dailyClosings', record);
      this._dailyClosingSnapshot.existingId = saved.id;
      this.toast('日结已保存');
    }
    await this._loadDailyClosing();
  },

  // === 数据报表 ===
  async renderReportsPage() {
    const page = $('#page-reports');
    const ym = todayStr().slice(0, 7);
    html(page, `
      <div class="filter-bar">
        <div class="form-group"><label>年份</label><select id="rpt-year" disabled onchange="UI._renderV2ManagementSummary();Charts._onFilterChange()">${this._yearOptions()}</select></div>
        <div class="form-group"><label>月份</label><select id="rpt-month" disabled onchange="UI._renderV2ManagementSummary();Charts._onFilterChange()">
          <option value="">全部</option>
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
            const ms = String(m).padStart(2, '0');
            return `<option value="${ms}"${ms === ym.slice(5) ? ' selected' : ''}>${m}月</option>`;
          }).join('')}
        </select></div>
        <button type="button" id="rpt-refresh" disabled class="btn btn-sm btn-secondary" onclick="UI._renderV2ManagementSummary();Charts.renderAll()">刷新图表</button>
      </div>
      <div id="v2-management-summary"><div class="loading-state"><div class="spinner"></div>加载 2.0 经营汇总…</div></div>
      <div id="report-charts"><div class="loading-state" style="text-align:center;padding:80px"><div class="spinner"></div><span style="margin-left:10px">加载报表数据中...</span></div></div>
    `);
    // 加载图表需要时间，延迟一帧让 loading 先显示
    setTimeout(async () => {
      await Charts.renderAll();
      await this._renderV2ManagementSummary();
      ['rpt-year','rpt-month','rpt-refresh'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
    }, 50);
  },

  async _renderV2ManagementSummary() {
    const target = $('#v2-management-summary');
    if (!target) return;
    const renderId = (this._v2SummaryRenderId || 0) + 1;
    this._v2SummaryRenderId = renderId;
    const year = $('#rpt-year')?.value || todayStr().slice(0,4);
    const month = $('#rpt-month')?.value || '';
    const prefix = month ? `${year}-${month}` : year;
    try {
      const [allSummary, allIssues, allBaseline, allAliasCandidates, allProductGovernance, allCostEvidence, allRevenueCandidates, allCostCandidates, allGalleryCandidates, allWorkshopCandidates, allSpaceCandidates, legacyFacts] = await Promise.all([
        Store._request('GET', '/rest/v1/business_layer_summary_v2?order=period_month.asc&limit=5000'),
        Store._request('GET', '/rest/v1/data_governance_issues_v2?order=business_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/data_governance_baseline_v2?order=period_month.asc&limit=5000'),
        Store._request('GET', '/rest/v1/product_alias_candidates_v2?order=affected_amount.desc&limit=5000'),
        Store._request('GET', '/rest/v1/product_master_governance_v2?order=affected_amount.desc&limit=5000'),
        Store._request('GET', '/rest/v1/product_cost_evidence_v2?order=evidence_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/revenue_attribution_candidates_v2?order=business_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/cost_attribution_candidates_v2?order=business_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/gallery_link_candidates_v2?order=business_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/workshop_link_candidates_v2?order=business_date.desc&limit=5000'),
        Store._request('GET', '/rest/v1/space_classification_candidates_v2?order=business_date.desc&limit=5000'),
        Store.getByYear('revenueFacts', year)
      ]);
      if (renderId !== this._v2SummaryRenderId) return;
      const layerDefs = [
        ['visit','到馆参观'],['onsite_consumption','现场消费'],['experience_activity','体验活动'],['art_transaction_cooperation','艺术交易与合作']
      ];
      const selected = (allSummary || []).filter(r => String(r.periodMonth || '').startsWith(prefix));
      const rows = layerDefs.map(([code,name]) => selected.filter(r => r.businessLayerCode === code).reduce((a,r) => ({
        code,name,revenue:a.revenue+(+r.revenueAmount||0),salesCost:a.salesCost+(+r.salesCostAmount||0),periodCost:a.periodCost+(+r.periodCostAmount||0),gross:a.gross+(+r.grossProfit||0),contribution:a.contribution+(+r.operatingContribution||0)
      }), {code,name,revenue:0,salesCost:0,periodCost:0,gross:0,contribution:0}));
      const totals = rows.reduce((a,r) => ({ revenue:a.revenue+r.revenue,salesCost:a.salesCost+r.salesCost,periodCost:a.periodCost+r.periodCost,gross:a.gross+r.gross,contribution:a.contribution+r.contribution }), {revenue:0,salesCost:0,periodCost:0,gross:0,contribution:0});
      const legacy = (legacyFacts || []).filter(r => String(r.date || '').startsWith(prefix)).reduce((s,r) => s + Number(r.netAmount ?? r.amount ?? 0), 0);
      const diff = totals.revenue - legacy;
      const issues = (allIssues || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      const baseline = (allBaseline || []).filter(r => String(r.periodMonth || '').startsWith(prefix));
      this._v2GovernanceExport = { prefix, issues, baseline };
      this._v2AliasCandidates = allAliasCandidates || [];
      this._v2AliasCandidateFilter = this._v2AliasCandidateFilter || '';
      this._v2ProductGovernance = allProductGovernance || [];
      this._v2CostEvidence = allCostEvidence || [];
      this._v2ProductGovernanceFilter = this._v2ProductGovernanceFilter || '';
      this._v2RevenueAttribution = (allRevenueCandidates || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      this._v2RevenueAttributionPeriod = prefix;
      this._v2RevenueAttributionFilter = this._v2RevenueAttributionFilter || '';
      this._v2CostAttribution = (allCostCandidates || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      this._v2CostAttributionPeriod = prefix;
      this._v2CostAttributionFilter = this._v2CostAttributionFilter || '';
      this._v2GalleryLinks = (allGalleryCandidates || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      this._v2GalleryLinksPeriod = prefix;
      this._v2GalleryLinksFilter = this._v2GalleryLinksFilter || '';
      this._v2WorkshopLinks = (allWorkshopCandidates || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      this._v2WorkshopLinksPeriod = prefix;
      this._v2WorkshopLinksFilter = this._v2WorkshopLinksFilter || '';
      this._v2SpaceClassification = (allSpaceCandidates || []).filter(r => String(r.businessDate || '').startsWith(prefix));
      this._v2SpaceClassificationPeriod = prefix;
      this._v2SpaceClassificationFilter = this._v2SpaceClassificationFilter || '';
      const issueCount = key => issues.filter(r => r.issueType === key).length;
      const issueAmount = key => baseline.filter(r => r.issueType === key).reduce((sum,r) => sum + (+r.affectedAmount || 0), 0);
      const labels = {unclassified_revenue:'待归类收入',unclassified_cost:'待归类成本',missing_product_cost:'缺成本商品'};
      target.innerHTML = `
        <div class="card">
          <div class="card-title">2.0 业务层经营汇总 <span class="tag tag-info">只读并行口径</span></div>
          <div class="stat-card-grid" style="margin-bottom:16px">
            <div class="stat-card"><div class="stat-label">2.0 净收入</div><div class="stat-value">¥${this._fmt(totals.revenue)}</div><div class="stat-sub">${prefix} · 四业务层</div></div>
            <div class="stat-card"><div class="stat-label">销售成本</div><div class="stat-value">¥${this._fmt(totals.salesCost)}</div><div class="stat-sub">商品销售成本 + 作品结算</div></div>
            <div class="stat-card"><div class="stat-label">销售毛利</div><div class="stat-value">¥${this._fmt(totals.gross)}</div><div class="stat-sub">净收入 - 销售成本</div></div>
            <div class="stat-card"><div class="stat-label">经营贡献</div><div class="stat-value">¥${this._fmt(totals.contribution)}</div><div class="stat-sub">再扣期间成本 ¥${this._fmt(totals.periodCost)}</div></div>
          </div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>业务层</th><th>净收入</th><th>销售成本</th><th>期间成本</th><th>销售毛利</th><th>毛利率</th><th>经营贡献</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r.name}</strong></td><td>¥${this._fmt(r.revenue)}</td><td>¥${this._fmt(r.salesCost)}</td><td>¥${this._fmt(r.periodCost)}</td><td>¥${this._fmt(r.gross)}</td><td>${r.revenue ? (r.gross/r.revenue*100).toFixed(1)+'%' : '-'}</td><td>¥${this._fmt(r.contribution)}</td></tr>`).join('')}</tbody></table></div>
          <p class="form-hint">1.0 净收入 ¥${this._fmt(legacy)}；2.0 四层净收入 ¥${this._fmt(totals.revenue)}；差异 ${diff >= 0 ? '+' : ''}¥${this._fmt(diff)}。2.0 按业务明细和实际到账日归属；待归类收入留在治理清单、不计入四层总计。原 1.0 图表保留在下方用于对照。</p>
        </div>
        <div class="card" id="v2-governance-card">
          <div class="card-title">数据治理基线 <button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2GovernanceIssues()" ${issues.length ? '' : 'disabled'}>导出治理清单</button></div>
          <div class="stat-card-grid" style="margin-bottom:16px"><div class="stat-card"><div class="stat-label">待归类收入</div><div class="stat-value">${issueCount('unclassified_revenue')}</div><div class="stat-sub">影响金额 ¥${this._fmt(issueAmount('unclassified_revenue'))}</div></div><div class="stat-card"><div class="stat-label">待归类成本</div><div class="stat-value">${issueCount('unclassified_cost')}</div><div class="stat-sub">影响金额 ¥${this._fmt(issueAmount('unclassified_cost'))}</div></div><div class="stat-card"><div class="stat-label">缺成本商品/作品</div><div class="stat-value">${issueCount('missing_product_cost')}</div><div class="stat-sub">需补成本证据</div></div></div>
          ${issues.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>问题 ID</th><th>日期</th><th>优先级</th><th>问题</th><th>项目/商品</th><th>金额</th><th>来源</th></tr></thead><tbody>${issues.slice(0,50).map(r => `<tr><td><code>${this._escHtml(r.issueId)}</code></td><td>${this._escHtml(r.businessDate)}</td><td><span class="tag ${r.priority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(r.priority)}</span></td><td>${this._escHtml(labels[r.issueType] || r.issueType)}</td><td>${this._escHtml(r.itemName)}</td><td>¥${this._fmt(r.amount)}</td><td>${this._escHtml(r.sourceTable)} / ${this._escHtml(r.sourceId)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">当前期间未发现待归类或缺成本问题</div>'}
          ${issues.length > 50 ? '<p class="form-hint">仅显示最近 50 条，请按来源记录继续治理。</p>' : ''}
        </div>
        ${this._productAliasCandidatesHtml()}
        ${this._productGovernanceHtml()}
        ${this._revenueAttributionHtml()}
        ${this._costAttributionHtml()}
        ${this._galleryLinksHtml()}
        ${this._workshopLinksHtml()}
        ${this._spaceClassificationHtml()}`;
    } catch (error) {
      if (renderId !== this._v2SummaryRenderId) return;
      target.innerHTML = `<div class="card"><div class="card-title">2.0 经营汇总</div><div class="empty-state">当前账号无权读取 2.0 管理事实，或汇总尚未迁移。原 1.0 图表仍可继续使用。</div></div>`;
    }
  },

  _exportV2GovernanceIssues() {
    const snapshot = this._v2GovernanceExport;
    const rows = snapshot?.issues || [];
    if (!rows.length) return this.toast('当前筛选期间没有可导出的治理问题', 'error');
    const headers = ['问题ID','优先级','问题类型','问题分组','业务日期','项目/商品','影响金额','来源表','来源ID','明细键','问题说明','稳定问题键'];
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers, ...rows.map(r => [r.issueId,r.priority,r.issueType,r.issueGroup,r.businessDate,r.itemName,r.amount,r.sourceTable,r.sourceId,r.sourceLineKey,r.issueDetail,r.issueKey])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `数据治理基线-${snapshot.prefix}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast(`已导出 ${rows.length} 条治理问题`);
  },

  _productAliasCandidatesHtml() {
    const allRows = this._v2AliasCandidates || [];
    const filter = this._v2AliasCandidateFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {
      matched: '已精确匹配',
      unique_candidate: '唯一候选',
      ambiguous: '存在歧义',
      no_candidate: '无候选'
    };
    const tagClass = { matched:'tag-success', unique_candidate:'tag-info', ambiguous:'tag-warning', no_candidate:'tag-danger' };
    const count = status => allRows.filter(r => r.candidateStatus === status).length;
    return `<div class="card" id="v2-alias-candidates-card">
      <div class="card-title">历史商品别名候选 <span class="tag tag-info">只读建议</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2AliasCandidates()" ${rows.length ? '' : 'disabled'}>导出候选清单</button></div>
      <p class="form-hint">覆盖全部历史零售明细，不受上方年/月筛选影响。售价只用于精确同名商品之间的辅助消歧；候选不会自动写入商品别名或改写历史流水。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">已精确匹配</div><div class="stat-value">${count('matched')}</div><div class="stat-sub">已有别名或历史映射</div></div>
        <div class="stat-card"><div class="stat-label">唯一候选</div><div class="stat-value">${count('unique_candidate')}</div><div class="stat-sub">等待人工确认</div></div>
        <div class="stat-card"><div class="stat-label">存在歧义</div><div class="stat-value">${count('ambiguous')}</div><div class="stat-sub">禁止自动处理</div></div>
        <div class="stat-card"><div class="stat-label">无候选</div><div class="stat-value">${count('no_candidate')}</div><div class="stat-sub">需补主数据或人工判断</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="alias-candidate-status" onchange="UI._filterV2AliasCandidates(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-alias-candidates-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>历史名称</th><th>售价</th><th>状态</th><th>建议标准商品</th><th>候选数</th><th>影响明细/金额</th><th>期间</th></tr></thead><tbody>${rows.slice(0,50).map(r => `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td><strong>${this._escHtml(r.aliasName)}</strong></td><td>¥${this._fmt(r.unitPrice)}</td><td><span class="tag ${tagClass[r.candidateStatus] || 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td><td>${r.suggestedStandardName ? `${this._escHtml(r.suggestedStandardName)}${r.suggestedPackageSpec ? ` · ${this._escHtml(r.suggestedPackageSpec)}` : ''}` : '-'}</td><td>${r.candidateCount}</td><td>${r.lineCount} 条 / ¥${this._fmt(r.affectedAmount)}</td><td>${this._escHtml(r.firstBusinessDate)} 至 ${this._escHtml(r.lastBusinessDate)}</td></tr>`).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示影响金额最高的 50 组，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前状态没有历史商品别名候选</div>'}</div>
    </div>`;
  },

  _filterV2AliasCandidates(status) {
    this._v2AliasCandidateFilter = status || '';
    const card = $('#v2-alias-candidates-card');
    if (card) card.outerHTML = this._productAliasCandidatesHtml();
  },

  _exportV2AliasCandidates() {
    const filter = this._v2AliasCandidateFilter || '';
    const rows = (this._v2AliasCandidates || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的商品别名候选', 'error');
    const headers = ['候选ID','历史名称','标准化名称','历史售价','状态','匹配依据','置信度','候选数','建议商品ID','建议标准名','建议规格','建议业务类型','明细数','影响记录数','销售数量','影响金额','最早日期','最晚日期','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers, ...rows.map(r => [r.candidateId,r.aliasName,r.normalizedAlias,r.unitPrice,r.candidateStatus,r.candidateBasis,r.confidence,r.candidateCount,r.suggestedProductId,r.suggestedStandardName,r.suggestedPackageSpec,r.suggestedBusinessTypeCode,r.lineCount,r.affectedRecordCount,r.totalQuantity,r.affectedAmount,r.firstBusinessDate,r.lastBusinessDate,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `历史商品别名候选-${filter || '全部'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast(`已导出 ${rows.length} 组商品别名候选`);
  },

  _productGovernanceHtml() {
    const allRows = this._v2ProductGovernance || [];
    const evidence = this._v2CostEvidence || [];
    const filter = this._v2ProductGovernanceFilter || '';
    const rows = filter ? allRows.filter(r => r.governanceStatus === filter) : allRows;
    const labels = {
      complete: '资料完整',
      classification_review: '分类待补',
      cost_evidence_review: '成本证据待补',
      classification_and_cost_review: '分类与成本待补'
    };
    const costLabels = {
      verified_sale_snapshots: '历史成交快照完整', partial_sale_snapshots: '部分成交有快照',
      alias_reference_requires_period: '别名成本待确认期间', current_only_no_backdate: '仅有当前成本',
      cost_evidence_missing: '无成本证据', current_reference: '当前成本参考', no_sales_cost_missing: '未销售且缺成本'
    };
    const needsCost = allRows.filter(r => r.unverifiedCostLineCount > 0 || r.missingCurrentCost).length;
    const needsClassification = allRows.filter(r => r.classificationIssueCount > 0).length;
    const verifiedLines = allRows.reduce((sum,r) => sum + (+r.snapshotEvidenceCount || 0), 0);
    const unverifiedLines = allRows.reduce((sum,r) => sum + (+r.unverifiedCostLineCount || 0), 0);
    const evidenceCount = type => evidence.filter(r => r.evidenceType === type).length;
    return `<div class="card" id="v2-product-governance-card">
      <div class="card-title">商品分类与成本证据 <span class="tag tag-info">只读复核</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2ProductGovernance()" ${rows.length ? '' : 'disabled'}>导出商品治理清单</button></div>
      <p class="form-hint">销售成本快照只证明对应成交日；别名成本必须确认适用期间；商品当前成本仅作为更新日起参考，不自动倒推更早销售。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">分类待补商品</div><div class="stat-value">${needsClassification}</div><div class="stat-sub">标准名、规格、业务类型或标记</div></div>
        <div class="stat-card"><div class="stat-label">成本证据待补商品</div><div class="stat-value">${needsCost}</div><div class="stat-sub">未验证历史明细 ${unverifiedLines} 条</div></div>
        <div class="stat-card"><div class="stat-label">已验证历史明细</div><div class="stat-value">${verifiedLines}</div><div class="stat-sub">来自销售时成本快照</div></div>
        <div class="stat-card"><div class="stat-label">成本证据记录</div><div class="stat-value">${evidence.length}</div><div class="stat-sub">成交 ${evidenceCount('sale_snapshot')} · 别名 ${evidenceCount('alias_cost_snapshot')} · 当前 ${evidenceCount('current_master_cost')}</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>治理状态</label><select id="product-governance-status" onchange="UI._filterV2ProductGovernance(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-product-governance-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>治理 ID</th><th>商品</th><th>优先级/状态</th><th>分类缺口</th><th>成本证据</th><th>历史成本观察</th><th>销售影响</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const missing = [r.missingStandardName ? '标准名' : '', r.missingPackageSpec ? '规格' : '', r.missingBusinessType ? '业务类型' : '', r.beverageClassificationConflict ? '饮料标记冲突' : '', r.missingCurrentCost ? '当前成本' : ''].filter(Boolean).join('、') || '无';
        const observed = r.snapshotEvidenceCount ? `¥${this._fmt(r.snapshotCostMin)}${r.snapshotCostCount > 1 ? `–¥${this._fmt(r.snapshotCostMax)}` : ''}<div class="form-hint">${this._escHtml(r.snapshotObservedFrom)} 至 ${this._escHtml(r.snapshotObservedTo)}</div>` : '-';
        return `<tr><td><code>${this._escHtml(r.governanceId)}</code></td><td><strong>${this._escHtml(r.productName)}</strong><div class="form-hint">${this._escHtml(r.productId)}</div></td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(r.reviewPriority)}</span> ${this._escHtml(labels[r.governanceStatus] || r.governanceStatus)}</td><td>${this._escHtml(missing)}</td><td>${this._escHtml(costLabels[r.costEvidenceStatus] || r.costEvidenceStatus)}<div class="form-hint">当前成本 ¥${this._fmt(r.currentCost)}</div></td><td>${observed}</td><td>${r.salesLineCount} 条 / ¥${this._fmt(r.affectedAmount)}<div class="form-hint">未验证 ${r.unverifiedCostLineCount} 条</div></td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示销售影响最高的 50 项，可导出当前状态的完整清单。</p>' : ''}` : '<div class="empty-state">当前状态没有商品治理项目</div>'}</div>
    </div>`;
  },

  _filterV2ProductGovernance(status) {
    this._v2ProductGovernanceFilter = status || '';
    const card = $('#v2-product-governance-card');
    if (card) card.outerHTML = this._productGovernanceHtml();
  },

  _exportV2ProductGovernance() {
    const filter = this._v2ProductGovernanceFilter || '';
    const rows = (this._v2ProductGovernance || []).filter(r => !filter || r.governanceStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的商品治理项目', 'error');
    const headers = ['治理ID','优先级','治理状态','商品ID','商品名称','标准名称','包装规格','业务类型','是否饮料','缺标准名','缺规格','缺业务类型','饮料标记冲突','缺当前成本','当前成本','成本证据状态','销售明细数','未验证成本明细数','成交快照数','历史成本种数','历史成本最小值','历史成本最大值','观察开始日','观察结束日','建议历史单位成本','影响记录数','销售数量','影响金额','最早销售日','最晚销售日','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers, ...rows.map(r => [r.governanceId,r.reviewPriority,r.governanceStatus,r.productId,r.productName,r.standardName,r.packageSpec,r.businessTypeCode,r.isBeverage,r.missingStandardName,r.missingPackageSpec,r.missingBusinessType,r.beverageClassificationConflict,r.missingCurrentCost,r.currentCost,r.costEvidenceStatus,r.salesLineCount,r.unverifiedCostLineCount,r.snapshotEvidenceCount,r.snapshotCostCount,r.snapshotCostMin,r.snapshotCostMax,r.snapshotObservedFrom,r.snapshotObservedTo,r.suggestedHistoricalUnitCost,r.affectedRecordCount,r.salesQuantity,r.affectedAmount,r.firstBusinessDate,r.lastBusinessDate,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `商品分类与成本证据-${filter || '全部'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast(`已导出 ${rows.length} 项商品治理记录`);
  },

  _revenueAttributionHtml() {
    const allRows = this._v2RevenueAttribution || [];
    const filter = this._v2RevenueAttributionFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {
      manual_link:'已有人工归属', pending_manual_link:'人工归属待补', ambiguous_manual_links:'人工归属冲突',
      unique_rule:'唯一规则候选', ambiguous_rules:'规则冲突', no_candidate:'无候选'
    };
    const count = status => allRows.filter(r => r.candidateStatus === status).length;
    const conflictCount = count('ambiguous_rules') + count('ambiguous_manual_links');
    const unresolvedAmount = allRows.filter(r => !['manual_link'].includes(r.candidateStatus)).reduce((sum,r) => sum + Math.abs(+r.affectedAmount || 0),0);
    return `<div class="card" id="v2-revenue-attribution-card">
      <div class="card-title">历史收入归属复核 <span class="tag tag-info">只读候选</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2RevenueAttribution()" ${rows.length ? '' : 'disabled'}>导出收入归属候选</button></div>
      <p class="form-hint">${this._escHtml(this._v2RevenueAttributionPeriod)}：人工链接优先；规则只比较最高优先级。同级规则指向不同业务类型时保留冲突，不自动修改收入流水或事实口径。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">已有人工归属</div><div class="stat-value">${count('manual_link')}</div><div class="stat-sub">等待后续批次采用解释</div></div>
        <div class="stat-card"><div class="stat-label">唯一规则候选</div><div class="stat-value">${count('unique_rule')}</div><div class="stat-sub">需人工确认</div></div>
        <div class="stat-card"><div class="stat-label">归属冲突</div><div class="stat-value">${conflictCount}</div><div class="stat-sub">禁止自动归属</div></div>
        <div class="stat-card"><div class="stat-label">未解决影响金额</div><div class="stat-value">¥${this._fmt(unresolvedAmount)}</div><div class="stat-sub">含无候选和待补人工链接</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="revenue-attribution-status" onchange="UI._filterV2RevenueAttribution(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-revenue-attribution-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>日期</th><th>收入说明</th><th>金额</th><th>状态</th><th>建议归属</th><th>匹配依据</th><th>来源</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const suggestion = r.suggestedBusinessTypeCode ? `${this._escHtml(r.suggestedBusinessLayerName || r.suggestedBusinessLayerCode)} / ${this._escHtml(r.suggestedBusinessTypeName || r.suggestedBusinessTypeCode)}` : '-';
        return `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td>${this._escHtml(r.businessDate)}</td><td><strong>${this._escHtml(r.itemName)}</strong><div class="form-hint">${this._escHtml(r.projectName || '')}</div></td><td>¥${this._fmt(r.affectedAmount)}</td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td><td>${suggestion}</td><td>${this._escHtml(r.matchedField || '-')}<div class="form-hint">${this._escHtml(r.matchedValue || '')} · ${r.topRuleCount || r.manualLinkCount || 0} 条依据</div></td><td>${this._escHtml(r.sourceTable)} / ${this._escHtml(r.sourceId)} / ${this._escHtml(r.sourceLineKey)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示最近 50 条，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前期间没有该状态的收入归属候选</div>'}</div>
    </div>`;
  },

  _filterV2RevenueAttribution(status) {
    this._v2RevenueAttributionFilter = status || '';
    const card = $('#v2-revenue-attribution-card');
    if (card) card.outerHTML = this._revenueAttributionHtml();
  },

  _exportV2RevenueAttribution() {
    const filter = this._v2RevenueAttributionFilter || '';
    const rows = (this._v2RevenueAttribution || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的收入归属候选', 'error');
    const headers = ['候选ID','优先级','候选状态','业务日期','收入说明','项目','影响金额','来源表','来源ID','明细键','候选依据','候选数','命中规则数','最高优先级规则数','置信度','建议业务层','建议业务类型','匹配字段','匹配值','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = [headers,...rows.map(r => [r.candidateId,r.reviewPriority,r.candidateStatus,r.businessDate,r.itemName,r.projectName,r.affectedAmount,r.sourceTable,r.sourceId,r.sourceLineKey,r.candidateBasis,r.candidateCount,r.matchedRuleCount,r.topRuleCount,r.confidence,r.suggestedBusinessLayerCode,r.suggestedBusinessTypeCode,r.matchedField,r.matchedValue,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const link = document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`历史收入归属候选-${this._v2RevenueAttributionPeriod}-${filter || '全部'}.csv`;link.click();URL.revokeObjectURL(link.href);
    this.toast(`已导出 ${rows.length} 条收入归属候选`);
  },

  _costAttributionHtml() {
    const allRows = this._v2CostAttribution || [];
    const filter = this._v2CostAttributionFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {
      manual_link:'已有人工归属', pending_manual_link:'人工归属待补', unique_rule:'唯一规则候选',
      partial_rule:'部分规则候选', ambiguous_rules:'规则冲突', no_candidate:'无候选'
    };
    const count = status => allRows.filter(r => r.candidateStatus === status).length;
    const conflictCount = allRows.filter(r => r.candidateStatus === 'ambiguous_rules' || r.projectMatchStatus === 'ambiguous_projects').length;
    const unresolvedAmount = allRows.filter(r => r.candidateStatus !== 'manual_link' || ['ambiguous_projects','unmatched_project'].includes(r.projectMatchStatus)).reduce((sum,r) => sum + Math.abs(+r.affectedAmount || 0),0);
    return `<div class="card" id="v2-cost-attribution-card">
      <div class="card-title">历史支出与成本归属复核 <span class="tag tag-info">只读候选</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2CostAttribution()" ${rows.length ? '' : 'disabled'}>导出支出归属候选</button></div>
      <p class="form-hint">${this._escHtml(this._v2CostAttributionPeriod)}：保留原支出类别；人工链接优先，规则只比较最高优先级。成本类型、业务层、能力轴和项目候选均不会自动改写原始支出。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">已有人工归属</div><div class="stat-value">${count('manual_link')}</div><div class="stat-sub">有效成本类型及维度</div></div>
        <div class="stat-card"><div class="stat-label">唯一规则候选</div><div class="stat-value">${count('unique_rule')}</div><div class="stat-sub">需人工确认</div></div>
        <div class="stat-card"><div class="stat-label">归属冲突</div><div class="stat-value">${conflictCount}</div><div class="stat-sub">含规则或项目冲突</div></div>
        <div class="stat-card"><div class="stat-label">未解决影响金额</div><div class="stat-value">¥${this._fmt(unresolvedAmount)}</div><div class="stat-sub">含部分候选、无候选和项目待复核</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="cost-attribution-status" onchange="UI._filterV2CostAttribution(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-cost-attribution-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>日期/原类别</th><th>支出说明</th><th>金额</th><th>状态</th><th>建议归属</th><th>项目关联</th><th>来源</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const dims = [r.suggestedCostTypeName || r.suggestedCostTypeCode, r.suggestedBusinessLayerName || r.suggestedBusinessLayerCode, r.suggestedBusinessTypeName || r.suggestedBusinessTypeCode, r.suggestedCapabilityAxisName || r.suggestedCapabilityAxisCode].filter(Boolean).map(v => this._escHtml(v)).join(' / ') || '-';
        const project = r.projectMatchStatus === 'unique_project' ? this._escHtml(r.suggestedProjectName) : r.projectMatchStatus === 'ambiguous_projects' ? '同名项目冲突' : r.projectMatchStatus === 'unmatched_project' ? '原项目待登记' : '共享 / 未指定';
        return `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td>${this._escHtml(r.businessDate)}<div class="form-hint">原类别：${this._escHtml(r.originalCategory)}</div></td><td><strong>${this._escHtml(r.description || r.originalProject || '支出')}</strong><div class="form-hint">${this._escHtml(r.relatedActivity || '')}</div></td><td>¥${this._fmt(r.affectedAmount)}</td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td><td>${dims}<div class="form-hint">${this._escHtml(r.matchedField || '-')} · ${r.topRuleCount || (r.candidateBasis === 'record_business_links' ? 1 : 0)} 条依据</div></td><td>${project}<div class="form-hint">${this._escHtml(r.originalProject || r.relatedActivity || '')}</div></td><td>${this._escHtml(r.sourceTable)} / ${this._escHtml(r.sourceId)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示最近 50 条，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前期间没有该状态的支出归属候选</div>'}</div>
    </div>`;
  },

  _filterV2CostAttribution(status) {
    this._v2CostAttributionFilter = status || '';
    const card = $('#v2-cost-attribution-card');
    if (card) card.outerHTML = this._costAttributionHtml();
  },

  _exportV2CostAttribution() {
    const filter = this._v2CostAttributionFilter || '';
    const rows = (this._v2CostAttribution || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的支出归属候选', 'error');
    const headers = ['候选ID','优先级','候选状态','业务日期','原支出类型','原项目','原支出类别','支出说明','关联活动','影响金额','来源表','来源ID','明细键','候选依据','候选数','命中规则数','最高优先级规则数','置信度','建议成本类型','建议业务层','建议业务类型','建议能力轴','匹配字段','匹配值','项目匹配状态','项目候选数','建议项目ID','建议项目名称','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = [headers,...rows.map(r => [r.candidateId,r.reviewPriority,r.candidateStatus,r.businessDate,r.originalType,r.originalProject,r.originalCategory,r.description,r.relatedActivity,r.affectedAmount,r.sourceTable,r.sourceId,r.sourceLineKey,r.candidateBasis,r.candidateCount,r.matchedRuleCount,r.topRuleCount,r.confidence,r.suggestedCostTypeCode,r.suggestedBusinessLayerCode,r.suggestedBusinessTypeCode,r.suggestedCapabilityAxisCode,r.matchedField,r.matchedValue,r.projectMatchStatus,r.projectCandidateCount,r.suggestedProjectId,r.suggestedProjectName,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const link = document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`历史支出归属候选-${this._v2CostAttributionPeriod}-${filter || '全部'}.csv`;link.click();URL.revokeObjectURL(link.href);
    this.toast(`已导出 ${rows.length} 条支出归属候选`);
  },

  _galleryLinksHtml() {
    const allRows = this._v2GalleryLinks || [];
    const filter = this._v2GalleryLinksFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {
      linked_with_snapshot:'作品与快照完整', linked_missing_snapshot:'已关联但缺快照', invalid_artwork_link:'作品链接失效',
      unique_artwork_no:'编号唯一候选', unique_title_artist:'名称/艺术家唯一候选', unique_title:'仅名称唯一候选',
      ambiguous_artworks:'作品冲突', no_artwork_candidate:'无作品候选'
    };
    const uniqueCount = allRows.filter(r => ['unique_artwork_no','unique_title_artist','unique_title'].includes(r.candidateStatus)).length;
    const problemCount = allRows.filter(r => ['invalid_artwork_link','ambiguous_artworks','no_artwork_candidate'].includes(r.candidateStatus)).length;
    const missingSettlement = allRows.filter(r => r.settlementEvidenceStatus !== 'frozen_snapshot').length;
    return `<div class="card" id="v2-gallery-links-card">
      <div class="card-title">画廊历史作品与结算证据 <span class="tag tag-info">只读候选</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2GalleryLinks()" ${rows.length ? '' : 'disabled'}>导出画廊关联候选</button></div>
      <p class="form-hint">${this._escHtml(this._v2GalleryLinksPeriod)}：作品 ID、作品编号及“名称＋艺术家”按精确证据分级。成交时结算价快照优先；当前作品价格只作复核参考，不回填历史。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">快照完整</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'linked_with_snapshot').length}</div><div class="stat-sub">作品关联及成交证据完整</div></div>
        <div class="stat-card"><div class="stat-label">唯一作品候选</div><div class="stat-value">${uniqueCount}</div><div class="stat-sub">仍需人工确认</div></div>
        <div class="stat-card"><div class="stat-label">作品冲突</div><div class="stat-value">${problemCount}</div><div class="stat-sub">含失效、歧义和无候选</div></div>
        <div class="stat-card"><div class="stat-label">缺结算证据</div><div class="stat-value">${missingSettlement}</div><div class="stat-sub">当前价格不能替代历史快照</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="gallery-link-status" onchange="UI._filterV2GalleryLinks(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-gallery-links-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>日期</th><th>原作品信息</th><th>成交/净额</th><th>状态</th><th>建议作品</th><th>结算证据</th><th>来源</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const suggestion = r.suggestedArtworkId ? `${this._escHtml(r.suggestedArtworkTitle)} / ${this._escHtml(r.suggestedArtworkArtist)}<div class="form-hint">${this._escHtml(r.suggestedArtworkNo)} · ${this._escHtml(r.suggestedArtworkId)}</div>` : '-';
        const evidence = r.settlementEvidenceStatus === 'frozen_snapshot' ? `成交快照 ¥${this._fmt(r.settlementEvidenceAmount)}` : r.settlementEvidenceStatus === 'current_master_reference' ? `当前参考 ¥${this._fmt(r.settlementEvidenceAmount)}` : '缺历史结算证据';
        return `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td>${this._escHtml(r.businessDate)}</td><td><strong>${this._escHtml(r.originalArtworkName || '未命名作品')}</strong><div class="form-hint">${this._escHtml(r.originalArtworkNo || '无编号')} · ${this._escHtml(r.originalArtist || '艺术家待补')}</div></td><td>¥${this._fmt(r.grossAmount)}<div class="form-hint">净额 ¥${this._fmt(r.realizedNetAmount)}</div></td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td><td>${suggestion}</td><td>${evidence}</td><td>${this._escHtml(r.sourceTable)} / ${this._escHtml(r.sourceId)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示最近 50 条，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前期间没有该状态的画廊关联候选</div>'}</div>
    </div>`;
  },

  _filterV2GalleryLinks(status) {
    this._v2GalleryLinksFilter = status || '';
    const card = $('#v2-gallery-links-card');
    if (card) card.outerHTML = this._galleryLinksHtml();
  },

  _exportV2GalleryLinks() {
    const filter = this._v2GalleryLinksFilter || '';
    const rows = (this._v2GalleryLinks || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的画廊关联候选', 'error');
    const headers = ['候选ID','优先级','候选状态','业务日期','原作品ID','原作品编号','原作品名称','原艺术家','成交数量','成交金额','实现净额','原结算价快照','作品候选数','建议作品ID','建议作品编号','建议作品名称','建议艺术家','匹配依据','置信度','结算证据状态','结算证据金额','证据时间','来源表','来源ID','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = [headers,...rows.map(r => [r.candidateId,r.reviewPriority,r.candidateStatus,r.businessDate,r.originalArtworkId,r.originalArtworkNo,r.originalArtworkName,r.originalArtist,r.saleQuantity,r.grossAmount,r.realizedNetAmount,r.settlementPriceSnapshot,r.artworkCandidateCount,r.suggestedArtworkId,r.suggestedArtworkNo,r.suggestedArtworkTitle,r.suggestedArtworkArtist,r.matchBasis,r.confidence,r.settlementEvidenceStatus,r.settlementEvidenceAmount,r.settlementEvidenceAt,r.sourceTable,r.sourceId,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`画廊历史关联候选-${this._v2GalleryLinksPeriod}-${filter || '全部'}.csv`;link.click();URL.revokeObjectURL(link.href);this.toast(`已导出 ${rows.length} 条画廊关联候选`);
  },

  _workshopLinksHtml() {
    const allRows = this._v2WorkshopLinks || [];
    const filter = this._v2WorkshopLinksFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {ready_candidate:'可复核候选',cost_review:'成本待审',missing_direct_cost:'缺直接成本',ambiguous_projects:'项目冲突',unregistered_project:'项目未登记',missing_project:'缺项目名称'};
    const projectProblems = allRows.filter(r => ['ambiguous_projects','unregistered_project','missing_project'].includes(r.candidateStatus)).length;
    return `<div class="card" id="v2-workshop-links-card">
      <div class="card-title">工坊历史项目与直接成本 <span class="tag tag-info">只读候选</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2WorkshopLinks()" ${rows.length ? '' : 'disabled'}>导出工坊关联候选</button></div>
      <p class="form-hint">${this._escHtml(this._v2WorkshopLinksPeriod)}：项目只做精确同名候选；直接成本只列同月、同项目的期间支出。待归类成本不计入确认金额，不估算、不跨月分摊。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">可复核候选</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'ready_candidate').length}</div><div class="stat-sub">项目与直接成本证据完整</div></div>
        <div class="stat-card"><div class="stat-label">成本待审</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'cost_review').length}</div><div class="stat-sub">存在待归类或非活动成本</div></div>
        <div class="stat-card"><div class="stat-label">项目问题</div><div class="stat-value">${projectProblems}</div><div class="stat-sub">缺名称、未登记或同名冲突</div></div>
        <div class="stat-card"><div class="stat-label">缺直接成本</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'missing_direct_cost').length}</div><div class="stat-sub">不自动估算</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="workshop-link-status" onchange="UI._filterV2WorkshopLinks(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-workshop-links-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>日期/活动</th><th>原项目</th><th>收入</th><th>状态</th><th>建议项目</th><th>直接成本候选</th><th>来源</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const project = r.suggestedProjectId ? `${this._escHtml(r.suggestedProjectName)}<div class="form-hint">${this._escHtml(r.suggestedProjectId)}</div>` : '-';
        return `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td>${this._escHtml(r.businessDate)}<div class="form-hint">${this._escHtml(r.activityName)}</div></td><td><strong>${this._escHtml(r.originalProjectName || '待补')}</strong></td><td>¥${this._fmt(r.affectedAmount)}<div class="form-hint">${this._fmt(r.participantCount)} 人</div></td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td><td>${project}</td><td>确认 ¥${this._fmt(r.confirmedDirectCostAmount)}<div class="form-hint">待审成本 ¥${this._fmt(r.pendingDirectCostAmount)} · ${r.directCostCandidateCount} 条</div></td><td>${this._escHtml(r.sourceTable)} / ${this._escHtml(r.sourceId)} / ${this._escHtml(r.sourceLineKey)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示最近 50 条，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前期间没有该状态的工坊关联候选</div>'}</div>
    </div>`;
  },

  _filterV2WorkshopLinks(status) {
    this._v2WorkshopLinksFilter = status || '';
    const card = $('#v2-workshop-links-card');
    if (card) card.outerHTML = this._workshopLinksHtml();
  },

  _exportV2WorkshopLinks() {
    const filter = this._v2WorkshopLinksFilter || '';
    const rows = (this._v2WorkshopLinks || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的工坊关联候选', 'error');
    const headers = ['候选ID','优先级','候选状态','业务日期','活动名称','活动类型','参与人数','收入金额','原项目名称','项目候选数','建议项目ID','建议项目名称','项目置信度','直接成本候选数','确认直接成本数','待审成本数','确认直接成本','待审成本','来源表','来源ID','明细键','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = [headers,...rows.map(r => [r.candidateId,r.reviewPriority,r.candidateStatus,r.businessDate,r.activityName,r.businessTypeName,r.participantCount,r.affectedAmount,r.originalProjectName,r.projectCandidateCount,r.suggestedProjectId,r.suggestedProjectName,r.projectConfidence,r.directCostCandidateCount,r.confirmedDirectCostCount,r.pendingDirectCostCount,r.confirmedDirectCostAmount,r.pendingDirectCostAmount,r.sourceTable,r.sourceId,r.sourceLineKey,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`工坊历史关联候选-${this._v2WorkshopLinksPeriod}-${filter || '全部'}.csv`;link.click();URL.revokeObjectURL(link.href);this.toast(`已导出 ${rows.length} 条工坊关联候选`);
  },

  _spaceClassificationHtml() {
    const allRows = this._v2SpaceClassification || [];
    const filter = this._v2SpaceClassificationFilter || '';
    const rows = filter ? allRows.filter(r => r.candidateStatus === filter) : allRows;
    const labels = {complete:'信息完整',ready_candidate:'可复核候选',classification_review:'分类待审',cooperation_review:'合作方式待审',contract_review:'合同待审'};
    const businessLabels = {space_rental:'空间租赁/合作',brand_event:'品牌活动/企业合作',uncategorized_revenue:'待确认项目'};
    const contractLabels = {present:'已有合同编号',not_required:'免费项目',missing_review:'付费项目待核',missing_required:'应有合同但缺失',duplicate:'合同编号重复'};
    const manualCount = allRows.filter(r => ['classification_review','cooperation_review'].includes(r.candidateStatus)).length;
    return `<div class="card" id="v2-space-classification-card">
      <div class="card-title">空间与合作历史分类 <span class="tag tag-info">只读候选</span><button type="button" class="btn btn-sm btn-secondary" style="float:right" onclick="UI._exportV2SpaceClassification()" ${rows.length ? '' : 'disabled'}>导出空间分类候选</button></div>
      <p class="form-hint">${this._escHtml(this._v2SpaceClassificationPeriod)}：分别复核业务类型、合作方式、合同编号和经营状态。只有明确的租赁或品牌快闪场景提供高置信建议；混合用途、重复合同和资料缺失均保留人工判断。</p>
      <div class="stat-card-grid" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">信息完整</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'complete').length}</div><div class="stat-sub">四个维度已确认</div></div>
        <div class="stat-card"><div class="stat-label">可复核候选</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'ready_candidate').length}</div><div class="stat-sub">现有字段可给出明确建议</div></div>
        <div class="stat-card"><div class="stat-label">需人工分类</div><div class="stat-value">${manualCount}</div><div class="stat-sub">业务类型或合作方式待审</div></div>
        <div class="stat-card"><div class="stat-label">合同待审</div><div class="stat-value">${allRows.filter(r => r.candidateStatus === 'contract_review').length}</div><div class="stat-sub">缺失或编号重复</div></div>
      </div>
      <div class="filter-bar" style="margin-bottom:12px"><div class="form-group"><label>候选状态</label><select id="space-classification-status" onchange="UI._filterV2SpaceClassification(this.value)"><option value="">全部</option>${Object.entries(labels).map(([value,label]) => `<option value="${value}"${filter === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
      <div id="v2-space-classification-body">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>候选 ID</th><th>日期/项目</th><th>执行证据</th><th>业务类型</th><th>合作方式</th><th>合同</th><th>经营状态</th><th>应收/已收</th><th>状态</th></tr></thead><tbody>${rows.slice(0,50).map(r => {
        const originalType = businessLabels[r.originalBusinessTypeCode] || r.originalBusinessTypeCode || '待补';
        const suggestedType = businessLabels[r.suggestedBusinessTypeCode] || r.suggestedBusinessTypeCode || '-';
        return `<tr><td><code>${this._escHtml(r.candidateId)}</code></td><td>${this._escHtml(r.businessDate)}<div><strong>${this._escHtml(r.projectName || '未命名项目')}</strong></div><div class="form-hint">${this._escHtml(r.space)} · ${this._escHtml(r.client || '无合作方')}</div></td><td>${this._escHtml(r.executionType || '-')}<div class="form-hint">${this._escHtml(r.executionStatus || '-')} · ${this._escHtml(r.rentalType || '-')}</div></td><td>${this._escHtml(originalType)}<div class="form-hint">${r.businessTypeStatus === 'confirmed' ? '已确认' : `建议：${this._escHtml(suggestedType)} · ${this._fmt((+r.businessTypeConfidence || 0) * 100)}%`}</div></td><td>${this._escHtml(r.originalCooperationMode || '待补')}<div class="form-hint">${r.cooperationStatus === 'confirmed' ? '已确认' : `建议：${this._escHtml(r.suggestedCooperationMode || '人工判断')}`}</div></td><td>${this._escHtml(r.originalContractNo || '待补')}<div class="form-hint">${this._escHtml(contractLabels[r.contractStatus] || r.contractStatus)}${r.contractUsageCount > 1 ? ` · ${r.contractUsageCount} 个项目重复` : ''}</div></td><td>${this._escHtml(r.originalBusinessStatus || '待补')}<div class="form-hint">${r.businessStatusStatus === 'confirmed' ? '已确认' : `建议：${this._escHtml(r.suggestedBusinessStatus || '人工判断')}`}</div></td><td>¥${this._fmt(r.receivableAmount)} / ¥${this._fmt(r.receivedAmount)}<div class="form-hint">待收 ¥${this._fmt(r.outstandingAmount)}</div></td><td><span class="tag ${r.reviewPriority === 'P1' ? 'tag-warning' : 'tag-info'}">${this._escHtml(labels[r.candidateStatus] || r.candidateStatus)}</span><div class="form-hint">${this._escHtml(r.reviewNote)}</div></td></tr>`;
      }).join('')}</tbody></table></div>${rows.length > 50 ? '<p class="form-hint">仅显示最近 50 条，可导出当前状态的完整候选清单。</p>' : ''}` : '<div class="empty-state">当前期间没有该状态的空间分类候选</div>'}</div>
    </div>`;
  },

  _filterV2SpaceClassification(status) {
    this._v2SpaceClassificationFilter = status || '';
    const card = $('#v2-space-classification-card');
    if (card) card.outerHTML = this._spaceClassificationHtml();
  },

  _exportV2SpaceClassification() {
    const filter = this._v2SpaceClassificationFilter || '';
    const rows = (this._v2SpaceClassification || []).filter(r => !filter || r.candidateStatus === filter);
    if (!rows.length) return this.toast('当前状态没有可导出的空间分类候选', 'error');
    const headers = ['候选ID','优先级','候选状态','问题数','开始日期','结束日期','空间','项目名称','合作方','执行类型','执行状态','租金类型','应收金额','已收金额','待收金额','原业务类型','业务类型状态','建议业务类型','类型置信度','原合作方式','合作方式状态','建议合作方式','原合同编号','合同状态','合同使用数','原经营状态','经营状态状态','建议经营状态','负责人','来源表','来源ID','复核说明'];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const lines = [headers,...rows.map(r => [r.candidateId,r.reviewPriority,r.candidateStatus,r.issueCount,r.businessDate,r.endDate,r.space,r.projectName,r.client,r.executionType,r.executionStatus,r.rentalType,r.receivableAmount,r.receivedAmount,r.outstandingAmount,r.originalBusinessTypeCode,r.businessTypeStatus,r.suggestedBusinessTypeCode,r.businessTypeConfidence,r.originalCooperationMode,r.cooperationStatus,r.suggestedCooperationMode,r.originalContractNo,r.contractStatus,r.contractUsageCount,r.originalBusinessStatus,r.businessStatusStatus,r.suggestedBusinessStatus,r.projectOwner,r.sourceTable,r.sourceId,r.reviewNote])];
    const blob = new Blob(['\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`空间合作历史分类候选-${this._v2SpaceClassificationPeriod}-${filter || '全部'}.csv`;link.click();URL.revokeObjectURL(link.href);this.toast(`已导出 ${rows.length} 条空间分类候选`);
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
        <p class="manage-desc" style="margin-top:14px">按收入分类导出明细：</p>
        <div class="manage-actions">
          <button class="btn btn-secondary" onclick="ImportExport.exportRevenueCategoryCSV('ticket')">导出门票明细</button>
          <button class="btn btn-secondary" onclick="ImportExport.exportRevenueCategoryCSV('coffee')">导出咖啡明细</button>
          <button class="btn btn-secondary" onclick="ImportExport.exportRevenueCategoryCSV('retail')">导出文创明细</button>
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
