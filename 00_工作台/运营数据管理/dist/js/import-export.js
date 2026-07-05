// import-export.js — CSV/JSON 导入导出（Supabase 异步版）
const ImportExport = {
  _getExportDates() {
    const start = document.getElementById('export-start');
    const end = document.getElementById('export-end');
    return {
      start: start?.value || '',
      end: end?.value || ''
    };
  },
  _filterByDateRange(records, start, end) {
    if (!start && !end) return records;
    return records.filter(r => {
      const d = r.date || '';
      return (!start || d >= start) && (!end || d <= end);
    });
  },
  _suffix() {
    const { start, end } = this._getExportDates();
    if (start && end) return '_' + start + '_' + end;
    if (start) return '_' + start + '_end';
    if (end) return '_begin_' + end;
    return '_' + todayStr();
  },

  async exportCSV(type) {
    try {
      const { start, end } = this._getExportDates();
      const all = await Store.getAll(type);
      const records = this._filterByDateRange(all, start, end);
      if (!records.length) { UI.toast('没有数据可以导出' + (all.length ? '（所选范围内无数据）' : ''), 'error'); return; }

      let headers, rows;
      if (type === 'revenue') {
        headers = ['日期','门票数量','门票金额','咖啡套票数量','咖啡套票金额','工坊金额','工坊明细','文创金额','文创明细','场地金额','其他金额','其他说明','现金收款','账户收款','经手人','备注','创建时间'];
        rows = records.map(r => {
          const retailAmt = +(r.retailAmount || r.creativeAmount || 0);
          const retailItems = Array.isArray(r.retailItems) ? r.retailItems : [];
          const workshopItems = Array.isArray(r.workshopItems) ? r.workshopItems : [];
          const retailDetail = retailItems.map(i => `${i.productName||''}×${i.qty||1}¥${(+i.amount||0).toFixed(2)}`).join('; ');
          const workshopDetail = workshopItems.map(i => `${i.name||''}×${i.qty||1}¥${(+i.amount||0).toFixed(2)}`).join('; ');
          return [r.date, r.ticketQty||0, r.ticketAmount||0, r.coffeeQty||0, r.coffeeAmount||0, r.workshopAmount||0, workshopDetail, retailAmt, retailDetail, r.venueAmount||0, r.otherAmount||0, r.otherDesc||'', r.cashAmount||0, r.accountAmount||0, r.handler||'', r.notes||'', r.createdAt||''];
        });
      } else if (type === 'expense') {
      headers = ['日期','类型','项目','类别','金额','内容说明','经手人','发票状态','凭证状态','关联活动','创建时间'];
      rows = records.map(r => [r.date, r.type, r.project, r.category, r.amount, r.description||'', r.handler||'', r.invoiceStatus, r.receiptStatus, r.relatedActivity||'', r.createdAt||'']);
    } else if (type === 'space') {
      headers = ['日期','空间','项目名称','类型','客户','状态','应收金额','已收金额','备注','创建时间'];
      rows = records.map(r => [r.date, r.space, r.projectName, r.type, r.client||'', r.status, r.receivableAmount||0, r.receivedAmount||0, r.notes||'', r.createdAt||'']);
    } else if (type === 'gallery') {
      headers = ['日期','作品名称','艺术家','成交价','佣金','净收入','买家','收款方式','状态','关联展览','经手人','备注','创建时间'];
      rows = records.map(r => [r.date, r.artworkName, r.artist, r.price||0, r.commission||0, Math.max(0, (r.price||0) - (r.commission||0)), r.buyerName||'', r.paymentMethod||'', r.status||'', r.relatedExhibition||'', r.handler||'', r.notes||'', r.createdAt||'']);
    }

    const csvContent = '﻿' + headers.join(',') + '\n' + rows.map(row => row.map(v => {
      const s = String(v !== undefined && v !== null ? v : '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const typeNames = { revenue: '收入', expense: '支出', space: '空间使用', gallery: '画廊销售' };
    link.href = URL.createObjectURL(blob);
    link.download = `艾维美术馆_${typeNames[type]}${this._suffix()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    UI.toast(`${typeNames[type]}数据已导出`);
    } catch (e) { console.error('导出失败', e); UI.toast('导出失败：' + e.message, 'error'); }
  },

  async exportAllJSON() {
    const { start, end } = this._getExportDates();
    const [revAll, expAll, spaAll, galAll] = await Promise.all([
      Store.getAll('revenue'),
      Store.getAll('expense'),
      Store.getAll('space'),
      Store.getAll('gallery')
    ]);
    const revenue = this._filterByDateRange(revAll, start, end);
    const expense = this._filterByDateRange(expAll, start, end);
    const space = this._filterByDateRange(spaAll, start, end);
    const gallery = this._filterByDateRange(galAll, start, end);
    const total = revenue.length + expense.length + space.length + gallery.length;
    if (!total) { UI.toast('没有数据可以导出' + (revAll.length ? '（所选范围内无数据）' : ''), 'error'); return; }

    const data = { version: 1, exportDate: new Date().toISOString(), revenue, expense, space, gallery };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `艾维美术馆_数据备份${this._suffix()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    UI.toast('JSON 备份已导出');
  },

  importData() {
    const fileInput = document.getElementById('import-file');
    if (!fileInput || !fileInput.files.length) { UI.toast('请先选择文件', 'error'); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const content = e.target.result;
        if (file.name.endsWith('.json')) {
          await this._importJSON(content);
        } else if (file.name.endsWith('.csv')) {
          await this._importCSV(content, file.name);
        } else {
          UI.toast('不支持的格式，请使用 CSV 或 JSON 文件', 'error');
        }
      } catch (err) {
        UI.toast('导入失败：' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  },

  async _importJSON(content) {
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') throw new Error('JSON 格式不正确');

    let count = 0;
    if (data.revenue && Array.isArray(data.revenue)) {
      await Store.importData('revenue', data.revenue);
      count += data.revenue.length;
    }
    if (data.expense && Array.isArray(data.expense)) {
      await Store.importData('expense', data.expense);
      count += data.expense.length;
    }
    if (data.space && Array.isArray(data.space)) {
      await Store.importData('space', data.space);
      count += data.space.length;
    }
    if (data.gallery && Array.isArray(data.gallery)) {
      await Store.importData('gallery', data.gallery);
      count += data.gallery.length;
    }
    if (!count) { UI.toast('JSON 格式无法识别，请使用系统导出的备份文件', 'error'); return; }
    UI.toast(`JSON 数据导入完成！共 ${count} 条记录（追加模式）`);
  },

  async _importCSV(content, filename) {
    let type = 'revenue';
    if (filename.includes('支出')) type = 'expense';
    else if (filename.includes('空间')) type = 'space';
    else if (filename.includes('画廊')) type = 'gallery';

    const lines = content.replace(/^﻿/, '').split('\n').filter(line => line.trim());
    if (lines.length < 2) { UI.toast('CSV 文件为空或只有表头', 'error'); return; }

    const headers = this._parseCSVLine(lines[0]);
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = this._parseCSVLine(lines[i]);
      if (vals.length < 2) continue;
      const record = {};
      headers.forEach((h, idx) => { record[h] = vals[idx] || ''; });

      if (type === 'revenue') {
        records.push(createRevenue({
          date: record['日期'] || '', ticketQty: +record['门票数量'] || 0, coffeeQty: +record['咖啡套票数量'] || 0,
          creativeAmount: +record['文创金额'] || 0, venueAmount: +record['场地金额'] || 0, otherAmount: +record['其他金额'] || 0,
          otherDesc: record['其他说明'] || '', cashAmount: +record['现金收款'] || 0, accountAmount: +record['账户收款'] || 0,
          projectName: record['关联项目'] || '', handler: record['经手人'] || '', notes: record['备注'] || ''
        }));
      } else if (type === 'expense') {
        records.push(createExpense({
          date: record['日期'] || '', type: record['类型'] || '备用金支出', project: record['项目'] || '运营',
          category: record['类别'] || '材料', amount: +record['金额'] || 0, description: record['内容说明'] || '',
          handler: record['经手人'] || '', invoiceStatus: record['发票状态'] || '待补', receiptStatus: record['凭证状态'] || '待补',
          relatedActivity: record['关联活动'] || ''
        }));
      } else if (type === 'space') {
        records.push(createSpaceUsage({
          date: record['日期'] || '', space: record['空间'] || '1号厅', projectName: record['项目名称'] || '',
          type: record['类型'] || '展览', client: record['客户'] || '', status: record['状态'] || '筹备中',
          receivableAmount: +record['应收金额'] || 0, receivedAmount: +record['已收金额'] || 0, notes: record['备注'] || ''
        }));
      } else if (type === 'gallery') {
        records.push(createGallerySale({
          date: record['日期'] || '', artworkName: record['作品名称'] || '', artist: record['艺术家'] || '',
          price: +record['成交价'] || 0, commission: +record['佣金'] || 0, buyerName: record['买家'] || '',
          paymentMethod: record['收款方式'] || '扫码支付', status: record['状态'] || '已售出',
          relatedExhibition: record['关联展览'] || '', handler: record['经手人'] || '', notes: record['备注'] || ''
        }));
      }
    }

    if (!records.length) { UI.toast('CSV 中未解析出有效数据', 'error'); return; }

    const existing = await Store.getAll(type);
    await Store.importData(type, [...existing, ...records]);
    const typeNames = { revenue: '收入', expense: '支出', space: '空间使用', gallery: '画廊销售' };
    UI.toast(`CSV 导入完成：${typeNames[type]} ${records.length} 条（追加模式）`);
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
  }
};
