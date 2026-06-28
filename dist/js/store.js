// store.js — Supabase 异步数据层（含 camelCase/snake_case 自动转换）
const Store = {
  _supabase: null,
  _clientPromise: null,

  async _ensureClient() {
    if (this._supabase) return this._supabase;
    if (this._clientPromise) return this._clientPromise;
    this._clientPromise = this._createClient();
    return this._clientPromise;
  },

  async _createClient() {
    if (typeof supabase === 'undefined') throw new Error('Supabase 客户端未加载，请检查网络连接后刷新页面');
    this._supabase = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, { auth: { persistSession: false } });
    this._ready = true;
    return this._supabase;
  },

  // snake_case ↔ camelCase 转换
  _toSnake(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const snake = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      result[snake] = val;
    }
    return result;
  },

  _toCamel(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'workshop_items' && Array.isArray(val)) {
        result.workshopItems = val;
        continue;
      }
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camel] = val;
    }
    return result;
  },

  _toSnakeList(arr) { return (arr || []).map(o => this._toSnake(o)); },
  _toCamelList(arr) { return (arr || []).map(o => this._toCamel(o)); },

  _table(type) {
    const name = TABLE_NAMES[type];
    if (!name) throw new Error('未知数据类型：' + type);
    return name;
  },

  _handleError(err, action) {
    console.error('Supabase ' + action + ' 错误：', err);
    if (!err) return;
    const msg = err.message || String(err);
    if (msg.includes('Failed to fetch')) {
      UI.toast('网络连接失败，请检查网络后重试', 'error');
    } else if (msg.includes('could not find') || msg.includes('relation') || msg.includes('does not exist')) {
      UI.toast('数据库表结构异常，请确认已执行建表脚本', 'error');
    } else {
      UI.toast('操作失败：' + msg.slice(0, 80), 'error');
    }
  },

  async getAll(type) {
    const client = await this._ensureClient();
    const { data, error } = await client.from(this._table(type)).select('*').order('date', { ascending: false }).limit(5000);
    if (error) { this._handleError(error, '查询'); return []; }
    return this._toCamelList(data);
  },

  async getById(type, id) {
    const client = await this._ensureClient();
    const { data, error } = await client.from(this._table(type)).select('*').eq('id', id).single();
    if (error) { this._handleError(error, '查询'); return null; }
    return data ? this._toCamel(data) : null;
  },

  async add(type, record) {
    const client = await this._ensureClient();
    record.createdAt = record.createdAt || new Date().toISOString();
    const dbRecord = this._toSnake(record);
    const { data, error } = await client.from(this._table(type)).insert(dbRecord).select().single();
    if (error) { this._handleError(error, '新增'); throw new Error(error.message); }
    return data ? this._toCamel(data) : record;
  },

  async update(type, id, updates) {
    const client = await this._ensureClient();
    const dbUpdates = this._toSnake(updates);
    const { data, error } = await client.from(this._table(type)).update(dbUpdates).eq('id', id).select().single();
    if (error) { this._handleError(error, '更新'); throw new Error(error.message); }
    return data ? this._toCamel(data) : null;
  },

  async delete(type, id) {
    const client = await this._ensureClient();
    const { data, error } = await client.from(this._table(type)).delete().eq('id', id);
    if (error) { this._handleError(error, '删除'); throw new Error(error.message); }
  },

  async getByDateRange(type, startDate, endDate) {
    const client = await this._ensureClient();
    const { data, error } = await client.from(this._table(type)).select('*').gte('date', startDate).lte('date', endDate).order('date', { ascending: false });
    if (error) { this._handleError(error, '查询'); return []; }
    return this._toCamelList(data);
  },

  async getByMonth(type, yearMonth) {
    const year = yearMonth.slice(0, 4);
    const month = yearMonth.slice(5, 7);
    const lastDay = new Date(+year, +month, 0).getDate();
    const endDate = yearMonth + '-' + String(lastDay).padStart(2, '0');
    return this.getByDateRange(type, yearMonth + '-01', endDate);
  },

  async getByYear(type, year) {
    const client = await this._ensureClient();
    const { data, error } = await client.from(this._table(type)).select('*').gte('date', year + '-01-01').lte('date', year + '-12-31').order('date', { ascending: false });
    if (error) { this._handleError(error, '查询'); return []; }
    return this._toCamelList(data);
  },

  async getByProject(type, projectName) {
    const client = await this._ensureClient();
    const table = this._table(type);
    const field = type === 'expense' ? 'project' : 'project_name';
    const camelField = type === 'expense' ? 'project' : 'projectName';
    const { data, error } = await client.from(table).select('*').ilike(field, `%${projectName}%`);
    if (error) { this._handleError(error, '查询'); return []; }
    return this._toCamelList(data);
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
    const client = await this._ensureClient();
    const table = this._table(type);
    const dbRecords = this._toSnakeList(records);
    const batchSize = 100;
    for (let i = 0; i < dbRecords.length; i += batchSize) {
      const batch = dbRecords.slice(i, i + batchSize);
      const { error } = await client.from(table).upsert(batch);
      if (error) this._handleError(error, '导入');
    }
  },

  async clearAll(type) {
    const client = await this._ensureClient();
    const { error } = await client.from(this._table(type)).delete().neq('id', '_nonesuch_');
    if (error) this._handleError(error, '清空');
  },

  async healthCheck() {
    try {
      const client = await this._ensureClient();
      const { data, error } = await client.from('revenue').select('*').limit(1);
      if (error) throw error;
      return { ok: true, message: '数据库连接正常' };
    } catch (e) {
      return { ok: false, message: '数据库连接失败：' + (e.message || e) };
    }
  },

  // ===== 应用配置管理 =====
  async loadAppConfig() {
    try {
      const client = await this._ensureClient();
      const { data, error } = await client.from(CONFIG_TABLE).select('key, value');
      if (error) throw error;
      if (data && data.length > 0) {
        // 更新 MODELS 中的动态配置
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
        // 兼容旧代码的 COMBO_PRICE（ticket_products 第二项）
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
      const client = await this._ensureClient();
      const { error } = await client.from(CONFIG_TABLE).upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) throw error;
      return true;
    } catch (e) {
      this._handleError(e, '保存配置');
      return false;
    }
  }
};
