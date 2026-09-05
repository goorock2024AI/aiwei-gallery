// charts.js — Chart.js 图表渲染（Supabase 异步版）
var Charts = {
  _charts: {},
  _chartColors: {
    revenue: {
      total: '#222222',
      floor: '#d73a31',
      ticket: '#2563eb',
      combo: '#7c3aed',
      coffee: '#d97706',
      workshop: '#b8863a',
      creative: '#64748b',
      venue: '#0f766e',
      gallery: '#8e44ad',
      other: '#52525b'
    },
    expense: {
      expense: '#c0392b',
      borrow: '#15803d',
      palette: ['#c0392b', '#b45309', '#2563eb', '#0f766e', '#7c3aed', '#64748b', '#b8863a', '#52525b']
    }
  },
  _revStructPeriod: 'month', // 收入结构卡片期间维度：'month' 月度 / 'year' 年度
  _expCatPeriod: 'month',    // 支出分类卡片期间维度：'month' 月度 / 'year' 年度
  _revOverviewPeriod: 'day', // 收入总览卡片期间维度：'day' 本日 / 'month' 本月 / 'year' 本年 / 'custom' 选定日（默认当日）
  _revOverviewCustomDate: null, // 选定日期模式下的目标日期（YYYY-MM-DD），首次进入时取 todayStr()
  _revenueCompareCategories: ['总收入', '门票', '咖啡套票', '咖啡', '工坊', '文创', '场地', '画廊', '其他'],

  _destroy(id) {
    if (this._charts[id]) { this._charts[id].destroy(); delete this._charts[id]; }
  },

  _isNarrowChart() {
    return (window.innerWidth || document.documentElement.clientWidth || 0) <= 768;
  },

  _formatMoney(value) {
    const n = +value || 0;
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  _renderBreakdownSummary(targetId, labels, data, colors, emptyText) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const rows = labels
      .map((label, i) => ({
        label,
        value: +data[i] || 0,
        color: colors[i] || '#64748b'
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = rows.reduce((sum, item) => sum + item.value, 0);
    if (!rows.length || total <= 0) {
      target.innerHTML = `<div class="chart-summary-empty">${emptyText || '暂无可展示数据'}</div>`;
      return;
    }

    const topRows = rows.slice(0, 6).map(item => {
      const pct = (item.value / total * 100).toFixed(1);
      return `
        <div class="chart-summary-row">
          <span class="chart-summary-name"><i style="background:${item.color}"></i>${item.label}</span>
          <span class="chart-summary-value">${this._formatMoney(item.value)} <em>${pct}%</em></span>
        </div>
      `;
    }).join('');

    target.innerHTML = `
      <div class="chart-summary-total">合计 ${this._formatMoney(total)}</div>
      <div class="chart-summary-list">${topRows}</div>
    `;
  },

  _renderInsightList(targetId, items) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const validItems = (items || []).filter(Boolean);
    if (!validItems.length) {
      target.innerHTML = '';
      return;
    }
    target.innerHTML = `
      <div class="chart-insights">
        ${validItems.map(item => `
          <div class="chart-insight">
            <span>${this._escapeHtml(item.label)}</span>
            <strong>${this._escapeHtml(item.value)}</strong>
            <em>${this._escapeHtml(item.note || '')}</em>
          </div>
        `).join('')}
      </div>
    `;
  },

  _rankEntries(labels, data) {
    return labels
      .map((label, i) => ({ label, value: +data[i] || 0 }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  },

  _getYM() {
    const year = document.getElementById('rpt-year')?.value || '2026';
    const month = document.getElementById('rpt-month')?.value || '';
    return { year, month };
  },

  _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  },

  _formatDeltaPct(current, previous) {
    if (!previous) return current ? '新增' : '-';
    const pct = (current - previous) / Math.abs(previous) * 100;
    const sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(1) + '%';
  },

  _getRevenueCompareSelection() {
    const controls = document.getElementById('revenue-compare-categories');
    if (controls) {
      return Array.from(controls.querySelectorAll('input:checked')).map(input => input.value);
    }
    try {
      const saved = JSON.parse(localStorage.getItem('aiwei_revenue_compare_categories') || '[]');
      if (Array.isArray(saved) && saved.length) return saved.filter(c => this._revenueCompareCategories.includes(c));
    } catch {}
    return ['总收入', '门票', '咖啡', '工坊', '文创', '场地', '画廊'];
  },

  _factAmount(row) {
    return Number(row?.netAmount ?? row?.net_amount ?? row?.amount ?? 0) || 0;
  },

  _factCategory(row) {
    const category = row?.category || '其他';
    return category === '场地旧口径' ? '场地' : category;
  },

  async _loadRevenueFactsForYear(year) {
    let facts = await Store.getByYear('revenueFacts', year);
    if (facts.length) return facts;

    const [legacyRevenues, legacyGallery, legacySpace] = await Promise.all([
      Store.getByYear('revenue', year),
      Store.getByYear('gallery', year),
      Store.getAll('space')
    ]);
    const pushFact = (arr, date, category, amount, projectName) => {
      if ((+amount || 0) !== 0) arr.push({ date, category, amount, netAmount: amount, projectName });
    };
    facts = [];
    legacyRevenues.forEach(r => {
      pushFact(facts, r.date, '门票', r.ticketAmount, r.projectName);
      pushFact(facts, r.date, '咖啡套票', r.comboAmount, r.projectName);
      pushFact(facts, r.date, '咖啡', r.coffeeAmount, r.projectName);
      pushFact(facts, r.date, '工坊', r.workshopAmount, r.projectName);
      pushFact(facts, r.date, '文创', (+r.retailAmount || 0) + (+r.creativeAmount || 0), r.projectName);
      pushFact(facts, r.date, '场地', r.venueAmount, r.projectName);
      pushFact(facts, r.date, '其他', r.otherAmount, r.projectName || r.otherDesc);
    });
    legacyGallery.forEach(r => {
      pushFact(facts, r.date, '画廊', (+r.price || 0) - (+r.commission || 0), r.artworkName || r.artwork_name);
    });
    legacySpace.forEach(s => {
      if (s.rentalType !== '付费') return;
      (s.payments || []).forEach(p => {
        if ((p.paymentDate || '').startsWith(year)) pushFact(facts, p.paymentDate, '场地', +p.amount || 0, s.projectName || s.project_name);
      });
    });
    return facts;
  },

  _aggregateRevenueMonthly(facts, categories, year) {
    const byCategory = {};
    const totals = Array(12).fill(0);
    const monthDetails = Array.from({ length: 12 }, () => ({}));
    categories.forEach(category => { byCategory[category] = Array(12).fill(0); });

    facts.forEach(row => {
      const date = String(row.date || '').slice(0, 10);
      if (!date.startsWith(year + '-')) return;
      const category = this._factCategory(row);
      if (!categories.includes(category)) return;
      const monthIndex = Number(date.slice(5, 7)) - 1;
      if (monthIndex < 0 || monthIndex > 11) return;
      const amount = this._factAmount(row);
      byCategory[category][monthIndex] += amount;
      totals[monthIndex] += amount;
      const key = row.projectName || row.project_name || row.sourceName || row.source_name || category;
      monthDetails[monthIndex][key] = (monthDetails[monthIndex][key] || 0) + amount;
    });

    return { byCategory, totals, monthDetails };
  },

  _buildRevenueComparisonDatasets(year, categories, current, previous, colorByCategory, options) {
    options = options || {};
    const datasets = [];
    if (options.includeGrandTotal && options.grandCurrent) {
      datasets.push({
        label: `${year}年总收入`,
        data: options.grandCurrent.totals,
        borderColor: this._chartColors.revenue.total,
        backgroundColor: this._chartColors.revenue.total,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.28,
        fill: false,
        order: 0,
        _compareRole: 'grand-total'
      });
    }
    if (categories.length) datasets.push({
      label: `${year}年筛选合计`,
      data: current.totals,
      borderColor: this._chartColors.revenue.total,
      backgroundColor: this._chartColors.revenue.total,
      borderWidth: 3,
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0.28,
      fill: false,
      order: 0,
      _compareRole: 'current-total'
    });
    datasets.push(...categories.map(category => ({
      label: category,
      data: current.byCategory[category] || Array(12).fill(0),
      borderColor: colorByCategory[category] || '#64748b',
      backgroundColor: colorByCategory[category] || '#64748b',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.28,
      fill: false,
      order: 1,
      _compareRole: 'category'
    })));
    const previousData = categories.length ? previous.totals : (options.grandPrevious?.totals || previous.totals);
    const previousDataset = {
      label: `${+year - 1}年同口径合计`,
      data: previousData,
      borderColor: '#8a8578',
      backgroundColor: '#8a8578',
      borderWidth: 2,
      borderDash: [6, 5],
      pointRadius: 0,
      tension: 0.2,
      fill: false,
      order: 2,
      _compareRole: 'previous-total'
    };
    datasets.push(previousDataset);
    return datasets;
  },

  _onFilterChange() {
    this.renderAll();
  },

  async renderAll() {
    const { year, month } = this._getYM();
    const page = document.getElementById('page-reports');
    if (!page) return;

    // 数据总览（独立周期，与顶部年份/月份 select 解耦）
    await this._renderRevenueOverview(this._revOverviewPeriod);

    const container = document.getElementById('report-charts');
    html(container, `
      <div class="chart-grid">
        <div class="report-section-title">
          <span>趋势变化</span>
          <em>先看当月日变化，再看全年月度变化。</em>
        </div>
        <div class="chart-box full rpt-daily-trend">
          <div class="chart-title-row">
            <div>
              <div class="chart-title">当月日收入趋势</div>
              <div class="chart-subtitle">识别本月收入峰值、低谷和经营基准线关系</div>
            </div>
          </div>
          <canvas id="chart-daily-revenue"></canvas>
          <div id="chart-daily-revenue-insights"></div>
        </div>
        <div class="chart-box full">
          <div class="chart-title">月度收入趋势</div>
          <div class="chart-subtitle">全年总收入和各分类贡献的月度走势</div>
          <canvas id="chart-revenue-trend"></canvas>
          <div id="chart-revenue-trend-insights"></div>
        </div>
        <div class="report-section-title">
          <span>结构归因</span>
          <em>解释收入变化来自哪些分类，并保留同口径对比。</em>
        </div>
        <div class="chart-box full revenue-compare-box">
          <div class="chart-title-row">
            <div>
              <div class="chart-title">收入对比与归因</div>
              <div class="chart-subtitle">筛选收入分类，查看今年合计、分类贡献和去年同口径趋势</div>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="Charts.renderRevenueComparison()">更新对比</button>
          </div>
          <div class="revenue-compare-controls" id="revenue-compare-categories">
            ${this._revenueCompareCategories.map(category => `
              <label class="compare-check">
                <input type="checkbox" value="${category}" ${this._getRevenueCompareSelection().includes(category) ? 'checked' : ''}>
                <span>${category}</span>
              </label>
            `).join('')}
          </div>
          <div class="revenue-compare-summary" id="revenue-compare-summary"></div>
          <canvas id="chart-revenue-comparison"></canvas>
        </div>
        <div class="chart-box">
          <div class="chart-title-row">
            <div class="chart-title" id="rev-struct-title">收入结构</div>
            <div class="chart-toggle" id="rev-struct-toggle">
              <button type="button" data-period="month" class="active">月度</button>
              <button type="button" data-period="year">年度</button>
            </div>
          </div>
          <canvas id="chart-revenue-structure"></canvas>
          <div id="chart-revenue-structure-summary" class="chart-summary"></div>
        </div>
        <div class="chart-box">
          <div class="chart-title-row">
            <div class="chart-title" id="exp-cat-title">支出分类汇总</div>
            <div class="chart-toggle" id="exp-cat-toggle">
              <button type="button" data-period="month" class="active">月度</button>
              <button type="button" data-period="year">年度</button>
            </div>
          </div>
          <canvas id="chart-expense-category"></canvas>
          <div id="chart-expense-category-summary" class="chart-summary"></div>
        </div>
        <div class="chart-box"><div class="chart-title">月度支出趋势</div><canvas id="chart-expense-trend"></canvas><div id="chart-expense-trend-insights"></div></div>
        <div class="chart-box"><div class="chart-title">工坊项目销量排名</div><canvas id="chart-workshop-rank"></canvas></div>
      </div>
    `);
    // 延迟一帧让 canvas 元素创建完毕
    await new Promise(r => setTimeout(r, 100));
    await this.renderDailyRevenueTrend();
    await this.renderRevenueTrend(year);
    await this.renderRevenueComparison();
    await this.renderRevenueStructure();
    this._bindRevStructToggle();
    await this.renderExpenseCategory();
    this._bindExpCatToggle();
    await this.renderExpenseTrend(year);
    await this.renderWorkshopRank();
  },

  async renderRevenueComparison() {
    const canvas = document.getElementById('chart-revenue-comparison');
    if (!canvas) return;
    this._destroy('revenue-comparison');

    const { year } = this._getYM();
    const selected = this._getRevenueCompareSelection();
    const allCategories = this._revenueCompareCategories.filter(category => category !== '总收入');
    const includeGrandTotal = selected.includes('总收入');
    const categories = selected.filter(category => category !== '总收入');
    const compareCategories = categories.length ? categories : (includeGrandTotal ? [] : allCategories);
    const storedSelection = selected.length ? selected : ['总收入', ...allCategories];
    try {
      localStorage.setItem('aiwei_revenue_compare_categories', JSON.stringify(storedSelection));
    } catch {}

    const [facts, prevFacts] = await Promise.all([
      this._loadRevenueFactsForYear(year),
      this._loadRevenueFactsForYear(String(+year - 1))
    ]);
    const current = this._aggregateRevenueMonthly(facts, compareCategories, year);
    const previous = this._aggregateRevenueMonthly(prevFacts, compareCategories, String(+year - 1));
    const grandCurrent = this._aggregateRevenueMonthly(facts, allCategories, year);
    const grandPrevious = this._aggregateRevenueMonthly(prevFacts, allCategories, String(+year - 1));
    const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
    const focusTotals = compareCategories.length ? current.totals : grandCurrent.totals;
    const prevFocusTotals = compareCategories.length ? previous.totals : grandPrevious.totals;
    const total = focusTotals.reduce((s, v) => s + v, 0);
    const prevTotal = prevFocusTotals.reduce((s, v) => s + v, 0);
    const bestMonthIndex = focusTotals.reduce((best, value, i) => value > focusTotals[best] ? i : best, 0);
    const latestMonthIndex = Math.max(0, Math.min(11, (year === todayStr().slice(0, 4) ? Number(todayStr().slice(5, 7)) : 12) - 1));
    const prevMonthIndex = Math.max(0, latestMonthIndex - 1);
    const mom = this._formatDeltaPct(focusTotals[latestMonthIndex], focusTotals[prevMonthIndex]);
    const yoy = this._formatDeltaPct(total, prevTotal);
    const fmt = n => this._formatMoney(n);

    const summary = document.getElementById('revenue-compare-summary');
    if (summary) {
      summary.innerHTML = `
        <div class="compare-metric"><span>${compareCategories.length ? '筛选合计' : '总收入'}</span><strong>${fmt(total)}</strong><em>${compareCategories.length ? `${year} 年已选分类` : `${year} 年全分类`}</em></div>
        <div class="compare-metric"><span>同比</span><strong class="${total >= prevTotal ? 'up' : 'down'}">${yoy}</strong><em>对比 ${+year - 1} 年</em></div>
        <div class="compare-metric"><span>环比增长率</span><strong class="${focusTotals[latestMonthIndex] >= focusTotals[prevMonthIndex] ? 'up' : 'down'}">${mom}</strong><em>${latestMonthIndex + 1}月 vs ${prevMonthIndex + 1}月</em></div>
        <div class="compare-metric"><span>峰值月份</span><strong>${bestMonthIndex + 1}月</strong><em>${fmt(focusTotals[bestMonthIndex])}</em></div>
      `;
    }

    const colorByCategory = {
      '门票': this._chartColors.revenue.ticket,
      '咖啡套票': this._chartColors.revenue.combo,
      '咖啡': this._chartColors.revenue.coffee,
      '工坊': this._chartColors.revenue.workshop,
      '文创': this._chartColors.revenue.creative,
      '场地': this._chartColors.revenue.venue,
      '画廊': this._chartColors.revenue.gallery,
      '其他': this._chartColors.revenue.other
    };
    const datasets = this._buildRevenueComparisonDatasets(year, compareCategories, current, previous, colorByCategory, {
      includeGrandTotal,
      grandCurrent,
      grandPrevious
    });

    this._charts['revenue-comparison'] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              afterBody: (context) => {
                const idx = context[0].dataIndex;
                return [
                  `${year}年当前口径: ${fmt(focusTotals[idx])}`,
                  `${+year - 1}年同口径: ${fmt(prevFocusTotals[idx])}`,
                  `环比: ${this._formatDeltaPct(focusTotals[idx], focusTotals[Math.max(0, idx - 1)])}`
                ];
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => '¥' + v } }
        }
      }
    });

    const controls = document.getElementById('revenue-compare-categories');
    if (controls && !controls._bound) {
      controls._bound = true;
      controls.addEventListener('change', () => this.renderRevenueComparison());
    }
  },

  _renderRevenueComparisonTable(year, current, previous, categories) {
    const target = document.getElementById('revenue-compare-table');
    if (!target) return;
    const rows = Array.from({ length: 12 }, (_, i) => {
      const detailEntries = Object.entries(current.monthDetails[i] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, amount]) => `${this._escapeHtml(name)} ${this._formatMoney(amount)}`)
        .join(' · ');
      return {
        month: i + 1,
        total: current.totals[i],
        prev: previous.totals[i],
        topCategory: categories
          .map(category => ({ category, value: current.byCategory[category]?.[i] || 0 }))
          .sort((a, b) => b.value - a.value)[0],
        detail: detailEntries || '暂无明细'
      };
    });
    target.innerHTML = `
      <div class="table-wrap compare-table-wrap">
        <table class="data-table">
          <thead><tr><th>月份</th><th>${year}年收入</th><th>${+year - 1}年同月</th><th>同比</th><th>贡献最高分类</th><th>主要项目/来源</th></tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${row.month}月</td>
                <td><strong>${this._formatMoney(row.total)}</strong></td>
                <td>${this._formatMoney(row.prev)}</td>
                <td><span class="${row.total >= row.prev ? 'compare-up' : 'compare-down'}">${this._formatDeltaPct(row.total, row.prev)}</span></td>
                <td>${this._escapeHtml(row.topCategory.category)} ${this._formatMoney(row.topCategory.value)}</td>
                <td>${row.detail}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  async _renderRevenueOverview(period) {
    const page = document.getElementById('page-reports');
    if (!page) return;

    period = period || this._revOverviewPeriod || 'day';
    this._revOverviewPeriod = period;

    const today = todayStr();
    const ym = today.slice(0, 7);
    const year = today.slice(0, 4);
    const customDate = this._revOverviewCustomDate || today;

    // 一次拉全年，内存按日期前缀过滤（与 _renderGallerySalesStats 同款模式）
    const factYear = period === 'custom' ? customDate.slice(0, 4) : year;
    let revenueFacts = await Store.getByYear('revenueFacts', factYear);
    if (!revenueFacts.length) {
      const [legacyRevenues, legacyGallery, legacySpace] = await Promise.all([
        Store.getByYear('revenue', factYear),
        Store.getByYear('gallery', factYear),
        Store.getAll('space')
      ]);
      const pushFact = (arr, date, category, amount) => {
        if ((+amount || 0) !== 0) arr.push({ date, category, amount, netAmount: amount });
      };
      revenueFacts = [];
      legacyRevenues.forEach(r => {
        pushFact(revenueFacts, r.date, '门票', r.ticketAmount);
        pushFact(revenueFacts, r.date, '咖啡套票', r.comboAmount);
        pushFact(revenueFacts, r.date, '咖啡', r.coffeeAmount);
        pushFact(revenueFacts, r.date, '工坊', r.workshopAmount);
        pushFact(revenueFacts, r.date, '文创', (+r.retailAmount || 0) + (+r.creativeAmount || 0));
        pushFact(revenueFacts, r.date, '场地旧口径', r.venueAmount);
        pushFact(revenueFacts, r.date, '其他', r.otherAmount);
      });
      legacyGallery.forEach(r => {
        pushFact(revenueFacts, r.date, '画廊', (+r.price || 0) - (+r.commission || 0));
      });
      legacySpace.forEach(s => {
        if (s.rentalType !== '付费') return;
        (s.payments || []).forEach(p => {
          if ((p.paymentDate || '').startsWith(factYear)) pushFact(revenueFacts, p.paymentDate, '场地', +p.amount || 0);
        });
      });
    }
    const factAmount = (r) => Number(r.netAmount ?? r.net_amount ?? r.amount ?? 0) || 0;
    const factIs = (r, category) => r.category === category;
    const revenues = revenueFacts.map(r => {
      const amount = factAmount(r);
      return {
        date: r.date,
        ticketAmount: factIs(r, '门票') ? amount : 0,
        comboAmount: factIs(r, '咖啡套票') ? amount : 0,
        coffeeAmount: factIs(r, '咖啡') ? amount : 0,
        workshopAmount: factIs(r, '工坊') ? amount : 0,
        retailAmount: factIs(r, '文创') ? amount : 0,
        creativeAmount: 0,
        venueAmount: factIs(r, '场地旧口径') ? amount : 0,
        otherAmount: factIs(r, '其他') ? amount : 0
      };
    });
    const galleryAll = revenueFacts
      .filter(r => factIs(r, '画廊'))
      .map(r => ({ date: r.date, price: factAmount(r), commission: 0 }));
    const spaceAll = revenueFacts
      .filter(r => factIs(r, '场地'))
      .map(r => ({ rentalType: '付费', payments: [{ paymentDate: r.date, amount: factAmount(r) }] }));

    const periodLabel = period === 'day' ? `本日（${today}）`
                      : period === 'month' ? `本月（${ym}）`
                      : period === 'year' ? `本年（${year}）`
                      : `选定日（${customDate}）`;
    const periodTitle = period === 'day' ? today
                      : period === 'month' ? year + '年' + parseInt(ym.slice(5)) + '月'
                      : period === 'year' ? year + '年全年'
                      : customDate;

    // 按 period 过滤
    const inPeriod = (d) => {
      const ds = String(d || '').slice(0, 10);
      if (period === 'day') return ds === today;
      if (period === 'month') return ds.startsWith(ym);
      if (period === 'year') return ds.startsWith(year);
      return ds === customDate;
    };

    const monthRev = revenues.filter(r => inPeriod(r.date));
    const monthGal = galleryAll.filter(r => inPeriod(r.date));

    // 场地按 paymentDate 过滤（口径与现状一致）
    let spaceRentIncome = 0;
    spaceAll.forEach(s => {
      if (s.rentalType !== '付费') return;
      const payments = s.payments || [];
      payments.forEach(p => {
        if (inPeriod(p.paymentDate)) spaceRentIncome += +p.amount || 0;
      });
    });

    const totalRevenue = monthRev.reduce((s, r) => s + (r.ticketAmount||0) + (r.comboAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0), 0)
      + monthGal.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0)
      + spaceRentIncome;

    const ticketTotal = monthRev.reduce((s, r) => s + (r.ticketAmount||0), 0);
    const comboTotal = monthRev.reduce((s, r) => s + (r.comboAmount||0), 0);
    const coffeeTotal = monthRev.reduce((s, r) => s + (r.coffeeAmount||0), 0);
    const workshopTotal = monthRev.reduce((s, r) => s + (r.workshopAmount||0), 0);
    const creativeTotal = monthRev.reduce((s, r) => s + (r.retailAmount||0) + (r.creativeAmount||0), 0);
    const venueTotal = spaceRentIncome;
    const galleryTotal = monthGal.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0);
    const otherTotal = monthRev.reduce((s, r) => s + (r.otherAmount||0), 0);
    const categoryTotals = [
      { label: '门票', value: ticketTotal },
      { label: '咖啡套票', value: comboTotal },
      { label: '咖啡', value: coffeeTotal },
      { label: '工坊', value: workshopTotal },
      { label: '文创/零售', value: creativeTotal },
      { label: '场地', value: venueTotal },
      { label: '画廊', value: galleryTotal },
      { label: '其他', value: otherTotal }
    ];
    const rankedCategories = categoryTotals.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
    const topCategory = rankedCategories[0];
    const activeCategoryCount = rankedCategories.length;
    const concentration = topCategory && totalRevenue > 0 ? (topCategory.value / totalRevenue * 100).toFixed(1) + '%' : '-';

    const _fmt = n => Number(n || 0).toFixed(2);

    const existing = page.querySelector('.rpt-overview');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'rpt-overview';
    div.innerHTML = `
      <div class="card">
        <div class="chart-title-row">
          <div class="card-title" style="margin-bottom:0">📊 收入总览（${periodTitle}）</div>
          <div class="chart-toggle" id="rev-overview-toggle">
            <button type="button" data-period="day" class="${period === 'day' ? 'active' : ''}">本日</button>
            <button type="button" data-period="month" class="${period === 'month' ? 'active' : ''}">本月</button>
            <button type="button" data-period="year" class="${period === 'year' ? 'active' : ''}">本年</button>
            <input type="date" id="rev-overview-date" class="rev-overview-date-input ${period === 'custom' ? 'active' : ''}" value="${customDate}" max="${today}" title="选择任意历史日期查看当日收入总览" />
          </div>
        </div>
        <div class="overview-decision-grid">
          <div class="overview-primary-card">
            <span>经营收入</span>
            <strong>¥${_fmt(totalRevenue)}</strong>
            <em>${periodLabel}</em>
          </div>
          <div class="overview-primary-card">
            <span>主要来源</span>
            <strong>${topCategory ? topCategory.label : '暂无收入'}</strong>
            <em>${topCategory ? `贡献 ¥${_fmt(topCategory.value)}` : '当前期间无收入记录'}</em>
          </div>
          <div class="overview-primary-card">
            <span>结构集中度</span>
            <strong>${concentration}</strong>
            <em>${topCategory ? `${topCategory.label} 占总收入` : '暂无可计算结构'}</em>
          </div>
        </div>
        <div class="overview-diagnostic-grid">
          <div class="diagnostic-card"><span>活跃分类</span><strong>${activeCategoryCount}</strong><em>${activeCategoryCount ? '个分类有收入' : '暂无收入分类'}</em></div>
          <div class="diagnostic-card"><span>次要来源</span><strong>${rankedCategories[1] ? rankedCategories[1].label : '-'}</strong><em>${rankedCategories[1] ? `贡献 ¥${_fmt(rankedCategories[1].value)}` : '暂无第二收入来源'}</em></div>
          <div class="diagnostic-card"><span>追溯线索</span><strong>${rankedCategories.length ? rankedCategories.slice(0, 3).map(item => item.label).join(' / ') : '-'}</strong><em>优先查看这些分类的明细</em></div>
        </div>
        <div class="overview-category-strip">
          ${categoryTotals.map(item => {
            const pct = totalRevenue > 0 ? Math.max(0, item.value / totalRevenue * 100) : 0;
            return `
              <div class="overview-category-row">
                <span>${item.label}</span>
                <div><i style="width:${pct}%"></i></div>
                <strong>¥${_fmt(item.value)}</strong>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    page.insertBefore(div, page.querySelector('.filter-bar')?.nextSibling || null);

    this._bindRevOverviewToggle();
  },

  _bindRevOverviewToggle() {
    const toggle = document.getElementById('rev-overview-toggle');
    if (!toggle || toggle._bound) return;
    toggle._bound = true;
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-period]');
      if (!btn) return;
      const p = btn.dataset.period;
      if (p === this._revOverviewPeriod) return;
      toggle.querySelectorAll('button[data-period], input.rev-overview-date-input').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      this._renderRevenueOverview(p);
    });
    const dateInput = document.getElementById('rev-overview-date');
    if (dateInput && !dateInput._bound) {
      dateInput._bound = true;
      dateInput.addEventListener('change', (e) => {
        const v = e.target.value;
        if (!v) return;
        this._revOverviewCustomDate = v;
        toggle.querySelectorAll('button[data-period]').forEach(b => b.classList.remove('active'));
        dateInput.classList.add('active');
        this._renderRevenueOverview('custom');
      });
    }
  },

  async renderDashboardTrend() {
    const canvas = $('#dashboard-trend');
    if (!canvas) return;
    this._destroy('dashboard-trend');

    const days = [];
    const labels = [];
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      days.push(ds);
      labels.push(ds.slice(5));
    }

    const allRev = await Store.getAll('revenue');
    days.forEach(d => {
      const totals = allRev.filter(r => r.date === d).reduce((s, r) => s + (r.ticketAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0), 0);
      data.push(totals);
    });

    const ctx = canvas.getContext('2d');
    this._charts['dashboard-trend'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '日收入',
          data,
          borderColor: this._chartColors.revenue.venue,
          backgroundColor: 'rgba(15,118,110,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: this._chartColors.revenue.venue
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => '¥' + v } }
        }
      }
    });
  },

  async renderRevenueTrend(year) {
    const canvas = $('#chart-revenue-trend');
    if (!canvas) return;
    this._destroy('revenue-trend');

    const months = await Store.getMonthlySummary('revenue', year);
    const galleryMonths = await Store.getMonthlySummary('gallery', year);
    const spaceAll = await Store.getAll('space');
    const labels = [];
    const ticketData = [];
    const comboData = [];
    const coffeeData = [];
    const workshopData = [];
    const creativeData = [];
    const venueData = [];
    const galleryData = [];
    const otherData = [];

    // 按到账月（paymentDate）预聚合空间收入 — 避免与 revenue.venueAmount 重复计入
    const spacePaymentsByMonth = {};
    spaceAll.forEach(s => {
      if (s.rentalType !== '付费') return;
      (s.payments || []).forEach(p => {
        const pd = p.paymentDate || '';
        if (!pd.startsWith(year)) return;
        const mm = pd.slice(5, 7);
        spacePaymentsByMonth[mm] = (spacePaymentsByMonth[mm] || 0) + (+p.amount || 0);
      });
    });

    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      labels.push(m + '月');
      const recs = months[ms];
      const grecs = galleryMonths[ms];
      const spRecs = spaceAll.filter(r => (r.date||'').startsWith(year + '-' + ms) && r.rentalType === '付费');
      let t = 0, cb = 0, c = 0, w = 0, cr = 0, v = 0, g = 0, o = 0;
      recs.forEach(r => {
        t += r.ticketAmount || 0;
        cb += r.comboAmount || 0;
        c += r.coffeeAmount || 0;
        w += r.workshopAmount || 0;
        cr += (r.retailAmount || 0) + (r.creativeAmount || 0);
        v += r.venueAmount || 0;
        o += r.otherAmount || 0;
      });
      grecs.forEach(r => { g += (r.price||0) - (r.commission||0); });
      ticketData.push(t);
      comboData.push(cb);
      coffeeData.push(c);
      workshopData.push(w);
      creativeData.push(cr);
      // venue 字段用空间付款聚合（不再累加 revenue.venueAmount + 视图 receivedAmount）
      venueData.push(spacePaymentsByMonth[ms] || 0);
      galleryData.push(g);
      otherData.push(o);
    }

    // 每月合计金额
    const totalData = labels.map((_, i) => ticketData[i] + comboData[i] + coffeeData[i] + workshopData[i] + creativeData[i] + venueData[i] + galleryData[i] + otherData[i]);
    const bestMonthIndex = totalData.reduce((best, value, i) => value > totalData[best] ? i : best, 0);
    const categoryTotals = this._rankEntries(
      ['门票', '咖啡套票', '咖啡', '工坊', '文创', '场地', '画廊', '其他'],
      [
        ticketData.reduce((s, v) => s + v, 0),
        comboData.reduce((s, v) => s + v, 0),
        coffeeData.reduce((s, v) => s + v, 0),
        workshopData.reduce((s, v) => s + v, 0),
        creativeData.reduce((s, v) => s + v, 0),
        venueData.reduce((s, v) => s + v, 0),
        galleryData.reduce((s, v) => s + v, 0),
        otherData.reduce((s, v) => s + v, 0)
      ]
    );

    const ctx = canvas.getContext('2d');
    this._charts['revenue-trend'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '门票', data: ticketData, backgroundColor: this._chartColors.revenue.ticket },
          { label: '咖啡套票', data: comboData, backgroundColor: this._chartColors.revenue.combo },
          { label: '咖啡', data: coffeeData, backgroundColor: this._chartColors.revenue.coffee },
          { label: '工坊', data: workshopData, backgroundColor: this._chartColors.revenue.workshop },
          { label: '文创', data: creativeData, backgroundColor: this._chartColors.revenue.creative },
          { label: '场地', data: venueData, backgroundColor: this._chartColors.revenue.venue },
          { label: '画廊', data: galleryData, backgroundColor: this._chartColors.revenue.gallery },
          { label: '其他', data: otherData, backgroundColor: this._chartColors.revenue.other }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              afterBody: function(context) {
                const idx = context[0].dataIndex;
                const total = totalData[idx];
                return '合计: ¥' + (total || 0).toFixed(2);
              }
            }
          }
        },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { callback: v => '¥' + v } }
        }
      }
    });
    this._renderInsightList('chart-revenue-trend-insights', [
      {
        label: '全年峰值',
        value: totalData[bestMonthIndex] > 0 ? `${bestMonthIndex + 1}月 ${this._formatMoney(totalData[bestMonthIndex])}` : '暂无收入',
        note: '先定位峰值月份，再看结构归因'
      },
      {
        label: '年度主来源',
        value: categoryTotals[0] ? `${categoryTotals[0].label} ${this._formatMoney(categoryTotals[0].value)}` : '暂无收入',
        note: categoryTotals[1] ? `第二来源：${categoryTotals[1].label}` : '暂无第二收入来源'
      }
    ]);
  },

  async renderDailyRevenueTrend() {
    const canvas = $('#chart-daily-revenue');
    if (!canvas) return;
    this._destroy('daily-revenue');

    const { year, month } = this._getYM();
    // 如果没有选月份，默认使用当前月份
    const targetMonth = month || todayStr().slice(5, 7);
    const ym = year + '-' + targetMonth;
    const lastDay = new Date(+year, +targetMonth, 0).getDate();

    // 获取当月所有收入数据
    const revenues = await Store.getByMonth('revenue', ym);
    const galleryAll = await Store.getByMonth('gallery', ym);
    // space 走视图（拿到实时聚合的 payments）
    const spaceAll = await Store.getAll('space');

    const labels = [];
    const ticketData = [];
    const comboData = [];
    const coffeeData = [];
    const workshopData = [];
    const creativeData = [];
    const venueData = [];
    const galleryData = [];
    const otherData = [];

    for (let d = 1; d <= lastDay; d++) {
      const ds = ym + '-' + String(d).padStart(2, '0');
      labels.push(d + '日');
      const dayRev = revenues.filter(r => r.date === ds);
      const dayGal = galleryAll.filter(r => r.date === ds);
      const daySpace = spaceAll.filter(r => r.date === ds && r.rentalType === '付费');

      let t = 0, cb = 0, c = 0, w = 0, cr = 0, v = 0, g = 0, o = 0;
      dayRev.forEach(r => {
        t += r.ticketAmount || 0;
        cb += r.comboAmount || 0;
        c += r.coffeeAmount || 0;
        w += r.workshopAmount || 0;
        cr += (r.retailAmount || 0) + (r.creativeAmount || 0);
        o += r.otherAmount || 0;
      });
      dayGal.forEach(r => { g += (r.price || 0) - (r.commission || 0); });
      // 空间已收按 paymentDate == ds 精确匹配到日
      spaceAll.forEach(s => {
        if (s.rentalType !== '付费') return;
        (s.payments || []).forEach(p => { if (p.paymentDate === ds) v += +p.amount || 0; });
      });
      ticketData.push(t);
      comboData.push(cb);
      coffeeData.push(c);
      workshopData.push(w);
      creativeData.push(cr);
      venueData.push(v);
      galleryData.push(g);
      otherData.push(o);
    }

    // 每日合计
    const totalData = labels.map((_, i) =>
      ticketData[i] + comboData[i] + coffeeData[i] + workshopData[i] + creativeData[i] + venueData[i] + galleryData[i] + otherData[i]
    );
    const dailyRevenueFloor = 900;
    const dailyRevenueFloorData = labels.map(() => dailyRevenueFloor);
    const bestDayIndex = totalData.reduce((best, value, i) => value > totalData[best] ? i : best, 0);
    const activeDays = totalData.filter(value => value > 0).length;
    const monthTotal = totalData.reduce((sum, value) => sum + value, 0);

    const ctx = canvas.getContext('2d');
    this._charts['daily-revenue'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '合计', data: totalData, borderColor: this._chartColors.revenue.total, backgroundColor: this._chartColors.revenue.total, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: false, order: 0 },
          { label: '经营基准线 900', data: dailyRevenueFloorData, borderColor: this._chartColors.revenue.floor, backgroundColor: this._chartColors.revenue.floor, borderWidth: 1.25, borderDash: [6, 6], pointRadius: 0, pointHoverRadius: 0, tension: 0, fill: false, order: 1 },
          { label: '门票', data: ticketData, borderColor: this._chartColors.revenue.ticket, backgroundColor: this._chartColors.revenue.ticket, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '咖啡套票', data: comboData, borderColor: this._chartColors.revenue.combo, backgroundColor: this._chartColors.revenue.combo, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '咖啡', data: coffeeData, borderColor: this._chartColors.revenue.coffee, backgroundColor: this._chartColors.revenue.coffee, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '工坊', data: workshopData, borderColor: this._chartColors.revenue.workshop, backgroundColor: this._chartColors.revenue.workshop, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '文创', data: creativeData, borderColor: this._chartColors.revenue.creative, backgroundColor: this._chartColors.revenue.creative, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '场地', data: venueData, borderColor: this._chartColors.revenue.venue, backgroundColor: this._chartColors.revenue.venue, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '画廊', data: galleryData, borderColor: this._chartColors.revenue.gallery, backgroundColor: this._chartColors.revenue.gallery, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '其他', data: otherData, borderColor: this._chartColors.revenue.other, backgroundColor: this._chartColors.revenue.other, borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              afterBody: function(context) {
                const idx = context[0].dataIndex;
                const total = totalData[idx];
                return ['合计: ¥' + (total || 0).toFixed(2), '经营基准线: ¥' + dailyRevenueFloor.toFixed(2)];
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true },
          y: { beginAtZero: true, ticks: { callback: v => '¥' + v } }
        }
      }
    });
    this._renderInsightList('chart-daily-revenue-insights', [
      {
        label: '本月累计',
        value: this._formatMoney(monthTotal),
        note: `${activeDays} 天有收入记录`
      },
      {
        label: '日峰值',
        value: totalData[bestDayIndex] > 0 ? `${bestDayIndex + 1}日 ${this._formatMoney(totalData[bestDayIndex])}` : '暂无收入',
        note: '优先追溯峰值日的收入来源'
      },
      {
        label: '基准线',
        value: this._formatMoney(dailyRevenueFloor),
        note: '作为经营参照，降低视觉权重保留'
      }
    ]);
  },

  _bindRevStructToggle() {
    const toggle = document.getElementById('rev-struct-toggle');
    if (!toggle || toggle._bound) return;
    toggle._bound = true;
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-period]');
      if (!btn) return;
      const period = btn.dataset.period;
      if (period === this._revStructPeriod) return;
      this._revStructPeriod = period;
      toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      this.renderRevenueStructure();
    });
  },

  async renderRevenueStructure() {
    const canvas = $('#chart-revenue-structure');
    if (!canvas) return;
    this._destroy('revenue-structure');

    const { year, month } = this._getYM();
    const isYear = this._revStructPeriod === 'year';
    // 月度：优先用已选月份，否则回退当前月；年度：整年
    const targetMonth = month || todayStr().slice(5, 7);
    const ym = year + '-' + targetMonth;

    let recs, grecs;
    if (isYear) {
      recs = await Store.getByYear('revenue', year);
      grecs = await Store.getByYear('gallery', year);
    } else {
      recs = await Store.getByMonth('revenue', ym);
      grecs = await Store.getByMonth('gallery', ym);
    }
    // space 走视图拿实时聚合 payments
    const spaceView = await Store.getAll('space');
    const periodPrefix = isYear ? year : ym;

    let ticket = 0, combo = 0, coffee = 0, workshop = 0, creative = 0, venue = 0, other = 0, gallery = 0;
    recs.forEach(r => {
      ticket += r.ticketAmount || 0;
      combo += r.comboAmount || 0;
      coffee += r.coffeeAmount || 0;
      workshop += r.workshopAmount || 0;
      creative += (r.retailAmount || 0) + (r.creativeAmount || 0);
      other += r.otherAmount || 0;
    });
    grecs.forEach(r => { gallery += (r.price||0) - (r.commission||0); });
    // 场地已收：按 paymentDate 落在期间内聚合（避免与 revenue.venueAmount 重复）
    spaceView.forEach(s => {
      if (s.rentalType !== '付费') return;
      (s.payments || []).forEach(p => {
        if ((p.paymentDate || '').startsWith(periodPrefix)) venue += +p.amount || 0;
      });
    });

    // 更新标题为可确认的具体期间
    const titleEl = document.getElementById('rev-struct-title');
    if (titleEl) {
      titleEl.textContent = isYear
        ? `收入结构（${year}年全年）`
        : `收入结构（${year}年${parseInt(targetMonth)}月）`;
    }

    const ctx = canvas.getContext('2d');
    const revenueLabels = ['门票', '咖啡套票', '咖啡', '工坊', '文创', '场地', '画廊', '其他'];
    const revenueData = [ticket, combo, coffee, workshop, creative, venue, gallery, other];
    const revenueColors = [
      this._chartColors.revenue.ticket,
      this._chartColors.revenue.combo,
      this._chartColors.revenue.coffee,
      this._chartColors.revenue.workshop,
      this._chartColors.revenue.creative,
      this._chartColors.revenue.venue,
      this._chartColors.revenue.gallery,
      this._chartColors.revenue.other
    ];
    const sortedRevenue = revenueLabels
      .map((label, i) => ({ label, value: revenueData[i], color: revenueColors[i] }))
      .sort((a, b) => (+b.value || 0) - (+a.value || 0));
    const sortedRevenueLabels = sortedRevenue.map(item => item.label);
    const sortedRevenueData = sortedRevenue.map(item => item.value);
    const sortedRevenueColors = sortedRevenue.map(item => item.color);
    this._renderBreakdownSummary(
      'chart-revenue-structure-summary',
      sortedRevenueLabels,
      sortedRevenueData,
      sortedRevenueColors,
      '当前期间暂无收入结构数据'
    );
    const isNarrow = this._isNarrowChart();
    const nonZeroCount = sortedRevenueData.filter(value => (+value || 0) > 0).length;
    const useBar = isNarrow || nonZeroCount <= 2 || nonZeroCount > 5;
    this._charts['revenue-structure'] = new Chart(ctx, {
      type: useBar ? 'bar' : 'doughnut',
      data: {
        labels: sortedRevenueLabels,
        datasets: [{
          data: sortedRevenueData,
          backgroundColor: sortedRevenueColors,
          borderRadius: useBar ? 4 : 0
        }]
      },
      options: useBar ? {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + (+b || 0), 0);
                const val = context.parsed?.x || 0;
                const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
                return context.label + ': ¥' + val.toFixed(2) + ' (' + pct + '%)';
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: v => '¥' + v } },
          y: { ticks: { autoSkip: false } }
        }
      } : {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
            labels: {
              boxWidth: 12,
              padding: 8,
              font: { size: 11 },
              // 图例每项显示：分类名 ¥金额 占比%
              generateLabels: function(chart) {
                const ds = chart.data.datasets[0];
                const data = ds.data || [];
                const total = data.reduce((a, b) => a + (+b || 0), 0);
                return chart.data.labels.map((label, i) => {
                  const val = +data[i] || 0;
                  const pct = total > 0 ? (val / total * 100).toFixed(1) : '0.0';
                  return {
                    text: `${label}  ¥${val.toFixed(2)} (${pct}%)`,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    lineWidth: 0,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const val = context.parsed || 0;
                const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
                return context.label + ': ¥' + val.toFixed(2) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });
  },

  async renderWorkshopRank() {
    const canvas = $('#chart-workshop-rank');
    if (!canvas) return;
    this._destroy('workshop-rank');

    const all = await Store.getAll('revenue');
    const counts = {};
    all.forEach(r => {
      // JSONB 数组防御：脏数据可能是对象 {} 而非数组，(x||[]) 无法防御
      (Array.isArray(r.workshopItems) ? r.workshopItems : []).forEach(item => {
        const name = item.name || '其他';
        counts[name] = (counts[name] || 0) + (+item.qty || 0);
      });
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);

    if (!labels.length) {
      const title = canvas.parentElement?.querySelector('.chart-title');
      if (title) title.textContent = '工坊项目销量排名（暂无数据）';
      return;
    }

    const ctx = canvas.getContext('2d');
    this._charts['workshop-rank'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '销量', data, backgroundColor: '#b8863a', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  },

  _bindExpCatToggle() {
    const toggle = document.getElementById('exp-cat-toggle');
    if (!toggle || toggle._bound) return;
    toggle._bound = true;
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-period]');
      if (!btn) return;
      const period = btn.dataset.period;
      if (period === this._expCatPeriod) return;
      this._expCatPeriod = period;
      toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      this.renderExpenseCategory();
    });
  },

  async renderExpenseCategory() {
    const canvas = $('#chart-expense-category');
    if (!canvas) return;
    this._destroy('expense-category');

    const { year, month } = this._getYM();
    const isYear = this._expCatPeriod === 'year';
    const targetMonth = month || todayStr().slice(5, 7);
    const ym = year + '-' + targetMonth;

    const recs = isYear
      ? await Store.getByYear('expense', year)
      : await Store.getByMonth('expense', ym);
    const cats = {};
    recs.filter(isOperationalExpenseRecord).forEach(r => {
      cats[r.category] = (cats[r.category] || 0) + (+r.amount || 0);
    });

    const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);

    // 更新标题为可确认的具体期间
    const periodLabel = isYear ? `${year}年全年` : `${year}年${parseInt(targetMonth)}月`;
    const titleEl = document.getElementById('exp-cat-title');
    if (titleEl) {
      titleEl.textContent = labels.length
        ? `支出分类汇总（${periodLabel}）`
        : `支出分类汇总（${periodLabel}·暂无数据）`;
    }

    const colors = this._chartColors.expense.palette;
    const colorByLabel = {};
    labels.forEach((label, i) => { colorByLabel[label] = colors[i % colors.length]; });
    const sortedExpense = labels
      .map((label, i) => ({ label, value: data[i], color: colorByLabel[label] }))
      .sort((a, b) => (+b.value || 0) - (+a.value || 0));
    const sortedExpenseLabels = sortedExpense.map(item => item.label);
    const sortedExpenseData = sortedExpense.map(item => item.value);
    const sortedExpenseColors = sortedExpense.map(item => item.color);
    this._renderBreakdownSummary(
      'chart-expense-category-summary',
      sortedExpenseLabels,
      sortedExpenseData,
      sortedExpenseColors,
      '当前期间暂无运营支出数据'
    );
    if (!labels.length) return;

    const isNarrow = this._isNarrowChart();
    const useBar = isNarrow || sortedExpenseLabels.length <= 2 || sortedExpenseLabels.length > 5;
    const ctx = canvas.getContext('2d');
    this._charts['expense-category'] = new Chart(ctx, {
      type: useBar ? 'bar' : 'doughnut',
      data: { labels: sortedExpenseLabels, datasets: [{ data: sortedExpenseData, backgroundColor: sortedExpenseColors, borderRadius: useBar ? 4 : 0 }] },
      options: useBar ? {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + (+b || 0), 0);
                const val = context.parsed?.x || 0;
                const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
                return context.label + ': ¥' + val.toFixed(2) + ' (' + pct + '%)';
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: v => '¥' + v } },
          y: { ticks: { autoSkip: false } }
        }
      } : {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
            labels: {
              boxWidth: 12,
              padding: 8,
              font: { size: 11 },
              // 图例每项显示：分类名 ¥金额 占比%
              generateLabels: function(chart) {
                const ds = chart.data.datasets[0];
                const arr = ds.data || [];
                const total = arr.reduce((a, b) => a + (+b || 0), 0);
                return chart.data.labels.map((label, i) => {
                  const val = +arr[i] || 0;
                  const pct = total > 0 ? (val / total * 100).toFixed(1) : '0.0';
                  return {
                    text: `${label}  ¥${val.toFixed(2)} (${pct}%)`,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    lineWidth: 0,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const val = context.parsed || 0;
                const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
                return context.label + ': ¥' + val.toFixed(2) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });
  },

  async renderExpenseTrend(year) {
    const canvas = $('#chart-expense-trend');
    if (!canvas) return;
    this._destroy('expense-trend');

    const months = await Store.getMonthlySummary('expense', year);
    const labels = [];
    const expenseData = [];
    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      labels.push(m + '月');
      const recs = months[ms];
      let exp = 0;
      recs.forEach(r => {
        if (isOperationalExpenseRecord(r)) exp += (+r.amount || 0);
      });
      expenseData.push(exp);
    }
    const maxMonthIndex = expenseData.reduce((best, value, i) => value > expenseData[best] ? i : best, 0);
    const annualExpense = expenseData.reduce((sum, value) => sum + value, 0);
    const activeMonths = expenseData.filter(value => value > 0).length;

    const ctx = canvas.getContext('2d');
    this._charts['expense-trend'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '运营支出', data: expenseData, backgroundColor: this._chartColors.expense.expense }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } },
        scales: { x: { stacked: true }, y: { stacked: false, beginAtZero: true, ticks: { callback: v => '¥' + v } } }
      }
    });
    this._renderInsightList('chart-expense-trend-insights', [
      {
        label: '年度支出',
        value: this._formatMoney(annualExpense),
        note: `${activeMonths} 个月有运营支出`
      },
      {
        label: '支出高点',
        value: expenseData[maxMonthIndex] > 0 ? `${maxMonthIndex + 1}月 ${this._formatMoney(expenseData[maxMonthIndex])}` : '暂无支出',
        note: '与收入峰值月份对照看经营压力'
      }
    ]);
  }
};
