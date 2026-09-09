// operations-dashboard.js — M5 美术馆运营管理页面模块
const OperationsDashboard = {
  _period: null,

  _defaultPeriod() {
    const today = new Date();
    return { year: String(today.getFullYear()), month: String(today.getMonth() + 1).padStart(2, '0') };
  },

  _yearOptions(selected) {
    const current = new Date().getFullYear();
    const years = [];
    for (let year = current; year >= current - 5; year--) years.push(year);
    if (!years.includes(Number(selected))) years.push(Number(selected));
    return years.sort((a, b) => b - a).map(year =>
      `<option value="${year}"${String(year) === selected ? ' selected' : ''}>${year}年</option>`
    ).join('');
  },

  _monthOptions(selected) {
    return Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      return `<option value="${month}"${month === selected ? ' selected' : ''}>${index + 1}月</option>`;
    }).join('');
  },

  _periodLabel() {
    const period = this._period || this._defaultPeriod();
    return `${period.year}年${Number(period.month)}月`;
  },

  async render() {
    const page = document.getElementById('page-operations');
    if (!page) return;
    if (!Auth.hasModuleAccess('operations')) {
      page.innerHTML = '<div class="card"><div class="empty-state">当前账号无权查看运营管理信息</div></div>';
      return;
    }
    this._period ||= this._defaultPeriod();
    const periodLabel = this._periodLabel();
    page.innerHTML = `
      <div class="operations-shell" data-period="${this._period.year}-${this._period.month}">
        <header class="operations-hero">
          <div>
            <div class="operations-eyebrow">AIWEI · OPERATIONS 2.0</div>
            <h2>美术馆运营管理</h2>
            <p>从四大业务层理解经营结果，同时保留口径差异和数据治理问题。</p>
          </div>
          <div class="operations-period-card" aria-label="当前查看期间">
            <span>当前期间</span>
            <strong id="operations-period-label">${periodLabel}</strong>
            <small>本地开发视图 · 生产数据尚未接入</small>
          </div>
        </header>

        <section class="card operations-toolbar" aria-label="运营管理筛选">
          <div class="operations-filter-group">
            <label for="operations-year">年份</label>
            <select id="operations-year" onchange="OperationsDashboard.setPeriod(this.value, document.getElementById('operations-month').value)">
              ${this._yearOptions(this._period.year)}
            </select>
          </div>
          <div class="operations-filter-group">
            <label for="operations-month">月份</label>
            <select id="operations-month" onchange="OperationsDashboard.setPeriod(document.getElementById('operations-year').value, this.value)">
              ${this._monthOptions(this._period.month)}
            </select>
          </div>
          <div class="operations-scope">
            <span>数据范围</span>
            <strong>四层经营事实 + 治理状态</strong>
          </div>
          <button id="operations-refresh" type="button" class="btn btn-secondary" onclick="OperationsDashboard.refresh()">刷新页面</button>
          <span id="operations-refresh-status" class="operations-refresh-status" role="status" aria-live="polite">页面框架已就绪</span>
        </section>

        <nav class="operations-section-nav" aria-label="运营管理分区">
          ${[
            ['operations-overview','经营总览'],['operations-layers','四层矩阵'],['operations-trend','趋势比较'],
            ['operations-governance','治理工作台'],['operations-model','模型对应'],['operations-detail','明细导出']
          ].map(([id, label], index) => `<button type="button" class="operations-section-link${index === 0 ? ' active' : ''}" data-operations-target="${id}" onclick="OperationsDashboard.focusSection('${id}', this)">${label}</button>`).join('')}
        </nav>

        <section id="operations-overview" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>01</span><h3>经营总览</h3></div><p>关键经营结果与数据质量影响</p></div>
          <div class="operations-stat-grid" aria-label="经营指标占位">
            ${['净收入','销售成本','期间成本','销售毛利','经营贡献','待归类影响'].map(label => `<div class="operations-stat-placeholder"><span>${label}</span><strong>—</strong><small>等待经营汇总接入</small></div>`).join('')}
          </div>
        </section>

        <section id="operations-layers" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>02</span><h3>四层经营矩阵</h3></div><p>到馆参观、现场消费、体验活动、艺术交易与合作</p></div>
          <div class="operations-layer-grid">
            ${[
              ['到馆参观','门票、展览与公共文化服务'],['现场消费','咖啡、饮品与文创零售'],
              ['体验活动','工坊、课程与主题活动'],['艺术交易与合作','作品交易、空间与品牌合作']
            ].map(([name, desc], index) => `<article><span>0${index + 1}</span><div><h4>${name}</h4><p>${desc}</p></div><strong>待接入</strong></article>`).join('')}
          </div>
        </section>

        <section id="operations-trend" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>03</span><h3>趋势与口径比较</h3></div><p>月度经营变化及 1.0/2.0 差异</p></div>
          <div class="operations-empty-panel"><span aria-hidden="true">↗</span><div><strong>趋势区域已预留</strong><p>后续将在同一期间条件下展示收入、成本、毛利和经营贡献趋势。</p></div></div>
        </section>

        <section id="operations-governance" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>04</span><h3>数据治理工作台</h3></div><p>问题、候选、证据与治理批次</p></div>
          <div class="operations-chip-row">${['治理问题','商品与成本','收入归属','支出归属','画廊与工坊','空间合作','治理批次'].map(label => `<span>${label}</span>`).join('')}</div>
        </section>

        <section id="operations-model" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>05</span><h3>业务模型对应</h3></div><p>页面数字如何进入 2.0 经营结构</p></div>
          <div class="operations-model-grid">
            ${[['业务层','经营组合'],['业务类型','收入来源'],['成本类型','资源用途'],['能力轴','长期能力']].map(([name, desc]) => `<div><span>${name}</span><strong>${desc}</strong></div>`).join('')}
          </div>
        </section>

        <section id="operations-detail" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>06</span><h3>明细与导出</h3></div><p>统一筛选、来源定位与可复核证据</p></div>
          <div class="operations-empty-panel"><span aria-hidden="true">⇩</span><div><strong>明细能力已预留</strong><p>明细将保留来源表、来源 ID、明细键和治理状态。</p></div></div>
        </section>
      </div>`;
  },

  setPeriod(year, month) {
    if (!/^\d{4}$/.test(String(year)) || !/^(0[1-9]|1[0-2])$/.test(String(month))) return;
    this._period = { year: String(year), month: String(month) };
    const shell = document.querySelector('.operations-shell');
    if (shell) shell.dataset.period = `${this._period.year}-${this._period.month}`;
    const label = document.getElementById('operations-period-label');
    if (label) label.textContent = this._periodLabel();
    const status = document.getElementById('operations-refresh-status');
    if (status) status.textContent = `已切换至 ${this._periodLabel()}`;
  },

  focusSection(id, button) {
    const target = document.getElementById(id);
    if (!target) return;
    document.querySelectorAll('.operations-section-link').forEach(link => link.classList.remove('active'));
    button?.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  },

  refresh() {
    const status = document.getElementById('operations-refresh-status');
    if (status) status.textContent = `刚刚更新 · ${this._periodLabel()}`;
  }
};

window.OperationsDashboard = OperationsDashboard;
