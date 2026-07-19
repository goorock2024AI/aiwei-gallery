// charts.js — Chart.js 图表渲染（Supabase 异步版）
var Charts = {
  _charts: {},
  _revStructPeriod: 'month', // 收入结构卡片期间维度：'month' 月度 / 'year' 年度
  _expCatPeriod: 'month',    // 支出分类卡片期间维度：'month' 月度 / 'year' 年度
  _revOverviewPeriod: 'day', // 收入总览卡片期间维度：'day' 本日 / 'month' 本月 / 'year' 本年 / 'custom' 选定日（默认当日）
  _revOverviewCustomDate: null, // 选定日期模式下的目标日期（YYYY-MM-DD），首次进入时取 todayStr()

  _destroy(id) {
    if (this._charts[id]) { this._charts[id].destroy(); delete this._charts[id]; }
  },

  _getYM() {
    const year = document.getElementById('rpt-year')?.value || '2026';
    const month = document.getElementById('rpt-month')?.value || '';
    return { year, month };
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
        <div class="chart-box full"><div class="chart-title">月度收入趋势</div><canvas id="chart-revenue-trend"></canvas></div>
        <div class="chart-box">
          <div class="chart-title-row">
            <div class="chart-title" id="rev-struct-title">收入结构</div>
            <div class="chart-toggle" id="rev-struct-toggle">
              <button type="button" data-period="month" class="active">月度</button>
              <button type="button" data-period="year">年度</button>
            </div>
          </div>
          <canvas id="chart-revenue-structure"></canvas>
        </div>
        <div class="chart-box"><div class="chart-title">工坊项目销量排名</div><canvas id="chart-workshop-rank"></canvas></div>
        <div class="chart-box">
          <div class="chart-title-row">
            <div class="chart-title" id="exp-cat-title">支出分类汇总</div>
            <div class="chart-toggle" id="exp-cat-toggle">
              <button type="button" data-period="month" class="active">月度</button>
              <button type="button" data-period="year">年度</button>
            </div>
          </div>
          <canvas id="chart-expense-category"></canvas>
        </div>
        <div class="chart-box"><div class="chart-title">月度支出趋势</div><canvas id="chart-expense-trend"></canvas></div>
      </div>
    `);
    // 当月日收入趋势放在收入总览下方
    const oldDaily = page.querySelector('.rpt-daily-trend');
    if (oldDaily) oldDaily.remove();
    const overview = page.querySelector('.rpt-overview');
    if (overview) {
      const dailyDiv = document.createElement('div');
      dailyDiv.className = 'chart-box full rpt-daily-trend';
      dailyDiv.innerHTML = '<div class="chart-title">当月日收入趋势</div><canvas id="chart-daily-revenue"></canvas>';
      overview.insertAdjacentElement('afterend', dailyDiv);
    }
    // 延迟一帧让 canvas 元素创建完毕
    await new Promise(r => setTimeout(r, 100));
    await this.renderRevenueTrend(year);
    await this.renderDailyRevenueTrend();
    await this.renderRevenueStructure();
    this._bindRevStructToggle();
    await this.renderWorkshopRank();
    await this.renderExpenseCategory();
    this._bindExpCatToggle();
    await this.renderExpenseTrend(year);
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
    const revenues = await Store.getByYear('revenue', year);
    const galleryAll = await Store.getByYear('gallery', year);
    const spaceAll = await Store.getAll('space');

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
        <div class="stats-grid" style="margin-top:12px">
          <div class="stat-card"><div class="stat-label">总收入（${periodLabel}）</div><div class="stat-value" style="font-size:22px">¥${_fmt(totalRevenue)}</div></div>
          <div class="stat-card"><div class="stat-label">门票</div><div class="stat-value">¥${_fmt(ticketTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">咖啡套票</div><div class="stat-value">¥${_fmt(comboTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">咖啡</div><div class="stat-value">¥${_fmt(coffeeTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">工坊</div><div class="stat-value">¥${_fmt(workshopTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">文创/零售</div><div class="stat-value">¥${_fmt(creativeTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">场地</div><div class="stat-value">¥${_fmt(venueTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">画廊</div><div class="stat-value">¥${_fmt(galleryTotal)}</div></div>
          <div class="stat-card"><div class="stat-label">其他</div><div class="stat-value">¥${_fmt(otherTotal)}</div></div>
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
          borderColor: '#4a8c5c',
          backgroundColor: 'rgba(74,140,92,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#4a8c5c'
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

    const ctx = canvas.getContext('2d');
    this._charts['revenue-trend'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '门票', data: ticketData, backgroundColor: '#4a8c5c' },
          { label: '咖啡套票', data: comboData, backgroundColor: '#57a86a' },
          { label: '咖啡', data: coffeeData, backgroundColor: '#7ab88a' },
          { label: '工坊', data: workshopData, backgroundColor: '#b8863a' },
          { label: '文创', data: creativeData, backgroundColor: '#c5c0b5' },
          { label: '场地', data: venueData, backgroundColor: '#2c6b9e' },
          { label: '画廊', data: galleryData, backgroundColor: '#8e44ad' },
          { label: '其他', data: otherData, backgroundColor: '#888888' }
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

    const ctx = canvas.getContext('2d');
    this._charts['daily-revenue'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '合计', data: totalData, borderColor: '#222222', backgroundColor: '#222222', borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: false, order: 0 },
          { label: '门票', data: ticketData, borderColor: '#4a8c5c', backgroundColor: '#4a8c5c', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '咖啡套票', data: comboData, borderColor: '#57a86a', backgroundColor: '#57a86a', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '咖啡', data: coffeeData, borderColor: '#7ab88a', backgroundColor: '#7ab88a', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '工坊', data: workshopData, borderColor: '#b8863a', backgroundColor: '#b8863a', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '文创', data: creativeData, borderColor: '#c5c0b5', backgroundColor: '#c5c0b5', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '场地', data: venueData, borderColor: '#2c6b9e', backgroundColor: '#2c6b9e', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '画廊', data: galleryData, borderColor: '#8e44ad', backgroundColor: '#8e44ad', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true },
          { label: '其他', data: otherData, borderColor: '#888888', backgroundColor: '#888888', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, hidden: true }
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
                return '合计: ¥' + (total || 0).toFixed(2);
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
    this._charts['revenue-structure'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['门票', '咖啡套票', '咖啡', '工坊', '文创', '场地', '画廊', '其他'],
        datasets: [{
          data: [ticket, combo, coffee, workshop, creative, venue, gallery, other],
          backgroundColor: ['#4a8c5c', '#57a86a', '#7ab88a', '#b8863a', '#c5c0b5', '#2c6b9e', '#8e44ad', '#8a8578']
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
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
                    text: `${label}  ¥${val.toFixed(0)} (${pct}%)`,
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
    recs.forEach(r => {
      if (r.type === '备用金支出') cats[r.category] = (cats[r.category] || 0) + (r.amount||0);
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
    if (!labels.length) return;

    const colors = ['#c0392b','#e67e22','#f1c40f','#2c6b9e','#27ae60','#8e44ad','#7ab88a','#b8863a','#8a8578','#5c574a'];
    const ctx = canvas.getContext('2d');
    this._charts['expense-category'] = new Chart(ctx, {
      type: 'pie',
      data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
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
                    text: `${label}  ¥${val.toFixed(0)} (${pct}%)`,
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
    const borrowData = [];

    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      labels.push(m + '月');
      const recs = months[ms];
      let exp = 0, bor = 0;
      recs.forEach(r => {
        if (r.type === '备用金支出') exp += (r.amount||0);
        else bor += (r.amount||0);
      });
      expenseData.push(exp);
      borrowData.push(bor);
    }

    const ctx = canvas.getContext('2d');
    this._charts['expense-trend'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '支出', data: expenseData, backgroundColor: '#c0392b' },
          { label: '借入', data: borrowData, backgroundColor: '#27ae60' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } },
        scales: { x: { stacked: true }, y: { stacked: false, beginAtZero: true, ticks: { callback: v => '¥' + v } } }
      }
    });
  }
};
