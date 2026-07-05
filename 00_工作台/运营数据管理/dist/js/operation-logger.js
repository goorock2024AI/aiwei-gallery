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

    // 合并写入：50ms 内的操作合并为一次写入
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), 50);
    }
  },

  _flush() {
    this._timer = null;
    const batch = this._batch.splice(0);
    if (!batch.length) return;

    // 批量写入（不阻塞主流程）
    Promise.all(batch.map(r =>
      fetch(SUPABASE_CONFIG.url + '/rest/v1/operation_logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r)
      }).catch(() => {})
    )).catch(() => {});
  },

  // 查询日志
  async query({ startDate, endDate, action, tableName, userId, offset = 0, limit = 200 } = {}) {
    try {
      const base = await Store._ensureClient();
      let path = '/rest/v1/operation_logs?order=created_at.desc';
      if (startDate) path += '&created_at=gte.' + startDate;
      if (endDate) path += '&created_at=lte.' + endDate + 'T23:59:59Z';
      if (action) path += '&action=eq.' + encodeURIComponent(action);
      if (tableName) path += '&table_name=eq.' + encodeURIComponent(tableName);
      if (userId) path += '&user_id=eq.' + encodeURIComponent(userId);

      const res = await fetch(base + path + '&limit=' + limit + '&offset=' + offset);
      const data = await res.json();
      const records = Array.isArray(data) ? data : [];
      return { records, total: records.length };
    } catch (e) {
      console.error('查询操作日志失败：', e);
      return { records: [], total: 0 };
    }
  }
};
