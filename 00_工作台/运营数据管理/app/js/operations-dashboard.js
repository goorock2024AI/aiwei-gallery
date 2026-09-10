// operations-dashboard.js — M5 美术馆运营管理页面模块
const OperationsDashboard = {
  _period: null,
  _overviewLoadId: 0,
  _trendLoadId: 0,
  _governanceLoadId: 0,
  _modelLoadId: 0,
  _detailLoadId: 0,
  _loadAllId: 0,
  _trendCharts: [],
  _detailType: 'revenue',
  _detailLayer: 'all',
  _detailStatus: 'all',
  _detailKeyword: '',
  _detailRows: [],
  _expandedFactId: '',

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

  _buildTrendModel(year, summaryRows = [], legacyRows = []) {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      period: `${year}-${String(index + 1).padStart(2, '0')}`,
      label: `${index + 1}月`,
      revenue: 0,
      salesCost: 0,
      periodCost: 0,
      totalCost: 0,
      grossProfit: 0,
      contribution: 0,
      legacyRevenue: 0,
      difference: 0
    }));
    summaryRows.forEach(row => {
      const period = String(row.periodMonth || '');
      if (!period.startsWith(`${year}-`)) return;
      const index = Number(period.slice(5, 7)) - 1;
      if (!rows[index]) return;
      rows[index].revenue += this._number(row.revenueAmount);
      rows[index].salesCost += this._number(row.salesCostAmount);
      rows[index].periodCost += this._number(row.periodCostAmount);
      rows[index].totalCost += this._number(row.totalCostAmount);
      rows[index].grossProfit += this._number(row.grossProfit);
      rows[index].contribution += this._number(row.operatingContribution);
    });
    legacyRows.forEach(row => {
      const date = String(row.date || '');
      if (!date.startsWith(`${year}-`)) return;
      const index = Number(date.slice(5, 7)) - 1;
      if (!rows[index]) return;
      rows[index].legacyRevenue += this._number(row.netAmount ?? row.amount);
    });
    rows.forEach(row => { row.difference = row.revenue - row.legacyRevenue; });
    const totals = rows.reduce((result, row) => ({
      revenue: result.revenue + row.revenue,
      salesCost: result.salesCost + row.salesCost,
      periodCost: result.periodCost + row.periodCost,
      totalCost: result.totalCost + row.totalCost,
      grossProfit: result.grossProfit + row.grossProfit,
      contribution: result.contribution + row.contribution,
      legacyRevenue: result.legacyRevenue + row.legacyRevenue,
      difference: result.difference + row.difference
    }), { revenue: 0, salesCost: 0, periodCost: 0, totalCost: 0, grossProfit: 0, contribution: 0, legacyRevenue: 0, difference: 0 });
    return {
      year: String(year),
      rows,
      totals,
      selected: rows[Number(this._period?.month || 1) - 1],
      hasData: rows.some(row => [row.revenue, row.totalCost, row.legacyRevenue].some(value => value !== 0))
    };
  },

  _signedMoney(value) {
    const amount = this._number(value);
    if (amount === 0) return this._money(0);
    return `${amount > 0 ? '+' : '−'}${this._money(Math.abs(amount))}`;
  },

  _trendHtml(model) {
    const selected = model.selected;
    const differenceClass = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    const emptyNotice = model.hasData ? '' : `<div class="operations-data-notice" role="note"><strong>${model.year} 年暂无经营数据</strong><span>12 个月仍完整显示零值，用于区分“无数据”与图表加载失败。</span></div>`;
    return `${emptyNotice}
      <div class="operations-trend-summary" aria-label="年度经营趋势汇总">
        <article data-year-metric="revenue"><span>2.0 年度净收入</span><strong>${this._money(model.totals.revenue)}</strong><small>四层已归类收入</small></article>
        <article data-year-metric="total-cost"><span>年度总成本</span><strong>${this._money(model.totals.totalCost)}</strong><small>销售成本 + 期间成本</small></article>
        <article data-year-metric="gross-profit"><span>年度销售毛利</span><strong>${this._money(model.totals.grossProfit)}</strong><small>按月汇总视图字段</small></article>
        <article data-year-metric="contribution"><span>年度经营贡献</span><strong>${this._money(model.totals.contribution)}</strong><small>按月汇总视图字段</small></article>
        <article data-year-metric="difference" class="${differenceClass(model.totals.difference)}"><span>年度口径差异</span><strong>${this._signedMoney(model.totals.difference)}</strong><small>2.0 − 1.0 净收入</small></article>
      </div>
      <div class="operations-period-compare" data-period="${selected.period}">
        <div data-compare="period"><span>当前选择</span><strong>${this._escapeTrendText(selected.label)}</strong></div>
        <div data-compare="legacy"><span>1.0 净收入</span><strong>${this._money(selected.legacyRevenue)}</strong></div>
        <div data-compare="v2"><span>2.0 净收入</span><strong>${this._money(selected.revenue)}</strong></div>
        <div data-compare="difference" class="${differenceClass(selected.difference)}"><span>口径差异</span><strong>${this._signedMoney(selected.difference)}</strong></div>
      </div>
      <div class="operations-chart-grid">
        <article class="operations-chart-card">
          <div><strong>2.0 月度经营趋势</strong><span>净收入、总成本、销售毛利、经营贡献</span></div>
          <div class="operations-chart-canvas"><canvas id="operations-performance-chart" role="img" aria-label="${model.year}年2.0月度经营趋势图"></canvas></div>
        </article>
        <article class="operations-chart-card">
          <div><strong>1.0 / 2.0 净收入比较</strong><span>差异 = 2.0 净收入 − 1.0 净收入</span></div>
          <div class="operations-chart-canvas"><canvas id="operations-definition-chart" role="img" aria-label="${model.year}年1.0和2.0净收入比较图"></canvas></div>
        </article>
      </div>
      <div class="operations-trend-table-wrap">
        <table class="operations-trend-table">
          <thead><tr><th>月份</th><th>2.0净收入</th><th>总成本</th><th>销售毛利</th><th>经营贡献</th><th>1.0净收入</th><th>口径差异</th></tr></thead>
          <tbody>${model.rows.map(row => `<tr${row.period === selected.period ? ' class="selected"' : ''} data-trend-period="${row.period}">
            <th scope="row">${row.label}</th>
            <td data-label="2.0净收入">${this._money(row.revenue)}</td>
            <td data-label="总成本">${this._money(row.totalCost)}</td>
            <td data-label="销售毛利">${this._money(row.grossProfit)}</td>
            <td data-label="经营贡献">${this._money(row.contribution)}</td>
            <td data-label="1.0净收入">${this._money(row.legacyRevenue)}</td>
            <td data-label="口径差异" class="${differenceClass(row.difference)}">${this._signedMoney(row.difference)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="operations-method-note">2.0 使用四层业务明细和实际到账日归属；1.0 使用既有 <code>revenue_facts</code>。待归类收入不会静默并入 2.0，因而可能形成差异；差异只用于口径核对，不代表现金短款或会计损益。</p>`;
  },

  _escapeTrendText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  },

  _governanceStatusLabel(status) {
    const labels = {
      matched: '已匹配', unique_candidate: '唯一候选', ambiguous: '存在歧义', no_candidate: '无候选',
      complete: '资料完整', classification_review: '分类待补', cost_evidence_review: '成本证据待补',
      classification_and_cost_review: '分类与成本待补', manual_link: '已有人工归属', pending_manual_link: '人工归属待补',
      unique_rule: '唯一规则', partial_rule: '部分规则', ambiguous_rules: '规则冲突', ambiguous_manual_links: '人工链接冲突',
      linked_snapshot: '成交快照已关联', valid_artwork_link: '作品关联有效', unique_artwork_no: '作品编号唯一候选',
      unique_title_artist: '标题与艺术家唯一候选', unique_title: '标题唯一候选', ambiguous_artworks: '作品候选冲突',
      invalid_artwork_link: '作品关联无效', no_artwork_candidate: '无作品候选', ready_candidate: '可进入复核',
      cost_review: '直接成本待审', missing_project: '缺项目名称', ambiguous_projects: '项目候选冲突',
      unregistered_project: '项目未登记', missing_direct_cost: '缺直接成本', confirmed: '已确认', suggested: '有建议待审',
      review: '待人工复核', invalid: '原值无效', draft: '草稿', pending_review: '待审核', approved: '已批准',
      rejected: '已拒绝', applied: '已应用', reverted: '已撤销', unknown: '状态待确认'
    };
    return labels[status] || String(status || '状态待确认').replaceAll('_', ' ');
  },

  _candidatePriority(row, sourceKey) {
    if (/^P[1-4]$/.test(String(row.reviewPriority || ''))) return row.reviewPriority;
    if (sourceKey === 'aliases') {
      return row.candidateStatus === 'ambiguous' ? 'P1' : row.candidateStatus === 'no_candidate' ? 'P2' : row.candidateStatus === 'unique_candidate' ? 'P3' : 'P4';
    }
    return 'P4';
  },

  _buildGovernanceModel(period, baselineRows = [], sources = {}) {
    const issueDefinitions = [
      ['unclassified_revenue', '待归类收入'],
      ['unclassified_cost', '待归类成本'],
      ['missing_product_cost', '缺成本商品/作品']
    ];
    const issues = issueDefinitions.map(([key, label]) => {
      const rows = baselineRows.filter(row => row.issueType === key);
      return {
        key, label,
        priority: rows[0]?.priority || (key === 'missing_product_cost' ? 'P1' : 'P2'),
        count: rows.reduce((sum, row) => sum + this._number(row.issueCount), 0),
        records: rows.reduce((sum, row) => sum + this._number(row.affectedRecordCount), 0),
        amount: rows.reduce((sum, row) => sum + this._number(row.affectedAmount), 0),
        sources: [...new Set(rows.map(row => row.sourceTable).filter(Boolean))]
      };
    });
    const issueTotals = issues.reduce((result, issue) => ({
      count: result.count + issue.count,
      records: result.records + issue.records,
      amount: result.amount + issue.amount
    }), { count: 0, records: 0, amount: 0 });
    const issuePriority = { P1: 0, P2: 0, P3: 0, P4: 0 };
    issues.forEach(issue => { issuePriority[issue.priority] = (issuePriority[issue.priority] || 0) + issue.count; });

    const definitions = [
      { key: 'products', label: '商品与成本', note: '历史别名 + 当前商品主数据', sourceKeys: ['aliases', 'products'] },
      { key: 'revenue', label: '收入归属', note: `${period} 收入候选`, sourceKeys: ['revenue'] },
      { key: 'cost', label: '支出归属', note: `${period} 支出候选`, sourceKeys: ['cost'] },
      { key: 'gallery', label: '画廊关联', note: `${period} 作品与结算证据`, sourceKeys: ['gallery'] },
      { key: 'workshop', label: '工坊关联', note: `${period} 项目与直接成本`, sourceKeys: ['workshop'] },
      { key: 'space', label: '空间合作', note: `${period} 分类与合同证据`, sourceKeys: ['space'] }
    ];
    const candidatePriority = { P1: 0, P2: 0, P3: 0, P4: 0 };
    const domains = definitions.map(definition => {
      const entries = definition.sourceKeys.flatMap(sourceKey => (sources[sourceKey]?.rows || []).map(row => ({ row, sourceKey })));
      const statusCounts = new Map();
      let p1 = 0;
      let human = 0;
      let ready = 0;
      let amount = 0;
      entries.forEach(({ row, sourceKey }) => {
        const status = row.candidateStatus || row.governanceStatus || 'unknown';
        const priority = this._candidatePriority(row, sourceKey);
        candidatePriority[priority] = (candidatePriority[priority] || 0) + 1;
        if (priority === 'P1') p1++;
        if (/unique|ready_candidate|suggested/.test(status)) ready++;
        if (/ambiguous|no_candidate|missing|invalid|pending|review|unregistered|partial|conflict/.test(status)) human++;
        amount += this._number(row.affectedAmount);
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      });
      return {
        ...definition,
        count: entries.length,
        p1,
        human,
        ready,
        amount,
        failed: definition.sourceKeys.some(key => sources[key]?.failed),
        truncated: definition.sourceKeys.some(key => sources[key]?.truncated),
        statuses: [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      };
    });
    const candidateTotals = domains.reduce((result, domain) => ({
      count: result.count + domain.count,
      p1: result.p1 + domain.p1,
      human: result.human + domain.human,
      ready: result.ready + domain.ready
    }), { count: 0, p1: 0, human: 0, ready: 0 });

    const batches = sources.batches?.rows || [];
    const batchStatuses = ['draft', 'pending_review', 'approved', 'applied', 'rejected', 'reverted'].map(status => ({
      status,
      label: this._governanceStatusLabel(status),
      count: batches.filter(batch => batch.status === status).length
    }));
    const openBatchCount = batches.filter(batch => ['draft', 'pending_review', 'approved'].includes(batch.status)).length;
    const failedSources = Object.entries(sources).filter(([, source]) => source?.failed).map(([key]) => key);
    return {
      period,
      issues,
      issueTotals,
      issuePriority,
      domains,
      candidatePriority,
      candidateTotals,
      batches,
      batchStatuses,
      openBatchCount,
      batchAmount: batches.reduce((sum, batch) => sum + this._number(batch.affectedAmount), 0),
      failedSources,
      baselineFailed: Boolean(sources.baseline?.failed),
      batchFailed: Boolean(sources.batches?.failed),
      hasPeriodData: issueTotals.count > 0 || domains.slice(1).some(domain => domain.count > 0) || batches.length > 0
    };
  },

  _governanceHtml(model) {
    const priorityNote = { P1: '优先核对', P2: '安排复核', P3: '可进入确认', P4: '已有证据或完成' };
    const sourceLabels = { baseline: '问题基线', aliases: '商品别名', products: '商品主数据', revenue: '收入归属', cost: '支出归属', gallery: '画廊关联', workshop: '工坊关联', space: '空间合作', batches: '治理批次' };
    const warnings = model.failedSources.length ? `<div class="operations-data-notice warning" role="alert"><strong>部分治理数据暂不可用</strong><span>${model.failedSources.map(key => sourceLabels[key] || key).join('、')}加载失败；已成功的数据仍保留。</span></div>` : '';
    const empty = model.hasPeriodData ? '' : `<div class="operations-data-notice" role="note"><strong>${model.period} 暂无期间治理问题或候选</strong><span>商品与成本卡仍显示全部历史别名和当前商品主数据快照。</span></div>`;
    const issueBody = model.baselineFailed
      ? '<div class="operations-error-state compact"><strong>问题基线加载失败</strong><span>候选队列和批次状态仍可查看。</span></div>'
      : `<div class="operations-governance-table-wrap"><table class="operations-governance-table"><thead><tr><th>问题类型</th><th>优先级</th><th>问题数</th><th>影响记录</th><th>影响金额</th><th>来源</th></tr></thead><tbody>${model.issues.map(issue => `<tr data-issue-type="${issue.key}"><th scope="row">${issue.label}</th><td data-label="优先级"><span class="operations-priority ${issue.priority.toLowerCase()}">${issue.priority}</span></td><td data-label="问题数">${issue.count}</td><td data-label="影响记录">${issue.records}</td><td data-label="影响金额">${this._money(issue.amount)}</td><td data-label="来源">${issue.sources.length ? issue.sources.map(source => `<code>${this._escapeTrendText(source)}</code>`).join(' ') : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    const batches = model.batchFailed
      ? '<div class="operations-error-state compact"><strong>治理批次加载失败</strong><span>问题基线和候选队列仍可查看。</span></div>'
      : `<div class="operations-batch-statuses">${model.batchStatuses.map(item => `<div data-batch-status="${item.status}"><span>${item.label}</span><strong>${item.count}</strong></div>`).join('')}</div>
        ${model.batches.length ? `<div class="operations-batch-list">${model.batches.slice(0, 5).map(batch => `<div><span class="operations-batch-dot ${batch.status}"></span><strong>${this._escapeTrendText(batch.name)}</strong><em>${this._governanceStatusLabel(batch.status)} · ${this._number(batch.itemCount)} 条 · ${this._money(batch.affectedAmount)}</em></div>`).join('')}</div>` : '<div class="operations-empty-inline">当前月份没有新建治理批次</div>'}`;
    return `${warnings}${empty}
      <div class="operations-governance-summary" aria-label="数据治理摘要">
        <article data-governance-metric="issues"><span>治理问题</span><strong>${model.issueTotals.count}</strong><small>${model.period} 稳定问题 ID</small></article>
        <article data-governance-metric="p1"><span>P1 优先项</span><strong>${model.issuePriority.P1 + model.candidatePriority.P1}</strong><small>问题 ${model.issuePriority.P1} · 候选 ${model.candidatePriority.P1}</small></article>
        <article data-governance-metric="candidates"><span>候选与证据</span><strong>${model.candidateTotals.count}</strong><small>需人工判断 ${model.candidateTotals.human}</small></article>
        <article data-governance-metric="affected"><span>问题影响金额</span><strong>${this._money(model.issueTotals.amount)}</strong><small>${model.issueTotals.records} 条影响记录（分组合计）</small></article>
        <article data-governance-metric="batches"><span>进行中批次</span><strong>${model.openBatchCount}</strong><small>本月批次 ${model.batches.length} 个</small></article>
      </div>
      <div class="operations-governance-columns">
        <article class="operations-governance-panel">
          <header><div><span>01</span><strong>问题基线</strong></div><small>${model.period} · 按稳定问题 ID 对账</small></header>
          ${issueBody}
        </article>
        <article class="operations-governance-panel">
          <header><div><span>02</span><strong>优先级队列</strong></div><small>问题数 / 候选数分开显示</small></header>
          <div class="operations-priority-grid">${['P1','P2','P3','P4'].map(priority => `<div data-priority="${priority}"><span class="operations-priority ${priority.toLowerCase()}">${priority}</span><strong>${model.issuePriority[priority]} / ${model.candidatePriority[priority]}</strong><small>${priorityNote[priority]}</small></div>`).join('')}</div>
        </article>
      </div>
      <article class="operations-governance-panel operations-candidate-panel">
        <header><div><span>03</span><strong>候选类型与证据队列</strong></div><small>每类最多读取 500 条；达到上限时显示 500+</small></header>
        <div class="operations-candidate-grid">${model.domains.map(domain => `<div class="operations-candidate-card${domain.failed ? ' failed' : ''}" data-candidate-domain="${domain.key}">
          <div><strong>${domain.label}</strong><span>${domain.note}</span></div>
          ${domain.failed && domain.count === 0 ? '<em class="operations-source-error">数据源加载失败</em>' : `<b>${domain.count}${domain.truncated ? '+' : ''}</b><small>P1 ${domain.p1} · 人工判断 ${domain.human} · 可复核 ${domain.ready}</small><small>候选影响金额 ${this._money(domain.amount)}</small>`}
          ${domain.statuses.length ? `<div class="operations-status-chips">${domain.statuses.map(([status, count]) => `<span>${this._governanceStatusLabel(status)} ${count}</span>`).join('')}</div>` : ''}
        </div>`).join('')}</div>
      </article>
      <article class="operations-governance-panel operations-batch-panel">
        <header><div><span>04</span><strong>治理批次状态</strong></div><small>${model.period} 创建 · 影响金额 ${this._money(model.batchAmount)}</small></header>
        ${batches}
      </article>
      <div class="operations-governance-actions">
        <div><strong>运营管理页保持只读</strong><span>候选明细与受控写入继续复用 M4 页面；歧义和无候选不会自动进入批次。</span></div>
        <button type="button" class="btn btn-secondary" onclick="OperationsDashboard.openGovernanceReview()">查看完整候选</button>
        <button type="button" class="btn btn-primary" onclick="OperationsDashboard.openGovernanceFlow()">进入受控批次</button>
      </div>`;
  },

  _businessDimensionDefinitions() {
    return [
      { key: 'business_layer', label: '业务层', purpose: '经营组合', note: '固定四层经营结构，承接收入、成本和经营结果。' },
      { key: 'business_type', label: '业务类型', purpose: '收入与活动来源', note: '通过 parent_code 归入业务层；未归类收入保留为治理项。' },
      { key: 'cost_type', label: '成本类型', purpose: '资源用途', note: '说明资源花在什么地方，不替代销售成本与期间成本口径。' },
      { key: 'capability_axis', label: '能力轴', purpose: '长期能力', note: '标记内容、观众和商业合作能力投入，不单独形成利润层。' }
    ];
  },

  _detailTypeDefinitions() {
    return {
      revenue: { label: '收入事实', table: 'business_revenue_facts_v2', amountLabel: '净收入' },
      cost: { label: '成本事实', table: 'business_cost_facts_v2', amountLabel: '成本金额' },
      profit: { label: '利润事实', table: 'business_profit_facts_v2', amountLabel: '销售毛利' }
    };
  },

  _detailLayerOptions(selected) {
    return [['all', '全部业务层'], ...this._layerDefinitions().map(([code, name]) => [code, name])]
      .map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
  },

  _detailStatusOptions(selected) {
    const values = [
      ['all', '全部映射状态'], ['system_field', '系统字段'], ['system_default', '系统默认'], ['sale_snapshot', '成交快照'],
      ['alias_match', '别名匹配'], ['product_match', '商品匹配'], ['manual_link', '人工归属'],
      ['rule_match', '规则匹配'], ['rule_confirmed', '规则已确认'], ['pending_review', '待复核'],
      ['unmatched', '未匹配'], ['unmatched_default', '未匹配兜底']
    ];
    return values.map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
  },

  _detailMappingLabel(status) {
    const labels = {
      system_field: '系统字段', system_default: '系统默认', sale_snapshot: '成交快照', alias_match: '别名匹配', product_match: '商品匹配',
      manual_link: '人工归属', rule_match: '规则匹配', rule_confirmed: '规则已确认',
      pending_review: '待复核', unmatched: '未匹配', unmatched_default: '未匹配兜底'
    };
    return labels[status] || String(status || '状态未知').replaceAll('_', ' ');
  },

  _detailQuality(row) {
    const flags = row.qualityFlags && typeof row.qualityFlags === 'object' ? row.qualityFlags : {};
    const labels = {
      missing_product: '缺商品', missing_unit_cost: '缺单位成本', missing_settlement_price: '缺结算价',
      missing_project: '缺项目', ambiguous_mapping: '映射冲突', pending_review: '待复核'
    };
    const active = Object.entries(flags).filter(([, value]) => value === true || (value !== false && value !== '' && value !== null && value !== undefined));
    return active.map(([key, value]) => labels[key] || (value === true ? key : `${key}: ${value}`));
  },

  _normalizeDetailRow(type, row) {
    const quality = this._detailQuality(row);
    const amount = type === 'cost' ? this._number(row.costAmount) : type === 'profit' ? this._number(row.grossProfit) : this._number(row.netAmount);
    const label = row.productNameStandard || row.productNameRaw || row.projectName || row.sourceCategory || row.businessTypeName || row.businessTypeCode || row.sourceId || '未命名事实';
    return {
      type,
      factId: String(row.factId || ''),
      date: String(row.businessDate || ''),
      sourceTable: String(row.sourceTable || ''),
      sourceId: String(row.sourceId || ''),
      sourceLineKey: String(row.sourceLineKey || ''),
      layerCode: String(row.businessLayerCode || ''),
      layerName: String(row.businessLayerName || row.businessLayerCode || '待归类'),
      businessType: String(row.businessTypeName || row.businessTypeCode || '待归类'),
      costType: String(row.costTypeName || row.costTypeCode || ''),
      capability: String(row.capabilityAxisName || row.capabilityAxisCode || ''),
      mappingStatus: String(row.mappingStatus || ''),
      label: String(label),
      amount,
      grossAmount: this._number(row.grossAmount),
      revenueAmount: this._number(row.revenueAmount ?? row.netAmount),
      costAmount: this._number(row.costAmount),
      grossProfit: this._number(row.grossProfit),
      grossMargin: row.grossMargin === null || row.grossMargin === undefined ? null : Number(row.grossMargin),
      quantity: this._number(row.quantity),
      unitPrice: this._number(row.unitPrice),
      unitCost: this._number(row.unitCost),
      productId: String(row.productId || ''),
      projectName: String(row.projectName || ''),
      paymentMethod: String(row.paymentMethod || ''),
      quality
    };
  },

  _buildDetailModel(type, rows = [], keyword = '') {
    const definitions = this._detailTypeDefinitions();
    const normalized = rows.map(row => this._normalizeDetailRow(type, row));
    const needle = String(keyword || '').trim().toLocaleLowerCase('zh-CN');
    const visible = needle ? normalized.filter(row => [row.factId, row.date, row.sourceTable, row.sourceId, row.sourceLineKey, row.layerName, row.businessType, row.costType, row.capability, row.mappingStatus, row.label, row.projectName, row.productId, ...row.quality]
      .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(needle))) : normalized;
    return {
      type,
      definition: definitions[type] || definitions.revenue,
      rows: normalized,
      visible,
      keyword: String(keyword || ''),
      amount: visible.reduce((sum, row) => sum + row.amount, 0),
      qualityCount: visible.filter(row => row.quality.length).length,
      sourceCount: new Set(visible.map(row => `${row.sourceTable}:${row.sourceId}`)).size,
      truncated: rows.length >= 500
    };
  },

  _detailRequestPath() {
    const definition = this._detailTypeDefinitions()[this._detailType] || this._detailTypeDefinitions().revenue;
    const { start, end } = this._periodDateRange();
    const filters = [`business_date=gte.${start}`, `business_date=lte.${end}`];
    if (this._detailLayer !== 'all') filters.push(`business_layer_code=eq.${encodeURIComponent(this._detailLayer)}`);
    if (this._detailStatus !== 'all') filters.push(`mapping_status=eq.${encodeURIComponent(this._detailStatus)}`);
    filters.push('order=business_date.desc', 'limit=500');
    return `/rest/v1/${definition.table}?${filters.join('&')}`;
  },

  _detailFiltersHtml(model) {
    return `<div class="operations-detail-filters" aria-label="经营明细筛选">
      <div class="operations-filter-group"><label for="operations-detail-type">事实类型</label><select id="operations-detail-type" onchange="OperationsDashboard.setDetailType(this.value)">${Object.entries(this._detailTypeDefinitions()).map(([value, definition]) => `<option value="${value}"${model.type === value ? ' selected' : ''}>${definition.label}</option>`).join('')}</select></div>
      <div class="operations-filter-group"><label for="operations-detail-layer">业务层</label><select id="operations-detail-layer" onchange="OperationsDashboard.setDetailLayer(this.value)">${this._detailLayerOptions(this._detailLayer)}</select></div>
      <div class="operations-filter-group"><label for="operations-detail-status-filter">映射状态</label><select id="operations-detail-status-filter" onchange="OperationsDashboard.setDetailStatus(this.value)">${this._detailStatusOptions(this._detailStatus)}</select></div>
      <div class="operations-filter-group operations-keyword-filter"><label for="operations-detail-keyword">定位关键词</label><input id="operations-detail-keyword" type="search" value="${this._escapeTrendText(this._detailKeyword)}" placeholder="来源 ID、项目、商品或明细键" oninput="OperationsDashboard.setDetailKeyword(this.value)"></div>
      <button type="button" class="btn btn-secondary" onclick="OperationsDashboard.resetDetailFilters()">重置明细筛选</button>
      <button id="operations-detail-export" type="button" class="btn btn-primary" onclick="OperationsDashboard.exportDetailCSV()"${model.visible.length ? '' : ' disabled'}>导出当前结果</button>
    </div>
    <div class="operations-detail-scope"><span>统一期间：<strong>${this._periodLabel()}</strong></span><span>服务端条件：业务日期${this._detailLayer === 'all' ? '' : ` · ${this._escapeTrendText(model.visible[0]?.layerName || this._detailLayer)}`}${this._detailStatus === 'all' ? '' : ` · ${this._detailMappingLabel(this._detailStatus)}`}</span><span>最多读取 500 条</span></div>
    <div id="operations-detail-results">${this._detailResultsHtml(model)}</div>`;
  },

  _detailResultsHtml(model) {
    const warning = model.truncated ? '<div class="operations-data-notice warning" role="note"><strong>当前结果已达到 500 条上限</strong><span>请缩小业务层或映射状态范围后再导出，避免遗漏。</span></div>' : '';
    const empty = model.visible.length ? '' : `<div class="operations-data-notice" role="note"><strong>${this._periodLabel()} 没有符合筛选的${model.definition.label}</strong><span>可重置明细筛选，或切换事实类型、业务层和映射状态。</span></div>`;
    const rows = model.visible.map(row => {
      const expanded = this._expandedFactId === row.factId;
      return `<tr class="operations-detail-row" data-fact-id="${this._escapeTrendText(row.factId)}">
        <td data-label="展开"><button type="button" class="operations-detail-toggle" data-fact-id="${this._escapeTrendText(row.factId)}" aria-expanded="${expanded}" onclick="OperationsDashboard.toggleDetail(this.dataset.factId)">${expanded ? '−' : '+'}</button></td>
        <td data-label="日期">${this._escapeTrendText(row.date)}</td>
        <th scope="row"><strong>${this._escapeTrendText(row.label)}</strong><small>${this._escapeTrendText(row.businessType)}</small></th>
        <td data-label="业务层">${this._escapeTrendText(row.layerName)}</td>
        <td data-label="金额"><strong>${this._money(row.amount)}</strong></td>
        <td data-label="映射状态"><span class="operations-mapping-status ${/pending|unmatched/.test(row.mappingStatus) ? 'attention' : ''}">${this._detailMappingLabel(row.mappingStatus)}</span></td>
        <td data-label="质量标记">${row.quality.length ? row.quality.map(flag => `<span class="operations-quality-flag">${this._escapeTrendText(flag)}</span>`).join('') : '—'}</td>
      </tr>
      <tr class="operations-detail-expansion" data-detail-for="${this._escapeTrendText(row.factId)}"${expanded ? '' : ' hidden'}><td colspan="7"><div class="operations-source-details">
        <div><span>来源表</span><code>${this._escapeTrendText(row.sourceTable) || '—'}</code></div><div><span>来源 ID</span><code>${this._escapeTrendText(row.sourceId) || '—'}</code></div><div><span>明细键</span><code>${this._escapeTrendText(row.sourceLineKey) || '—'}</code></div><div><span>事实 ID</span><code>${this._escapeTrendText(row.factId) || '—'}</code></div>
        <div><span>业务类型</span><strong>${this._escapeTrendText(row.businessType)}</strong></div><div><span>成本类型</span><strong>${this._escapeTrendText(row.costType) || '—'}</strong></div><div><span>能力轴</span><strong>${this._escapeTrendText(row.capability) || '—'}</strong></div><div><span>项目 / 商品</span><strong>${this._escapeTrendText(row.projectName || row.productId) || '—'}</strong></div>
        ${row.type === 'profit' ? `<div><span>净收入</span><strong>${this._money(row.revenueAmount)}</strong></div><div><span>销售成本</span><strong>${this._money(row.costAmount)}</strong></div><div><span>毛利率</span><strong>${this._margin(row.grossMargin)}</strong></div>` : ''}
      </div></td></tr>`;
    }).join('');
    return `${warning}<div class="operations-detail-summary"><div><span>当前结果</span><strong>${model.visible.length}${model.truncated ? '+' : ''}</strong><small>加载 ${model.rows.length} 条</small></div><div><span>${model.definition.amountLabel}</span><strong>${this._money(model.amount)}</strong><small>当前筛选结果合计</small></div><div><span>原始记录</span><strong>${model.sourceCount}</strong><small>按来源表 + 来源 ID 去重</small></div><div><span>含质量标记</span><strong>${model.qualityCount}</strong><small>不会静默隐藏</small></div></div>${empty}${model.visible.length ? `<div class="operations-detail-table-wrap"><table class="operations-detail-table"><thead><tr><th>展开</th><th>业务日期</th><th>事实说明</th><th>业务层</th><th>金额</th><th>映射状态</th><th>质量标记</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  },

  _setDetailState(label, state) {
    const indicator = document.getElementById('operations-detail-state');
    if (!indicator) return;
    indicator.className = `operations-state-pill ${state}`;
    indicator.textContent = label;
  },

  async _loadDetail() {
    const target = document.getElementById('operations-detail-content');
    if (!target) return false;
    const loadId = ++this._detailLoadId;
    this._setDetailState('加载中', 'loading');
    target.innerHTML = this._loadingHtml('经营明细');
    try {
      const rows = await Store._request('GET', this._detailRequestPath());
      if (loadId !== this._detailLoadId) return false;
      this._detailRows = Array.isArray(rows) ? rows : [];
      this._expandedFactId = '';
      const model = this._buildDetailModel(this._detailType, this._detailRows, this._detailKeyword);
      target.innerHTML = this._detailFiltersHtml(model);
      this._setDetailState(model.rows.length ? '数据已就绪' : '空期间', model.rows.length ? 'ready' : 'empty');
      return true;
    } catch (error) {
      if (loadId !== this._detailLoadId) return false;
      this._detailRows = [];
      this._setDetailState('加载失败', 'error');
      target.innerHTML = '<div class="operations-error-state"><strong>经营明细加载失败</strong><span>无法读取当前筛选下的只读事实；总览、趋势、治理和模型区不受影响。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard._loadDetail()">重新加载明细</button></div>';
      return false;
    }
  },

  async setDetailType(value) {
    if (!this._detailTypeDefinitions()[value]) return;
    this._detailType = value;
    this._detailStatus = 'all';
    this._detailKeyword = '';
    await this._loadDetail();
  },

  async setDetailLayer(value) {
    if (!['all', ...this._layerDefinitions().map(([code]) => code)].includes(value)) return;
    this._detailLayer = value;
    this._detailKeyword = '';
    await this._loadDetail();
  },

  async setDetailStatus(value) {
    this._detailStatus = String(value || 'all');
    this._detailKeyword = '';
    await this._loadDetail();
  },

  setDetailKeyword(value) {
    this._detailKeyword = String(value || '');
    const results = document.getElementById('operations-detail-results');
    if (results) results.innerHTML = this._detailResultsHtml(this._buildDetailModel(this._detailType, this._detailRows, this._detailKeyword));
    const exportButton = document.getElementById('operations-detail-export');
    if (exportButton) exportButton.disabled = !this._buildDetailModel(this._detailType, this._detailRows, this._detailKeyword).visible.length;
  },

  async resetDetailFilters() {
    this._detailLayer = 'all';
    this._detailStatus = 'all';
    this._detailKeyword = '';
    await this._loadDetail();
  },

  toggleDetail(factId) {
    this._expandedFactId = this._expandedFactId === factId ? '' : factId;
    const results = document.getElementById('operations-detail-results');
    if (results) results.innerHTML = this._detailResultsHtml(this._buildDetailModel(this._detailType, this._detailRows, this._detailKeyword));
  },

  _csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  },

  _detailCsvContent(model) {
    const headers = ['事实类型','事实ID','业务日期','来源表','来源ID','明细键','业务层','业务类型','成本类型','能力轴','事实说明','当前金额','净收入','成本金额','销售毛利','毛利率','映射状态','质量标记'];
    const rows = model.visible.map(row => [model.definition.label,row.factId,row.date,row.sourceTable,row.sourceId,row.sourceLineKey,row.layerName,row.businessType,row.costType,row.capability,row.label,row.amount,row.revenueAmount,row.costAmount,row.grossProfit,row.grossMargin === null ? '' : row.grossMargin,row.mappingStatus,row.quality.join('；')]);
    return '\uFEFF' + [headers, ...rows].map(line => line.map(value => this._csvCell(value)).join(',')).join('\r\n');
  },

  exportDetailCSV() {
    const model = this._buildDetailModel(this._detailType, this._detailRows, this._detailKeyword);
    if (!model.visible.length || typeof document === 'undefined') return;
    const blob = new Blob([this._detailCsvContent(model)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `运营管理-${model.definition.label}-${this._period.year}-${this._period.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(`已导出 ${model.visible.length} 条${model.definition.label}`);
  },

  _buildBusinessModel(rows = []) {
    const layerOrder = new Map(this._layerDefinitions().map(([code], index) => [code, index]));
    const normalized = rows.map(row => ({
      type: String(row.dimensionType || ''),
      code: String(row.code || ''),
      name: String(row.name || row.code || ''),
      parentCode: String(row.parentCode || ''),
      sortOrder: this._number(row.sortOrder),
      active: row.isActive !== false,
      notes: String(row.notes || '')
    })).filter(row => row.type && row.code);
    const layers = normalized.filter(row => row.type === 'business_layer');
    const layerNames = new Map(layers.map(row => [row.code, row.name]));
    const definitions = this._businessDimensionDefinitions();
    const groups = definitions.map(definition => {
      const items = normalized.filter(row => row.type === definition.key).sort((a, b) => {
        if (definition.key === 'business_layer') {
          const left = layerOrder.has(a.code) ? layerOrder.get(a.code) : 99;
          const right = layerOrder.has(b.code) ? layerOrder.get(b.code) : 99;
          if (left !== right) return left - right;
        }
        return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
      }).map(row => ({ ...row, parentName: layerNames.get(row.parentCode) || '' }));
      return {
        ...definition,
        items,
        activeCount: items.filter(item => item.active).length,
        inactiveCount: items.filter(item => !item.active).length
      };
    });
    return {
      groups,
      totalCount: normalized.length,
      activeCount: normalized.filter(row => row.active).length,
      inactiveCount: normalized.filter(row => !row.active).length,
      hasRows: normalized.length > 0
    };
  },

  _businessModelHtml(model) {
    const dictionaries = model.hasRows ? `<div class="operations-dimension-grid">${model.groups.map(group => `<article class="operations-dimension-card" data-dimension-type="${group.key}">
      <header><div><span>${group.label}</span><strong>${group.purpose}</strong></div><em>${group.activeCount} 启用${group.inactiveCount ? ` · ${group.inactiveCount} 停用` : ''}</em></header>
      <p>${group.note}</p>
      <div class="operations-dimension-items">${group.items.map(item => `<div class="${item.active ? '' : 'inactive'}" data-dimension-code="${this._escapeTrendText(item.code)}">
        <div><strong>${this._escapeTrendText(item.name)}</strong><code>${this._escapeTrendText(item.code)}</code></div>
        ${item.parentName ? `<small>归属：${this._escapeTrendText(item.parentName)}</small>` : ''}
        ${item.notes ? `<span>${this._escapeTrendText(item.notes)}</span>` : ''}
        ${item.active ? '' : '<em>已停用</em>'}
      </div>`).join('')}</div>
    </article>`).join('')}</div>` : '<div class="operations-data-notice" role="note"><strong>业务维度字典暂无记录</strong><span>事实链和指标来源仍可查看；这里不会用前端默认值伪造字典。</span></div>';
    const metrics = [
      ['净收入', 'business_layer_summary_v2.revenue_amount', 'business_revenue_facts_v2.net_amount', '四层已归类收入'],
      ['销售成本', 'business_layer_summary_v2.sales_cost_amount', 'business_cost_facts_v2.cost_amount', '仅 sold_cogs / gallery_settlement'],
      ['期间成本', 'business_layer_summary_v2.period_cost_amount', 'business_cost_facts_v2.cost_amount', '明确归属的非销售成本'],
      ['总成本', 'business_layer_summary_v2.total_cost_amount', '汇总视图字段', '销售成本 + 期间成本'],
      ['销售毛利', 'business_layer_summary_v2.gross_profit', '汇总视图字段', '净收入 − 销售成本'],
      ['毛利率', 'business_layer_summary_v2.gross_margin', '汇总视图字段', '净收入为零时显示“—”'],
      ['经营贡献', 'business_layer_summary_v2.operating_contribution', '汇总视图字段', '销售毛利 − 期间成本'],
      ['待归类影响', 'data_governance_baseline_v2.affected_amount', '治理基线', '单独展示，不并入四层'],
      ['1.0 / 2.0 差异', 'revenue_facts ↔ business_layer_summary_v2', '同年度净收入', '2.0 减 1.0，仅用于口径核对']
    ];
    return `<div class="operations-model-summary" aria-label="业务模型字典摘要">
        <div><span>维度类型</span><strong>4</strong><small>冻结类型</small></div>
        <div><span>字典项</span><strong>${model.totalCount}</strong><small>${model.activeCount} 启用 · ${model.inactiveCount} 停用</small></div>
        <div><span>筛选关系</span><strong>全局</strong><small>不随年月变化</small></div>
        <div><span>页面权限</span><strong>只读</strong><small>不提供字典写动作</small></div>
      </div>
      ${dictionaries}
      <article class="operations-model-panel operations-fact-panel">
        <header><div><span>01</span><strong>经营事实链</strong></div><small>从来源事实到页面展示</small></header>
        <div class="operations-fact-chain">
          <div><span>原始业务记录</span><strong>收入、支出、零售、画廊、工坊、空间</strong><small>保留来源表与来源 ID</small></div><b aria-hidden="true">→</b>
          <div><span>2.0 只读事实</span><strong>收入事实 + 成本事实</strong><small><code>business_revenue_facts_v2</code> · <code>business_cost_facts_v2</code></small></div><b aria-hidden="true">→</b>
          <div><span>利润与月度汇总</span><strong>利润事实 + 四层汇总</strong><small><code>business_profit_facts_v2</code> · <code>business_layer_summary_v2</code></small></div><b aria-hidden="true">→</b>
          <div><span>运营管理页面</span><strong>总览、矩阵、趋势、治理</strong><small>显示视图字段，不重算另一套口径</small></div>
        </div>
      </article>
      <article class="operations-model-panel">
        <header><div><span>02</span><strong>页面指标映射</strong></div><small>字段来源与显示边界</small></header>
        <div class="operations-model-table-wrap"><table class="operations-model-table"><thead><tr><th>页面指标</th><th>页面直接读取</th><th>事实来源</th><th>显示规则</th></tr></thead><tbody>${metrics.map(([label, display, source, rule]) => `<tr data-model-metric="${label}"><th scope="row">${label}</th><td><code>${display}</code></td><td><code>${source}</code></td><td>${rule}</td></tr>`).join('')}</tbody></table></div>
      </article>
      <p class="operations-method-note">业务字典读取自 <code>business_dimensions</code>。本区是全局模型说明，不随当前年月筛选变化；页面只展示冻结维度和事实来源，不修改原始事实、维度字典或 M4 治理结果。</p>`;
  },

  _setModelState(label, state) {
    const indicator = document.getElementById('operations-model-state');
    if (!indicator) return;
    indicator.className = `operations-state-pill ${state}`;
    indicator.textContent = label;
  },

  async _loadBusinessModel() {
    const target = document.getElementById('operations-model-content');
    if (!target) return false;
    const loadId = ++this._modelLoadId;
    this._setModelState('加载中', 'loading');
    target.innerHTML = this._loadingHtml('业务模型');
    try {
      const rows = await Store._request('GET', '/rest/v1/business_dimensions?order=sort_order.asc&limit=500');
      if (loadId !== this._modelLoadId) return false;
      const model = this._buildBusinessModel(rows || []);
      target.innerHTML = this._businessModelHtml(model);
      this._setModelState(model.hasRows ? '数据已就绪' : '字典为空', model.hasRows ? 'ready' : 'empty');
      return true;
    } catch (error) {
      if (loadId !== this._modelLoadId) return false;
      this._setModelState('加载失败', 'error');
      const model = this._buildBusinessModel([]);
      target.innerHTML = `<div class="operations-error-state"><strong>业务维度字典加载失败</strong><span>无法读取冻结字典；经营总览、趋势和治理工作台不受影响。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard.refresh()">重新加载</button></div>${this._businessModelHtml(model)}`;
      return false;
    }
  },

  _setGovernanceState(label, state) {
    const indicator = document.getElementById('operations-governance-state');
    if (!indicator) return;
    indicator.className = `operations-state-pill ${state}`;
    indicator.textContent = label;
  },

  _periodDateRange() {
    const year = Number(this._period.year);
    const month = Number(this._period.month);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const period = `${this._period.year}-${this._period.month}`;
    return { period, start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
  },

  async _loadGovernance() {
    const target = document.getElementById('operations-governance-content');
    if (!target) return false;
    const loadId = ++this._governanceLoadId;
    this._setGovernanceState('加载中', 'loading');
    target.innerHTML = this._loadingHtml('数据治理工作台');
    const { period, start, end } = this._periodDateRange();
    const requests = {
      baseline: { limit: 200, call: () => Store._request('GET', `/rest/v1/data_governance_baseline_v2?period_month=eq.${period}&order=priority.asc&limit=200`) },
      aliases: { limit: 500, call: () => Store._request('GET', '/rest/v1/product_alias_candidates_v2?order=affected_amount.desc&limit=500') },
      products: { limit: 500, call: () => Store._request('GET', '/rest/v1/product_master_governance_v2?order=review_priority.asc&limit=500') },
      revenue: { limit: 500, call: () => Store._request('GET', `/rest/v1/revenue_attribution_candidates_v2?business_date=gte.${start}&business_date=lte.${end}&order=business_date.desc&limit=500`) },
      cost: { limit: 500, call: () => Store._request('GET', `/rest/v1/cost_attribution_candidates_v2?business_date=gte.${start}&business_date=lte.${end}&order=business_date.desc&limit=500`) },
      gallery: { limit: 500, call: () => Store._request('GET', `/rest/v1/gallery_link_candidates_v2?business_date=gte.${start}&business_date=lte.${end}&order=business_date.desc&limit=500`) },
      workshop: { limit: 500, call: () => Store._request('GET', `/rest/v1/workshop_link_candidates_v2?business_date=gte.${start}&business_date=lte.${end}&order=business_date.desc&limit=500`) },
      space: { limit: 500, call: () => Store._request('GET', `/rest/v1/space_classification_candidates_v2?business_date=gte.${start}&business_date=lte.${end}&order=business_date.desc&limit=500`) },
      batches: { limit: 200, call: () => Store._request('GET', `/rest/v1/governance_batch_summary_v2?created_at=gte.${start}&created_at=lte.${end}T23:59:59.999Z&order=created_at.desc&limit=200`) }
    };
    const entries = Object.entries(requests);
    const settled = await Promise.allSettled(entries.map(([, request]) => request.call()));
    if (loadId !== this._governanceLoadId) return false;
    const sources = {};
    settled.forEach((result, index) => {
      const [key, request] = entries[index];
      const rows = result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [];
      sources[key] = { rows, failed: result.status === 'rejected', truncated: rows.length >= request.limit };
    });
    if (settled.every(result => result.status === 'rejected')) {
      this._setGovernanceState('加载失败', 'error');
      target.innerHTML = '<div class="operations-error-state"><strong>数据治理工作台加载失败</strong><span>所有治理数据源均暂不可用；经营总览和趋势不受影响。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard.refresh()">重新加载</button></div>';
      return false;
    }
    const model = this._buildGovernanceModel(period, sources.baseline.rows, sources);
    target.innerHTML = this._governanceHtml(model);
    const partial = model.failedSources.length > 0;
    this._setGovernanceState(partial ? '部分数据失败' : model.hasPeriodData ? '数据已就绪' : '空期间', partial ? 'error' : model.hasPeriodData ? 'ready' : 'empty');
    return !partial;
  },

  _openTab(tab) {
    const button = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (button && getComputedStyle(button).display !== 'none') button.click();
  },

  openGovernanceReview() { this._openTab('reports'); },

  openGovernanceFlow() { this._openTab('manage'); },

  _destroyTrendCharts() {
    this._trendCharts.forEach(chart => {
      try { chart.destroy(); } catch {}
    });
    this._trendCharts = [];
  },

  _renderTrendCharts(model) {
    this._destroyTrendCharts();
    if (typeof Chart === 'undefined') return;
    const labels = model.rows.map(row => row.label);
    const currencyTick = value => {
      const amount = this._number(value);
      return Math.abs(amount) >= 10000 ? `¥${(amount / 10000).toFixed(1)}万` : `¥${amount}`;
    };
    const tooltipLabel = context => `${context.dataset.label}: ${this._money(context.parsed.y)}`;
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 14, usePointStyle: true } },
        tooltip: { callbacks: { label: tooltipLabel } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: currencyTick }, grid: { color: 'rgba(31,68,48,.08)' } }
      }
    };
    const performanceCanvas = document.getElementById('operations-performance-chart');
    const definitionCanvas = document.getElementById('operations-definition-chart');
    if (performanceCanvas) this._trendCharts.push(new Chart(performanceCanvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        { label: '2.0净收入', data: model.rows.map(row => row.revenue), borderColor: '#246044', backgroundColor: '#246044', tension: .28, pointRadius: 2 },
        { label: '总成本', data: model.rows.map(row => row.totalCost), borderColor: '#a8673f', backgroundColor: '#a8673f', tension: .28, pointRadius: 2 },
        { label: '销售毛利', data: model.rows.map(row => row.grossProfit), borderColor: '#c28b2c', backgroundColor: '#c28b2c', tension: .28, pointRadius: 2 },
        { label: '经营贡献', data: model.rows.map(row => row.contribution), borderColor: '#233c31', backgroundColor: '#233c31', tension: .28, pointRadius: 2 }
      ] },
      options: commonOptions
    }));
    if (definitionCanvas) this._trendCharts.push(new Chart(definitionCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: '1.0净收入', data: model.rows.map(row => row.legacyRevenue), backgroundColor: 'rgba(116,126,120,.45)', borderRadius: 3 },
        { label: '2.0净收入', data: model.rows.map(row => row.revenue), backgroundColor: 'rgba(36,96,68,.72)', borderRadius: 3 },
        { type: 'line', label: '口径差异', data: model.rows.map(row => row.difference), borderColor: '#c28b2c', backgroundColor: '#c28b2c', tension: .2, pointRadius: 2 }
      ] },
      options: commonOptions
    }));
  },

  _setTrendState(label, state) {
    const indicator = document.getElementById('operations-trend-state');
    if (!indicator) return;
    indicator.className = `operations-state-pill ${state}`;
    indicator.textContent = label;
  },

  async _loadTrend() {
    const target = document.getElementById('operations-trend-content');
    if (!target) return false;
    const loadId = ++this._trendLoadId;
    this._destroyTrendCharts();
    this._setTrendState('加载中', 'loading');
    target.innerHTML = this._loadingHtml('月度趋势');
    const year = this._period.year;
    try {
      const [summaryRows, legacyRows] = await Promise.all([
        Store._request('GET', `/rest/v1/business_layer_summary_v2?period_month=gte.${year}-01&period_month=lte.${year}-12&order=period_month.asc&limit=48`),
        Store._request('GET', `/rest/v1/revenue_facts?date=gte.${year}-01-01&date=lte.${year}-12-31&order=date.asc&limit=5000`)
      ]);
      if (loadId !== this._trendLoadId) return false;
      const model = this._buildTrendModel(year, summaryRows || [], legacyRows || []);
      target.innerHTML = this._trendHtml(model);
      this._renderTrendCharts(model);
      this._setTrendState(model.hasData ? '数据已就绪' : '空年度', model.hasData ? 'ready' : 'empty');
      return true;
    } catch (error) {
      if (loadId !== this._trendLoadId) return false;
      this._destroyTrendCharts();
      this._setTrendState('加载失败', 'error');
      target.innerHTML = '<div class="operations-error-state"><strong>月度趋势加载失败</strong><span>无法读取当前年份的经营汇总或 1.0 对照数据；总览和其他分区不受影响。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard.refresh()">重新加载</button></div>';
      return false;
    }
  },

  async _loadAll(message = '正在加载') {
    const loadId = ++this._loadAllId;
    const refreshButton = document.getElementById('operations-refresh');
    const status = document.getElementById('operations-refresh-status');
    if (refreshButton) refreshButton.disabled = true;
    if (status) status.textContent = `${message} · ${this._periodLabel()}`;
    const [overviewOk, trendOk, governanceOk, modelOk, detailOk] = await Promise.all([this._loadOverview(), this._loadTrend(), this._loadGovernance(), this._loadBusinessModel(), this._loadDetail()]);
    if (loadId !== this._loadAllId) return;
    const results = [overviewOk, trendOk, governanceOk, modelOk, detailOk];
    if (status) status.textContent = `${results.every(Boolean) ? '已更新' : results.some(Boolean) ? '部分数据加载失败' : '加载失败'} · ${this._periodLabel()}`;
    if (refreshButton) refreshButton.disabled = false;
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
      return true;
    } catch (error) {
      if (loadId !== this._overviewLoadId) return;
      this._setOverviewState('加载失败', 'error');
      overview.innerHTML = '<div class="operations-error-state"><strong>经营总览加载失败</strong><span>无法读取当前期间的只读经营汇总，请稍后重试。</span><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsDashboard.refresh()">重新加载</button></div>';
      layers.innerHTML = '<div class="operations-error-state"><strong>四层矩阵暂不可用</strong><span>其他运营管理分区仍可继续查看。</span></div>';
      return false;
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
          <div class="operations-section-heading"><div><span>03</span><h3>趋势与口径比较</h3><em id="operations-trend-state" class="operations-state-pill loading">加载中</em></div><p>月度经营变化及 1.0/2.0 差异</p></div>
          <div id="operations-trend-content">${this._loadingHtml('月度趋势')}</div>
        </section>

        <section id="operations-governance" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>04</span><h3>数据治理工作台</h3><em id="operations-governance-state" class="operations-state-pill loading">加载中</em></div><p>问题、候选、证据与治理批次</p></div>
          <div id="operations-governance-content">${this._loadingHtml('数据治理工作台')}</div>
        </section>

        <section id="operations-model" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>05</span><h3>业务模型对应</h3><em id="operations-model-state" class="operations-state-pill loading">加载中</em></div><p>四类维度、事实来源和页面指标映射</p></div>
          <div id="operations-model-content">${this._loadingHtml('业务模型')}</div>
        </section>

        <section id="operations-detail" class="card operations-section" tabindex="-1">
          <div class="operations-section-heading"><div><span>06</span><h3>明细与导出</h3><em id="operations-detail-state" class="operations-state-pill loading">加载中</em></div><p>统一筛选、来源定位与可复核证据</p></div>
          <div id="operations-detail-content">${this._loadingHtml('经营明细')}</div>
        </section>
      </div>`;
    await this._loadAll('正在加载');
  },

  async setPeriod(year, month) {
    if (!/^\d{4}$/.test(String(year)) || !/^(0[1-9]|1[0-2])$/.test(String(month))) return;
    this._period = { year: String(year), month: String(month) };
    const shell = document.querySelector('.operations-shell');
    if (shell) shell.dataset.period = `${this._period.year}-${this._period.month}`;
    const label = document.getElementById('operations-period-label');
    if (label) label.textContent = this._periodLabel();
    await this._loadAll('正在加载');
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
    await this._loadAll('正在刷新');
  }
};

if (typeof window !== 'undefined') window.OperationsDashboard = OperationsDashboard;
