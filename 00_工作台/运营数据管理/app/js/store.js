// store.js — 后端 API 数据层（通过 fetch 调用自有 API，不再依赖 Supabase SDK）
const Store = {
  _apiBase: null,

  async _ensureClient() {
    if (!this._apiBase) {
      this._apiBase = (SUPABASE_CONFIG.url || '').replace(/\/+$/, '');
    }
    if (!this._apiBase) throw new Error('API 地址未配置');
    return this._apiBase;
  },

  // ===== REST 请求封装 =====
  async _request(method, path, body) {
    const base = await this._ensureClient();
    const url = base + path;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = '请求失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    // 204 No Content
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  },

  // ===== 查询构建 =====
  _buildQuery(table, filters) {
    let q = `/rest/v1/${table}`;
    const params = [];
    if (filters) {
      for (const [key, val] of Object.entries(filters)) {
        params.push(key + '=' + encodeURIComponent(val));
      }
    }
    if (params.length) q += '?' + params.join('&');
    return q;
  },

  // ===== 通用 CRUD =====
  async getAll(type) {
    try {
      const table = this._table(type);
      return await this._request('GET', `/rest/v1/${table}?order=date.desc&limit=5000`) || [];
    } catch (e) {
      this._handleError(e, '查询');
      return [];
    }
  },

  async getById(type, id) {
    try {
      const table = this._table(type);
      const row = await this._request('GET', `/rest/v1/${table}?id=eq.${id}`);
      return row || null;
    } catch (e) {
      this._handleError(e, '查询');
      return null;
    }
  },

  async add(type, record) {
    try {
      const table = this._table(type);
      record.createdAt = record.createdAt || new Date().toISOString();
      const result = await this._request('POST', `/rest/v1/${table}`, record);
      OperationLogger.log('create', type, result.id, result);
      return result;
    } catch (e) {
      this._handleError(e, '新增');
      throw e;
    }
  },

  async update(type, id, updates) {
    try {
      const table = this._table(type);
      // 读取旧值（用于日志）
      let oldRecord = null;
      try { oldRecord = await this.getById(type, id); } catch {}
      const result = await this._request('PATCH', `/rest/v1/${table}?id=eq.${id}`, updates);
      OperationLogger.log('update', type, id, {
        before: oldRecord,
        after: result
      });
      return result;
    } catch (e) {
      this._handleError(e, '更新');
      throw e;
    }
  },

  async delete(type, id) {
    try {
      const table = this._table(type);
      // 读取被删记录（用于日志）
      let oldRecord = null;
      try { oldRecord = await this.getById(type, id); } catch {}
      await this._request('DELETE', `/rest/v1/${table}?id=eq.${id}`);
      OperationLogger.log('delete', type, id, oldRecord || {});
    } catch (e) {
      this._handleError(e, '删除');
      throw e;
    }
  },

  async getByDateRange(type, startDate, endDate) {
    try {
      const table = this._table(type);
      return await this._request('GET', `/rest/v1/${table}?date=gte.${startDate}&date=lte.${endDate}&order=date.desc`) || [];
    } catch (e) {
      this._handleError(e, '查询');
      return [];
    }
  },

  async getByMonth(type, yearMonth) {
    const year = yearMonth.slice(0, 4);
    const month = yearMonth.slice(5, 7);
    const lastDay = new Date(+year, +month, 0).getDate();
    const endDate = yearMonth + '-' + String(lastDay).padStart(2, '0');
    return this.getByDateRange(type, yearMonth + '-01', endDate);
  },

  async getByYear(type, year) {
    return this.getByDateRange(type, year + '-01-01', year + '-12-31');
  },

  async getByProject(type, projectName) {
    try {
      const table = this._table(type);
      const field = type === 'expense' ? 'project' : 'project_name';
      return await this._request('GET', `/rest/v1/${table}?${field}=ilike.%25${encodeURIComponent(projectName)}%25`) || [];
    } catch (e) {
      this._handleError(e, '查询');
      return [];
    }
  },

  async getMonthlySummary(type, year) {
    const all = await this.getByYear(type, year);
    const months = {};
    for (let m = 1; m <= 12; m++) months[String(m).padStart(2, '0')] = [];
    all.forEach(r => { const ms = (r.date || '').slice(5, 7); if (months[ms]) months[ms].push(r); });
    return months;
  },

  async importData(type, records) {
    if (!records.length) return;
    for (const r of records) {
      try { await this.add(type, r); } catch (e) { console.warn('导入失败:', e); }
    }
  },

  async clearAll(type) {
    try {
      const table = this._table(type);
      await this._request('DELETE', `/rest/v1/${table}?id=neq._nonesuch_`);
    } catch (e) {
      this._handleError(e, '清空');
    }
  },

  async healthCheck() {
    try {
      const base = await this._ensureClient();
      const res = await fetch(base + '/rest/v1/revenue?limit=1');
      if (res.ok) return { ok: true, message: '数据库连接正常' };
      return { ok: false, message: '数据库连接失败：状态码 ' + res.status };
    } catch (e) {
      return { ok: false, message: '数据库连接失败：' + (e.message || e) };
    }
  },

  // ===== 应用配置管理 =====
  async loadAppConfig() {
    try {
      const data = await this._request('GET', '/rest/v1/app_config') || [];
      if (data.length > 0) {
        data.forEach(row => {
          switch (row.key) {
            case 'ticket_products':
              MODELS.ticketProducts = row.value;
              MODELS.TICKET_PRICE = row.value[0]?.price || 10;
              break;
            case 'coffee_products':
              MODELS.coffeeProducts = row.value;
              MODELS.COFFEE_PRICE = row.value[0]?.price || 15;
              break;
            case 'workshop_products':
              MODELS.WORKSHOP_PRODUCTS = row.value;
              break;
            case 'spaces':
              MODELS.SPACES = row.value.map(s => s.name);
              MODELS.spaceDetails = row.value;
              break;
          }
        });
        if (MODELS.ticketProducts && MODELS.ticketProducts.length > 1) {
          MODELS.COMBO_PRICE = MODELS.ticketProducts[1].price;
        }
      }
      return true;
    } catch (e) {
      console.error('加载配置失败：', e);
      return false;
    }
  },

  async saveConfig(key, value) {
    try {
      const existing = await this._request('GET', `/rest/v1/app_config?key=eq.${key}`);
      if (existing && existing.length > 0) {
        await this._request('PATCH', `/rest/v1/app_config?key=eq.${key}`, { value, updated_at: new Date().toISOString() });
      } else {
        await this._request('POST', '/rest/v1/app_config', { key, value, updated_at: new Date().toISOString() });
      }
      return true;
    } catch (e) {
      this._handleError(e, '保存配置');
      return false;
    }
  },

  // ===== 内部工具 =====
  _table(type) {
    const name = TABLE_NAMES[type];
    if (!name) throw new Error('未知数据类型：' + type);
    return name;
  },

  _handleError(err, action) {
    console.error('API ' + action + ' 错误：', err);
    if (!err) return;
    const msg = err.message || String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      UI.toast('网络连接失败，请检查网络后重试', 'error');
    } else {
      UI.toast('操作失败：' + msg.slice(0, 80), 'error');
    }
  },

  // 保留兼容性（camelCase 转换不再需要，后端已处理）
  _toCamelList(arr) { return arr || []; },
  _toSnakeList(arr) { return arr || []; },
  _toCamel(o) { return o; },
  _toSnake(o) { return o; }
};
