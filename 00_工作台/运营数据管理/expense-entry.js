const crypto = require('node:crypto');

// One transaction owns the raw expense, its classification and its audit entry.
module.exports = function createExpenseEntryHandler({ pool, getRequester, ensureRole, sendJSON, sendError, toCamel, toSnake }) {
  const editable = new Set(['date', 'project', 'category', 'amount', 'description', 'handler', 'invoice_status', 'receipt_status', 'related_activity']);
  const fields = { business_layer_code: 'business_layer', business_type_code: 'business_type', cost_type_code: 'cost_type', capability_axis_code: 'capability_axis' };
  const match = async (client, expense) => (await client.query(
    'SELECT * FROM match_expense_rule_v2($1, $2, $3, $4)',
    [expense.project || '', expense.related_activity || '', expense.category || '', expense.description || '']
  )).rows[0] || null;

  return async function handleExpenseEntry(req, res, query = {}) {
    let client;
    try {
      const user = await getRequester(req);
      if (!ensureRole(res, user, ['admin', 'editor'])) return;
      if (req.method === 'GET') {
        const dimensions = (await pool.query('SELECT * FROM business_dimensions WHERE is_active = true ORDER BY sort_order, code')).rows;
        let expense = {}, classification = null;
        if (query.id) {
          expense = (await pool.query('SELECT * FROM expense WHERE id = $1', [query.id])).rows[0];
          if (!expense) return sendError(res, 404, '支出记录不存在');
          classification = (await pool.query("SELECT * FROM record_business_links WHERE source_table='expense' AND source_id=$1 AND source_line_key='expense'", [query.id])).rows[0] || null;
        }
        const input = { ...expense };
        for (const key of ['project', 'category', 'description', 'related_activity']) {
          if (query[key] !== undefined) input[key] = String(query[key]);
        }
        const suggestion = await match(pool, input);
        return sendJSON(res, 200, { dimensions: dimensions.map(toCamel), suggestion: toCamel(suggestion), classification: toCamel(classification) });
      }
      if (!['POST', 'PATCH'].includes(req.method)) return sendError(res, 405, '仅支持查询、新增和编辑');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 65536) return sendError(res, 413, '请求内容过大');
      }
      const payload = JSON.parse(body);
      if (!payload.expense || typeof payload.expense !== 'object' || !payload.classification) return sendError(res, 400, '缺少支出或归属信息');
      const input = toSnake(payload.expense);
      const id = req.method === 'PATCH' ? String(query.id || '') : String(input.id || crypto.randomUUID());
      if (!id || id.length > 100) return sendError(res, 400, '无效记录编号');
      client = await pool.connect();
      await client.query('BEGIN');
      let previous = null;
      if (req.method === 'PATCH') {
        previous = (await client.query('SELECT * FROM expense WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!previous) { await client.query('ROLLBACK'); return sendError(res, 404, '支出记录不存在'); }
        if (previous.type === '备用金借入') throw new Error('借入记录不作为运营成本归属');
      }
      const expense = { ...(previous || { id, type: '运营支出', reimbursement_status: '未报销' }) };
      for (const key of editable) if (input[key] !== undefined) expense[key] = input[key];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.date || '') || !Number.isFinite(Date.parse(expense.date)) || new Date(expense.date).toISOString().slice(0, 10) !== expense.date) throw new Error('请选择有效日期');
      expense.amount = Number(expense.amount);
      if (!Number.isFinite(expense.amount) || expense.amount <= 0 || expense.amount >= 1e10) throw new Error('金额必须为有效正数');
      if (!String(expense.category || '').trim()) throw new Error('请选择支出类别');
      expense.project = String(expense.project || '运营').trim() || '运营';
      const classification = toSnake(payload.classification);
      let rule = null, values;
      if (classification.mode === 'suggested') {
        rule = await match(client, expense);
        values = rule || {};
      } else if (classification.mode === 'manual') {
        values = classification;
      } else if (classification.mode === 'pending') {
        values = {};
      } else throw new Error('请选择有效归属方式');
      const codes = {};
      for (const [key, dimension] of Object.entries(fields)) {
        codes[key] = String(values[key] || (key === 'cost_type_code' ? 'uncategorized_cost' : ''));
        if (codes[key]) {
          const found = (await client.query('SELECT parent_code FROM business_dimensions WHERE dimension_type=$1 AND code=$2 AND is_active=true', [dimension, codes[key]])).rows[0];
          if (!found) throw new Error('归属选项无效或已停用');
          if (dimension === 'business_type' && found.parent_code !== codes.business_layer_code) throw new Error('业务类型与业务层不匹配');
        }
      }
      const cols = [...editable].filter(key => expense[key] !== undefined);
      let saved;
      if (previous) {
        saved = (await client.query(`UPDATE expense SET ${cols.map((key, i) => `"${key}"=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map(key => expense[key]), id])).rows[0];
      } else {
        const names = ['id', 'type', ...cols];
        saved = (await client.query(`INSERT INTO expense (${names.map(key => `"${key}"`).join(',')}) VALUES (${names.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, names.map(key => expense[key]))).rows[0];
      }
      const link = (await client.query(`INSERT INTO record_business_links
        (id,source_table,source_id,source_line_key,business_layer_code,business_type_code,cost_type_code,capability_axis_code,mapping_rule_id,override_reason,created_by)
        VALUES($1,'expense',$2,'expense',$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(source_table,source_id,source_line_key) DO UPDATE SET
          business_layer_code=EXCLUDED.business_layer_code,business_type_code=EXCLUDED.business_type_code,
          cost_type_code=EXCLUDED.cost_type_code,capability_axis_code=EXCLUDED.capability_axis_code,
          mapping_rule_id=EXCLUDED.mapping_rule_id,override_reason=EXCLUDED.override_reason,updated_at=NOW()
        RETURNING *`, [crypto.randomUUID(), id, codes.business_layer_code, codes.business_type_code, codes.cost_type_code,
        codes.capability_axis_code, rule?.id || '', String(classification.override_reason || '').slice(0, 500), user.id])).rows[0];
      await client.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',
        [crypto.randomUUID(), user.id, previous ? 'update' : 'create', 'expense', id,
          JSON.stringify({ source: 'expense-entry-v2', before: previous, after: saved, classification: link })]);
      await client.query('COMMIT');
      return sendJSON(res, previous ? 200 : 201, { expense: toCamel(saved), classification: toCamel(link) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return sendError(res, 400, error.code === '23505' ? '记录已存在，请刷新后编辑' : error.message);
    } finally {
      client?.release();
    }
  };
};
