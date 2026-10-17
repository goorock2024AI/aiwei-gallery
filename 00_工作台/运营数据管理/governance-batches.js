const crypto = require('node:crypto');

module.exports = function createGovernanceBatchHandler({ pool, getRequester, ensureRole, sendJSON, sendError, toCamel }) {
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const parseBody = async req => {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 256 * 1024) throw fail('请求内容过大', 413);
    }
    try { return JSON.parse(body || '{}'); } catch { throw fail('JSON 格式不正确'); }
  };
  const json = value => JSON.stringify(value ?? null);
  const stable = value => JSON.stringify(value, Object.keys(value || {}).sort());
  const linkComparable = row => row ? {
    id: row.id, source_table: row.source_table, source_id: row.source_id,
    source_line_key: row.source_line_key, business_layer_code: row.business_layer_code || '',
    business_type_code: row.business_type_code || '', cost_type_code: row.cost_type_code || '',
    capability_axis_code: row.capability_axis_code || '', product_id: row.product_id || '',
    product_alias_id: row.product_alias_id || '', mapping_rule_id: row.mapping_rule_id || '',
    override_reason: row.override_reason || '', created_by: row.created_by || ''
  } : null;

  async function addAudit(client, user, batchId, action, fromStatus, toStatus, details = {}) {
    await client.query(`INSERT INTO governance_batch_events(id,batch_id,action,from_status,to_status,actor_id,actor_name,details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [makeId('govevent'), batchId, action, fromStatus || '', toStatus || '', user.id, user.displayName || user.username || user.id, json(details)]);
    await client.query(`INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details)
      VALUES($1,$2,$3,'governance_batches',$4,$5::jsonb)`, [crypto.randomUUID(), user.id, `governance_${action}`, batchId, json({ fromStatus, toStatus, ...details })]);
  }

  async function readBatch(client, id) {
    const result = await client.query('SELECT * FROM governance_batch_summary_v2 WHERE id=$1', [id]);
    return result.rows[0] ? toCamel(result.rows[0]) : null;
  }

  async function resolveCandidate(client, candidateId) {
    let result = await client.query(`SELECT candidate_id,source_table,source_id,source_line_key,affected_amount,candidate_status,
      suggested_business_layer_code,suggested_business_type_code,matched_field,matched_value,candidate_options
      FROM revenue_attribution_candidates_v2 WHERE candidate_id=$1`, [candidateId]);
    if (result.rows[0]) {
      const row = result.rows[0];
      if (row.candidate_status !== 'unique_rule' || !row.suggested_business_layer_code || !row.suggested_business_type_code) throw fail('收入候选不是可应用的唯一规则结论', 409);
      const option = Array.isArray(row.candidate_options) ? row.candidate_options[0] || {} : {};
      return {
        candidateType: 'revenue_attribution', candidateId: row.candidate_id,
        sourceTable: row.source_table, sourceId: row.source_id, sourceLineKey: row.source_line_key,
        affectedAmount: Number(row.affected_amount || 0), note: `${row.matched_field || ''}=${row.matched_value || ''}`,
        proposed: {
          businessLayerCode: row.suggested_business_layer_code,
          businessTypeCode: row.suggested_business_type_code,
          costTypeCode: '', capabilityAxisCode: '', productId: '', productAliasId: '',
          mappingRuleId: option.ruleId || option.rule_id || '',
          overrideReason: 'M4 治理候选经批次审核应用'
        }
      };
    }
    result = await client.query(`SELECT candidate_id,source_table,source_id,source_line_key,affected_amount,candidate_status,
      suggested_business_layer_code,suggested_business_type_code,suggested_cost_type_code,
      suggested_capability_axis_code,matched_field,matched_value,candidate_options
      FROM cost_attribution_candidates_v2 WHERE candidate_id=$1`, [candidateId]);
    if (result.rows[0]) {
      const row = result.rows[0];
      if (row.candidate_status !== 'unique_rule' || !row.suggested_cost_type_code) throw fail('成本候选不是可应用的唯一规则结论', 409);
      const option = Array.isArray(row.candidate_options) ? row.candidate_options[0] || {} : {};
      return {
        candidateType: 'cost_attribution', candidateId: row.candidate_id,
        sourceTable: row.source_table, sourceId: row.source_id, sourceLineKey: row.source_line_key,
        affectedAmount: Number(row.affected_amount || 0), note: `${row.matched_field || ''}=${row.matched_value || ''}`,
        proposed: {
          businessLayerCode: row.suggested_business_layer_code || '',
          businessTypeCode: row.suggested_business_type_code || '',
          costTypeCode: row.suggested_cost_type_code,
          capabilityAxisCode: row.suggested_capability_axis_code || '',
          productId: '', productAliasId: '', mappingRuleId: option.ruleId || option.rule_id || '',
          overrideReason: 'M4 治理候选经批次审核应用'
        }
      };
    }
    throw fail('候选不存在，或已因其他归属变更而失效', 409);
  }

  async function validateDimensions(client, proposed) {
    const errors = [];
    const checks = [
      ['business_layer', proposed.businessLayerCode], ['business_type', proposed.businessTypeCode],
      ['cost_type', proposed.costTypeCode], ['capability_axis', proposed.capabilityAxisCode]
    ].filter(([, code]) => code);
    for (const [type, code] of checks) {
      const ok = (await client.query('SELECT 1 FROM business_dimensions WHERE dimension_type=$1 AND code=$2 AND is_active=true', [type, code])).rowCount === 1;
      if (!ok) errors.push(`${type}:${code} 不在有效维度字典中`);
    }
    return errors;
  }

  async function currentLink(client, item, lock = false) {
    return (await client.query(`SELECT * FROM record_business_links WHERE source_table=$1 AND source_id=$2 AND source_line_key=$3${lock ? ' FOR UPDATE' : ''}`,
      [item.source_table, item.source_id, item.source_line_key])).rows[0] || null;
  }

  async function runDryRun(client, user, batch) {
    const items = (await client.query('SELECT * FROM governance_batch_items WHERE batch_id=$1 ORDER BY sequence_no FOR UPDATE', [batch.id])).rows;
    let valid = 0, invalid = 0, createCount = 0, updateCount = 0, affectedAmount = 0;
    const checksumParts = [];
    for (const item of items) {
      const errors = [];
      let resolved;
      try { resolved = await resolveCandidate(client, item.candidate_id); } catch (error) { errors.push(error.message); }
      const proposed = item.proposed_payload || {};
      if (resolved) {
        if (resolved.sourceTable !== item.source_table || resolved.sourceId !== item.source_id || resolved.sourceLineKey !== item.source_line_key) errors.push('候选来源定位已变化');
        if (stable(resolved.proposed) !== stable(proposed)) errors.push('候选建议值已变化，请重建批次');
      }
      errors.push(...await validateDimensions(client, proposed));
      const sourceTable = item.source_table === 'revenue' ? 'revenue' : item.source_table === 'expense' ? 'expense' : '';
      if (!sourceTable) errors.push('不支持的来源表');
      else if ((await client.query(`SELECT 1 FROM ${sourceTable} WHERE id=$1`, [item.source_id])).rowCount !== 1) errors.push('原始来源记录不存在');
      const before = await currentLink(client, item, false);
      if (before) errors.push('来源已有人工归属，候选已失效');
      const status = errors.length ? 'invalid' : 'valid';
      await client.query(`UPDATE governance_batch_items SET before_payload=$1::jsonb,validation_status=$2,validation_errors=$3::jsonb,updated_at=NOW() WHERE id=$4`,
        [before ? json(before) : null, status, json(errors), item.id]);
      if (errors.length) invalid++; else { valid++; before ? updateCount++ : createCount++; affectedAmount += Number(item.affected_amount || 0); }
      checksumParts.push({ id: item.id, candidateId: item.candidate_id, before: linkComparable(before), proposed, errors });
    }
    const summary = {
      itemCount: items.length, validItemCount: valid, invalidItemCount: invalid,
      createCount, updateCount, affectedAmount: Math.round(affectedAmount * 100) / 100,
      sourceFactsChanged: 0,
      checksum: crypto.createHash('sha256').update(json(checksumParts)).digest('hex')
    };
    await client.query('UPDATE governance_batches SET dry_run_summary=$1::jsonb,dry_run_at=NOW(),updated_at=NOW() WHERE id=$2', [json(summary), batch.id]);
    await addAudit(client, user, batch.id, 'dry_run', batch.status, batch.status, summary);
    return summary;
  }

  return async function handleGovernanceBatches(req, res, query = {}) {
    let client;
    try {
      const user = await getRequester(req);
      if (!ensureRole(res, user, ['admin', 'editor'])) return;
      const action = String(query.action || '');
      const batchId = String(query.id || '');
      if (req.method === 'GET') {
        if (batchId) {
          const batch = await readBatch(pool, batchId);
          return batch ? sendJSON(res, 200, batch) : sendError(res, 404, '治理批次不存在');
        }
        const result = await pool.query('SELECT * FROM governance_batch_summary_v2 ORDER BY created_at DESC LIMIT 200');
        return sendJSON(res, 200, result.rows.map(toCamel));
      }
      if (req.method !== 'POST') return sendError(res, 405, '仅支持查询和工作流操作');
      const body = await parseBody(req);
      client = await pool.connect();
      await client.query('BEGIN');

      if (!action || action === 'create') {
        const name = String(body.name || '').trim().slice(0, 120);
        const candidateIds = [...new Set((Array.isArray(body.candidateIds) ? body.candidateIds : []).map(String).map(x => x.trim()).filter(Boolean))];
        if (!name) throw fail('请输入批次名称');
        if (!candidateIds.length || candidateIds.length > 100) throw fail('每批请选择 1 至 100 条候选');
        const batch = { id: makeId('govbatch'), name, description: String(body.description || '').trim().slice(0, 500) };
        const resolved = [];
        for (const candidateId of candidateIds) resolved.push(await resolveCandidate(client, candidateId));
        const sourceKeys = resolved.map(x => `${x.sourceTable}|${x.sourceId}|${x.sourceLineKey}`);
        if (new Set(sourceKeys).size !== sourceKeys.length) throw fail('同一来源明细不能在一个批次中重复');
        await client.query(`INSERT INTO governance_batches(id,name,description,created_by) VALUES($1,$2,$3,$4)`, [batch.id, batch.name, batch.description, user.id]);
        for (let index = 0; index < resolved.length; index++) {
          const item = resolved[index];
          await client.query(`INSERT INTO governance_batch_items(id,batch_id,sequence_no,candidate_type,candidate_id,source_table,source_id,source_line_key,proposed_payload,affected_amount,note)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`, [makeId('govitem'), batch.id, index + 1, item.candidateType, item.candidateId, item.sourceTable, item.sourceId, item.sourceLineKey, json(item.proposed), item.affectedAmount, item.note]);
        }
        await addAudit(client, user, batch.id, 'create', '', 'draft', { itemCount: resolved.length, candidateIds });
        await client.query('COMMIT'); client.release(); client = null;
        return sendJSON(res, 201, await readBatch(pool, batch.id));
      }

      if (!batchId) throw fail('缺少治理批次 ID');
      const batch = (await client.query('SELECT * FROM governance_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0];
      if (!batch) throw fail('治理批次不存在', 404);

      if (action === 'dry-run') {
        if (batch.status !== 'draft') throw fail('只有草稿批次可以重新预览', 409);
        const summary = await runDryRun(client, user, batch);
        await client.query('COMMIT'); client.release(); client = null;
        return sendJSON(res, 200, { batch: await readBatch(pool, batch.id), summary });
      }
      if (action === 'submit') {
        if (batch.status !== 'draft') throw fail('只有草稿批次可以提交审核', 409);
        if (!batch.dry_run_at) throw fail('提交前必须完成 dry-run', 409);
        const invalid = Number((await client.query("SELECT COUNT(*) FROM governance_batch_items WHERE batch_id=$1 AND validation_status<>'valid'", [batch.id])).rows[0].count);
        if (invalid) throw fail('批次存在未通过 dry-run 的项目', 409);
        await client.query("UPDATE governance_batches SET status='pending_review',submitted_by=$1,submitted_at=NOW(),updated_at=NOW() WHERE id=$2", [user.id, batch.id]);
        await addAudit(client, user, batch.id, 'submit', 'draft', 'pending_review', { checksum: batch.dry_run_summary?.checksum || '' });
      } else if (action === 'approve' || action === 'reject') {
        if (user.role !== 'admin') throw fail('只有管理员可以审批治理批次', 403);
        if (batch.status !== 'pending_review') throw fail('只有待审核批次可以审批', 409);
        const next = action === 'approve' ? 'approved' : 'rejected';
        await client.query('UPDATE governance_batches SET status=$1,reviewed_by=$2,reviewed_at=NOW(),review_note=$3,updated_at=NOW() WHERE id=$4', [next, user.id, String(body.note || '').slice(0, 500), batch.id]);
        await addAudit(client, user, batch.id, action, 'pending_review', next, { note: String(body.note || '') });
      } else if (action === 'apply') {
        if (user.role !== 'admin') throw fail('只有管理员可以应用治理批次', 403);
        if (batch.status !== 'approved') throw fail('只有已批准批次可以应用', 409);
        const items = (await client.query("SELECT * FROM governance_batch_items WHERE batch_id=$1 ORDER BY sequence_no FOR UPDATE", [batch.id])).rows;
        let affectedAmount = 0;
        for (const item of items) {
          if (item.validation_status !== 'valid') throw fail('批次项目状态已变化，请重新创建批次', 409);
          const resolved = await resolveCandidate(client, item.candidate_id);
          if (stable(resolved.proposed) !== stable(item.proposed_payload || {})) throw fail('候选建议值已变化，停止应用', 409);
          const current = await currentLink(client, item, true);
          if (stable(linkComparable(current)) !== stable(linkComparable(item.before_payload))) throw fail('人工归属已被其他操作修改，停止应用', 409);
          const p = item.proposed_payload || {};
          const linkId = current?.id || 'govlink_' + crypto.createHash('sha256').update(`${item.source_table}|${item.source_id}|${item.source_line_key}`).digest('hex').slice(0, 20);
          const saved = (await client.query(`INSERT INTO record_business_links(id,source_table,source_id,source_line_key,business_layer_code,business_type_code,cost_type_code,capability_axis_code,product_id,product_alias_id,mapping_rule_id,override_reason,created_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT(source_table,source_id,source_line_key) DO UPDATE SET business_layer_code=EXCLUDED.business_layer_code,business_type_code=EXCLUDED.business_type_code,cost_type_code=EXCLUDED.cost_type_code,capability_axis_code=EXCLUDED.capability_axis_code,product_id=EXCLUDED.product_id,product_alias_id=EXCLUDED.product_alias_id,mapping_rule_id=EXCLUDED.mapping_rule_id,override_reason=EXCLUDED.override_reason,updated_at=NOW()
            RETURNING *`, [linkId,item.source_table,item.source_id,item.source_line_key,p.businessLayerCode||'',p.businessTypeCode||'',p.costTypeCode||'',p.capabilityAxisCode||'',p.productId||'',p.productAliasId||'',p.mappingRuleId||'',`${p.overrideReason || '治理批次应用'}；批次 ${batch.id}`,user.id])).rows[0];
          await client.query("UPDATE governance_batch_items SET applied_payload=$1::jsonb,validation_status='applied',updated_at=NOW() WHERE id=$2", [json(saved), item.id]);
          affectedAmount += Number(item.affected_amount || 0);
        }
        await client.query("UPDATE governance_batches SET status='applied',applied_by=$1,applied_at=NOW(),updated_at=NOW() WHERE id=$2", [user.id, batch.id]);
        await addAudit(client, user, batch.id, 'apply', 'approved', 'applied', { itemCount: items.length, affectedAmount: Math.round(affectedAmount * 100) / 100, sourceFactsChanged: 0 });
      } else if (action === 'revert') {
        if (user.role !== 'admin') throw fail('只有管理员可以撤销治理批次', 403);
        if (batch.status !== 'applied') throw fail('只有已应用批次可以撤销', 409);
        const items = (await client.query('SELECT * FROM governance_batch_items WHERE batch_id=$1 ORDER BY sequence_no DESC FOR UPDATE', [batch.id])).rows;
        for (const item of items) {
          const current = await currentLink(client, item, true);
          if (stable(linkComparable(current)) !== stable(linkComparable(item.applied_payload))) throw fail('应用后的归属已被再次修改，停止撤销', 409);
          if (item.before_payload) {
            const b = item.before_payload;
            await client.query(`INSERT INTO record_business_links(id,source_table,source_id,source_line_key,business_layer_code,business_type_code,cost_type_code,capability_axis_code,product_id,product_alias_id,mapping_rule_id,override_reason,created_by,created_at,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
              ON CONFLICT(source_table,source_id,source_line_key) DO UPDATE SET business_layer_code=EXCLUDED.business_layer_code,business_type_code=EXCLUDED.business_type_code,cost_type_code=EXCLUDED.cost_type_code,capability_axis_code=EXCLUDED.capability_axis_code,product_id=EXCLUDED.product_id,product_alias_id=EXCLUDED.product_alias_id,mapping_rule_id=EXCLUDED.mapping_rule_id,override_reason=EXCLUDED.override_reason,created_by=EXCLUDED.created_by,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, [b.id,b.source_table,b.source_id,b.source_line_key,b.business_layer_code||'',b.business_type_code||'',b.cost_type_code||'',b.capability_axis_code||'',b.product_id||'',b.product_alias_id||'',b.mapping_rule_id||'',b.override_reason||'',b.created_by||'',b.created_at,b.updated_at]);
          } else if (current) {
            await client.query('DELETE FROM record_business_links WHERE id=$1', [current.id]);
          }
          await client.query("UPDATE governance_batch_items SET validation_status='reverted',updated_at=NOW() WHERE id=$1", [item.id]);
        }
        await client.query("UPDATE governance_batches SET status='reverted',reverted_by=$1,reverted_at=NOW(),updated_at=NOW() WHERE id=$2", [user.id, batch.id]);
        await addAudit(client, user, batch.id, 'revert', 'applied', 'reverted', { itemCount: items.length, sourceFactsChanged: 0 });
      } else {
        throw fail('不支持的治理批次操作', 405);
      }
      await client.query('COMMIT'); client.release(); client = null;
      return sendJSON(res, 200, await readBatch(pool, batch.id));
    } catch (error) {
      if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      return sendError(res, error.status || 400, error.message);
    }
  };
};
