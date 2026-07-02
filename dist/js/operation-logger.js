// operation-logger.js — 操作审计日志自动记录
// 由 store.js 在增/删/改操作时自动调用，不阻塞主流程
const OperationLogger = {
  _batch: [],
  _timer: null,

  /**
   * 记录一条操作日志
   * @param {'create'|'update'|'delete'} action
   * @param {string} tableName - store.js 中的类型名（revenue/expense/space/gallery/users）
   * @param {string} recordId
   * @param {object} details - create/delete: 完整记录；update: {before, after}
   */
  log(action, tableName, recordId, details = {}) {
    const user = Auth.currentUser;
    if (!user) return;

    this._batch.push({
      id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      user_id: user.id,
      action,
      table_name: tableName,
      record_id: String(recordId || ''),
      details: JSON.stringify(details),
      created_at: new Date().toISOString()
    });

    // 合并写入：50ms 内的操作合并为一次 INSERT
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), 50);
    }
  },

  async _flush() {
    this._timer = null;
    const batch = this._batch.splice(0);
    if (!batch.length) return;

    try {
      const client = await Store._ensureClient();
      const { error } = await client.from('operation_logs').insert(batch);
      if (error) console.warn('操作日志写入失败（不影响主操作）：', error.message);
    } catch (e) {
      console.warn('操作日志写入异常（不影响主操作）：', e);
    }
  },

  // 查询日志
  async query({ startDate, endDate, action, tableName, userId, offset = 0, limit = 200 } = {}) {
    try {
      const client = await Store._ensureClient();
      let query = client.from('operation_logs').select('*', { count: 'exact' });

      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate + 'T23:59:59Z');
      if (action) query = query.eq('action', action);
      if (tableName) query = query.eq('table_name', tableName);
      if (userId) query = query.eq('user_id', userId);

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return { records: Store._toCamelList(data || []), total: count || 0 };
    } catch (e) {
      console.error('查询操作日志失败：', e);
      return { records: [], total: 0 };
    }
  }
};
