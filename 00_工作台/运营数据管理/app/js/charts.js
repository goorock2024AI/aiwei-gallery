// charts.js — Chart.js 图表渲染（Supabase 异步版）
var Charts = {
  _charts: {},

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

    // 数据总览
    await this._renderOverview(year, month);

    const container = document.getElementById('report-charts');
    html(container, `
      <div class="chart-grid">
        <div class="chart-box full"><div class="chart-title">月度收入趋势</div><canvas id="chart-revenue-trend"></canvas></div>
        <div class="chart-box"><div class="chart-title">收入结构</div><canvas id="chart-revenue-structure"></canvas></div>
        <div class="chart-box"><div class="chart-title">工坊项目销量排名</div><canvas id="chart-workshop-rank"></canvas></div>
        <div class="chart-box"><div class="chart-title">支出分类汇总</div><canvas id="chart-expense-category"></canvas></div>
        <div class="chart-box"><div class="chart-title">空间使用统计</div><canvas id="chart-space-usage"></canvas></div>
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
    await this.renderWorkshopRank();
    await this.renderExpenseCategory();
    await this.renderSpaceUsage();
    await this.renderExpenseTrend(year);
  },

  async _renderOverview(year, month) {
    const page = document.getElementById('page-reports');
    if (!page) return;

    const revenues = await Store.getByYear('revenue', year);
    const galleryAll = await Store.getByYear('gallery', year);
    const spaceAll = await Store.getByYear('space', year);

    // month 为空表示全年，否则按指定月份过滤
    let monthRev, monthGal, monthSpace, title;
    if (month) {
      const ym = year + '-' + month;
      monthRev = revenues.filter(r => (r.date||'').startsWith(ym));
      monthGal = galleryAll.filter(r => (r.date||'').startsWith(ym));
      monthSpace = spaceAll.filter(r => (r.date||'').startsWith(ym));
      title = year + '年' + parseInt(month) + '月';
    } else {
      monthRev = revenues;
      monthGal = galleryAll;
      monthSpace = spaceAll;
      title = year + '年全年';
    }

    const spaceRentIncome = monthSpace.filter(s => s.rentalType === '付费').reduce((s, r) => s + (r.receivedAmount || 0), 0);

    const totalRevenue = monthRev.reduce((s, r) => s + (r.ticketAmount||0) + (r.comboAmount||0) + (r.coffeeAmount||0) + (r.workshopAmount||0) + (r.retailAmount||0) + (r.creativeAmount||0) + (r.venueAmount||0) + (r.otherAmount||0), 0)
      + monthGal.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0)
      + spaceRentIncome;

    const ticketTotal = monthRev.reduce((s, r) => s + (r.ticketAmount||0), 0);
    const comboTotal = monthRev.reduce((s, r) => s + (r.comboAmount||0), 0);
    const coffeeTotal = monthRev.reduce((s, r) => s + (r.coffeeAmount||0), 0);
    const workshopTotal = monthRev.reduce((s, r) => s + (r.workshopAmount||0), 0);
    const creativeTotal = monthRev.reduce((s, r) => s + (r.retailAmount||0) + (r.creativeAmount||0), 0);
    const venueTotal = monthRev.reduce((s, r) => s + (r.venueAmount||0), 0) + spaceRentIncome;
    const galleryTotal = monthGal.reduce((s, r) => s + (r.price||0) - (r.commission||0), 0);
    const otherTotal = monthRev.reduce((s, r) => s + (r.otherAmount||0), 0);

    const _fmt = n => Number(n || 0).toFixed(2);

    const existing = page.querySelector('.rpt-overview');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'rpt-overview';
    div.innerHTML = `
      <div class="card">
        <div class="card-title">📊 收入总览（${month ? year + '年' + parseInt(month) + '月' : year + '年全年'}）</div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">总收入</div><div class="stat-value" style="font-size:22px">¥${_fmt(totalRevenue)}</div></div>
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
    const spaceAll = await Store.getByYear('space', year);
    const labels = [];
    const ticketData = [];
    const comboData = [];
    const coffeeData = [];
    const workshopData = [];
    const creativeData = [];
    const venueData = [];
    const galleryData = [];
    const otherData = [];

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
        cr += r.creativeAmount || 0;
        v += r.venueAmount || 0;
        o += r.otherAmount || 0;
      });
      grecs.forEach(r => { g += (r.price||0) - (r.commission||0); });
      spRecs.forEach(r => { v += r.receivedAmount || 0; });
      ticketData.push(t);
      comboData.push(cb);
      coffeeData.push(c);
      workshopData.push(w);
      creativeData.push(cr);
      venueData.push(v);
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
    const spaceAll = await Store.getByMonth('space', ym);

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
        v += r.venueAmount || 0;
        o += r.otherAmount || 0;
      });
      dayGal.forEach(r => { g += (r.price || 0) - (r.commission || 0); });
      daySpace.forEach(r => { v += r.receivedAmount || 0; });
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

  async renderRevenueStructure() {
    const canvas = $('#chart-revenue-structure');
    if (!canvas) return;
    this._destroy('revenue-structure');

    const { year, month } = this._getYM();
    const ym = month ? year + '-' + month : todayStr().slice(0, 7);
    const recs = await Store.getByMonth('revenue', ym);
    const grecs = await Store.getByMonth('gallery', ym);
    const spRecs = await Store.getByMonth('space', ym);
    let ticket = 0, combo = 0, coffee = 0, workshop = 0, creative = 0, venue = 0, other = 0, gallery = 0;
    recs.forEach(r => {
      ticket += r.ticketAmount || 0;
      combo += r.comboAmount || 0;
      coffee += r.coffeeAmount || 0;
      workshop += r.workshopAmount || 0;
      creative += r.creativeAmount || 0;
      venue += r.venueAmount || 0;
      other += r.otherAmount || 0;
    });
    grecs.forEach(r => { gallery += (r.price||0) - (r.commission||0); });
    spRecs.filter(s => s.rentalType === '付费').forEach(r => { venue += r.receivedAmount || 0; });

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
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
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
      (r.workshopItems || []).forEach(item => {
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

  async renderExpenseCategory() {
    const canvas = $('#chart-expense-category');
    if (!canvas) return;
    this._destroy('expense-category');

    const { year, month } = this._getYM();
    const ym = month ? year + '-' + month : todayStr().slice(0, 7);
    const recs = await Store.getByMonth('expense', ym);
    const cats = {};
    recs.forEach(r => {
      if (r.type === '备用金支出') cats[r.category] = (cats[r.category] || 0) + (r.amount||0);
    });

    const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);
    if (!labels.length) return;

    const colors = ['#c0392b','#e67e22','#f1c40f','#2c6b9e','#27ae60','#8e44ad','#7ab88a','#b8863a','#8a8578','#5c574a'];
    const ctx = canvas.getContext('2d');
    this._charts['expense-category'] = new Chart(ctx, {
      type: 'pie',
      data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } } }
    });
  },

  async renderSpaceUsage() {
    const canvas = $('#chart-space-usage');
    if (!canvas) return;
    this._destroy('space-usage');

    const all = await Store.getAll('space');
    const counts = {};
    all.forEach(r => { counts[r.space] = (counts[r.space] || 0) + 1; });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => e[1]);
    if (!labels.length) return;

    const ctx = canvas.getContext('2d');
    this._charts['space-usage'] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '使用次数', data, backgroundColor: '#2c6b9e', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
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
