// operations-dashboard.js — M5 美术馆运营管理页面模块
const OperationsDashboard = {
  _period: null,
  _overviewLoadId: 0,

  _defaultPeriod() {
    const today = new Date();
    return { year: String(today.getFullYear()), month: String(today.getMonth() + 1).padStart(2, '0') };
  },

  _layerDefinitions() {
    return [
      ['visit', '到馆参观', '门票、展览与公共文化服务'],
      ['onsite_consumption', '现场消费', '咖啡、饮品与文创零售'],
      ['experience_activity', '体验活动', '工坊、课程与主题活动'],
      ['art_transaction_cooperation', '艺术交易与合作', '作品交易、空间与品牌合作']
    ];
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

  _number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  _money(value) {
    return `¥${this._number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  _margin(value) {
    if (value === null || value === undefined || value === '') return '—';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${(parsed * 100).toFixed(1)}%` : '—';
  },

  _buildOverviewModel(summaryRows = [], baselineRows = []) {
    const byLayer = new Map(summaryRows.map(row => [row.businessLayerCode, row]));
    const layers = this._layerDefinitions().map(([code, name, description]) => {
      const row = byLayer.get(code) || {};
      return {
        code,
        name,
        description,
        revenue: this._number(row.revenueAmount),
        salesCost: this._number(row.salesCostAmount),
        periodCost: this._number(row.periodCostAmount),
        totalCost: this._number(row.totalCostAmount),
        grossProfit: this._number(row.grossProfit),
        grossMargin: row.grossMargin === null || row.grossMargin === undefined ? null : Number(row.grossMargin),
        contribution: this._number(row.operatingContribution)
      };
    });
    const totals = layers.reduce((result, layer) => ({
      revenue: result.revenue + layer.revenue,
      salesCost: result.salesCost + layer.salesCost,
      periodCost: result.periodCost + layer.periodCost,
      totalCost: result.totalCost + layer.totalCost,
      grossProfit: result.grossProfit + layer.grossProfit,
      contribution: result.contribution + layer.contribution
    }), { revenue: 0, salesCost: 0, periodCost: 0, totalCost: 0, grossProfit: 0, contribution: 0 });
    const pending = baselineRows.filter(row => ['unclassified_revenue', 'unclassified_cost'].includes(row.issueType));
    const pendingByType = type => pending.filter(row => row.issueType === type).reduce((result, row) => ({
      count: result.count + this._number(row.issueCount),
      amount: result.amount + this._number(row.affectedAmount)
    }), { count: 0, amount: 0 });
    const pendingRevenue = pendingByType('unclassified_revenue');
    const pendingCost = pendingByType('unclassified_cost');
    return {
      layers,
      totals,
      pendingRevenue,
      pendingCost,
      pendingCount: pendingRevenue.count + pendingCost.count,
      pendingImpact: pendingRevenue.amount + pendingCost.amount,
      hasPeriodRows: summaryRows.length > 0,
      hasBusinessValues: layers.some(layer => [layer.revenue, layer.salesCost, layer.periodCost, layer.grossProfit, layer.contribution].some(value => value !== 0))
    };
  },

  _loadingHtml(label) {
    return `<div class="operations-loading"><div class="spinner"></div><span>正在加载${label}…</span></div>`;
  },

  _overviewHtml(model) {
    const metrics = [
      ['revenue', '净收入', model.totals.revenue, '四层已归类收入'],
      ['sales-cost', '销售成本', model.totals.salesCost, '已售商品成本 + 作品结算'],
      ['period-cost', '期间成本', model.totals.periodCost, '明确归属到业务层的期间支出'],
      ['gross-profit', '销售毛利', model.totals.grossProfit, '净收入 − 销售成本'],
      ['contribution', '经营贡献', model.totals.contribution, '销售毛利 − 期间成本'],
      ['pending-impact', '待归类影响', model.pendingImpact, `${model.pendingCount} 条 · 收入 ${this._money(model.pendingRevenue.amount)} / 成本 ${this._money(model.pendingCost.amount)}`]
    ];
    const emptyNotice = model.hasBusinessValues ? '' : `
      <div class="operations-data-notice" role="note">
        <strong>${model.hasPeriodRows ? '本期间暂无可计入四层的经营金额' : '本期间暂无经营事实'}</strong>
        <span>四层结构仍完整显示；金额按冻结视图展示为 ${this._money(0)}，净收入为零时毛利率显示“—”。</span>
      </div>`;
    return `${emptyNotice}
      <div class="operations-stat-grid" aria-label="经营指标">
        ${metrics.map(([key, label, value, note], index) => `<article class="operations-stat-card${index === 5 && model.pendingImpact ? ' attention' : ''}" data-metric="${key}">
          <span>${label}</span><strong>${this._money(value)}</strong><small>${note}</small>
        </article>`).join('')}
      </div>
      <div class="operations-formula-strip" role="note">
        <span><strong>销售毛利</strong> = 净收入 − 销售成本</span>
        <span><strong>经营贡献</strong> = 销售毛利 − 期间成本</span>
        <span><strong>毛利率</strong> = 销售毛利 ÷ 净收入</span>
      </div>
      <p class="operations-method-note">金额直接汇总自 <code>business_layer_summary_v2</code>。待归类收入和成本来自治理基线，单独提示且不并入四层经营金额。</p>`;
  },

  _layersHtml(model) {
    return `<div class="operations-layer-table-wrap">
      <table class="operations-layer-table">
        <thead><tr><th>业务层</th><th>净收入</th><th>销售成本</th><th>期间成本</th><th>销售毛利</th><th>毛利率</th><th>经营贡献</th></tr></thead>
        <tbody>${model.layers.map((layer, index) => `<tr data-layer="${layer.code}">
          <th scope="row"><span>0${index + 1}</span><strong>${layer.name}</strong><small>${layer.description}</small></th>
          <td data-label="净收入">${this._money(layer.revenue)}</td>
          <td data-label="销售成本">${this._money(layer.salesCost)}</td>
          <td data-label="期间成本">${this._money(layer.periodCost)}</td>
          <td data-label="销售毛利">${this._money(layer.grossProfit)}</td>
          <td data-label="毛利率">${this._margin(layer.grossMargin)}</td>
          <td data-label="经营贡献"><strong>${this._money(layer.contribution)}</strong></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="operations-method-note">四大业务层固定保留，零值层不会消失。毛利率使用视图字段；分母为零或数据库返回空值时显示“—”，不显示伪造的 0%。</p>`;
  },

  _setOverviewState(label, state) {
    const indicator = document.getElementById('operations-overview-state');
    if (!indicator) return;
    indicator.className = `operations-state-pill ${state}`;
    indicator.textContent = label;
  },

  async _loadOverview() {
    const overview = document.getElementById('operations-overview-content');
    const layers = document.getElementById('operations-layers-content');
    if (!overview || !layers) return;
    const loadId = ++this._overviewLoadId;
    const refreshButton = document.getElementById('operations-refresh');
    if (refreshButton) refreshButton.disabled = true;
    this._setOverviewState('加载中', 'loading');
    overview.innerHTML = this._loadingHtml('经营总览');
    layers.innerHTML = this._loadingHtml('四层经营矩阵');
    const period = `${this._period.year}-${this._period.month}`;
    try {
      const [summaryRows, baselineRows] = await Promise.all([
        Store._request('GET', `/rest/v1/business_layer_summary_v2?period_month=eq.${period}&order=sort_order.asc&limit=4`),
        Store._request('GET', `/rest/v1/data_governance_baseline_v2?period_month=eq.${period}&order=priority.asc&limit=500`)
      ]);
      if (loadId !== this._overviewLoadId) return;
      const model = this._buildOverviewModel(summaryRows || [], baselineRows || []);
      overview.innerHTML = this._overviewHtml(model);
      layers.innerHTML = this._layersHtml(model);
      this._setOverviewState(model.hasBusinessValues ? '数据已就绪' : '空期间', model.hasBusinessValues ? 'ready' : 'empty');
      const status = document.getElementById('operations-refresh-status');
      if (status) status.textContent = `已更新 · ${this._periodLabel()}`;
    } catch (error) {
      if (loadId !== this._overviewLoadId) return;
      this._setOverviewState('加载失败', 'error');
      overview.innerHTML = '<div class="operations-error-state"><strong>经营总览加载失败</strong><span>无法读取当前期间的只读经营汇总，请稍后重试。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard.refresh()">重新加载</button></div>';
      layers.innerHTML = '<div class="operations-error-state"><strong>四层矩阵暂不可用</strong><span>其他运营管理分区仍可继续查看。</span></div>';
      const status = document.getElementById('operations-refresh-status');
      if (status) status.textContent = `加载失败 · ${this._periodLabel()}`;
    } finally {
      if (loadId === this._overviewLoadId && refreshButton) refreshButton.disabled = false;
    }
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
          <button id="operations-refresh" type="button" class="btn btn-secondary" onclick="OperationsDashboard.refresh()">刷新数据</button>
          <span id="operations-refresh-status" class="operations-refresh-status" role="status" aria-live="polite">准备加载经营汇总</span>
        </section>

        <nav class="operations-section-nav" aria-label="运营管理分区">
          ${[
            ['operations-overview','经营总览'],['operations-layers','四层矩阵'],['operations-trend','趋势比较'],
            ['operations-governance','治理工作台'],['operations-model','模型对应'],['operations-detail','明细导出']
          ].map(([id, label], index) => `<button type="button" class="operations-section-link${index === 0 ? ' active' : ''}" data-operations-target="${id}" onclick="OperationsDashboard.focusSection('${id}', this)">${label}</button>`).join('')}
        </nav>

        <section id="operations-overview" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>01</span><h3>经营总览</h3><em id="operations-overview-state" class="operations-state-pill loading">加载中</em></div><p>关键经营结果与待归类影响</p></div>
          <div id="operations-overview-content">${this._loadingHtml('经营总览')}</div>
        </section>

        <section id="operations-layers" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>02</span><h3>四层经营矩阵</h3></div><p>到馆参观、现场消费、体验活动、艺术交易与合作</p></div>
          <div id="operations-layers-content">${this._loadingHtml('四层经营矩阵')}</div>
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
    await this._loadOverview();
  },

  async setPeriod(year, month) {
    if (!/^\d{4}$/.test(String(year)) || !/^(0[1-9]|1[0-2])$/.test(String(month))) return;
    this._period = { year: String(year), month: String(month) };
    const shell = document.querySelector('.operations-shell');
    if (shell) shell.dataset.period = `${this._period.year}-${this._period.month}`;
    const label = document.getElementById('operations-period-label');
    if (label) label.textContent = this._periodLabel();
    const status = document.getElementById('operations-refresh-status');
    if (status) status.textContent = `正在加载 · ${this._periodLabel()}`;
    await this._loadOverview();
  },

  focusSection(id, button) {
    const target = document.getElementById(id);
    if (!target) return;
    document.querySelectorAll('.operations-section-link').forEach(link => link.classList.remove('active'));
    button?.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  },

  async refresh() {
    const status = document.getElementById('operations-refresh-status');
    if (status) status.textContent = `正在刷新 · ${this._periodLabel()}`;
    await this._loadOverview();
  }
};

if (typeof window !== 'undefined') window.OperationsDashboard = OperationsDashboard;
