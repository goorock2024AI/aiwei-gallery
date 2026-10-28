const crypto = require('node:crypto');
const spaceSchema = require('./app/js/space-project-schema');

module.exports = function createSpaceEntryHandler({ pool, getRequester, ensureRole, sendJSON, sendError, toCamel, toSnake }) {
  const editable = ['date','end_date','space','project_name','type','client','status','rental_type','receivable_amount','expected_payment_date','notes','business_layer_code','business_type_code','cooperation_mode','project_owner','contract_no','business_status'];
  const typeCodes = new Set(['space_rental', 'brand_event', 'uncategorized_revenue']);
  const businessStatuses = new Set(['线索', '洽谈', '待签署', '暂缓', '未成交', '租赁确认', '已签约', '执行中', '已完成', '已取消', '待确认']);
  const suggestedType = type => {
    if (['场地租赁', '长期经营', '会议活动'].includes(type)) return 'space_rental';
    if (['品牌快闪', '企业团建', '沙龙'].includes(type)) return 'brand_event';
    return 'uncategorized_revenue';
  };
  const suggestedStatus = status => ({ '筹备中': '洽谈', '已确认': '已签约', '进行中': '执行中', '已完成': '已完成', '已取消': '已取消', '空闲': '待确认' }[status] || '待确认');
  const parseBody = async req => {
    let body = '';
    for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 65536) throw new Error('请求内容过大'); }
    return JSON.parse(body || '{}');
  };
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(value).toISOString().slice(0, 10) === value;
  const log = (client, user, action, id, details) => client.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), user.id, action, 'space_usage', id, JSON.stringify(details)]);

  return async function handleSpaceEntry(req, res, query = {}) {
    let client;
    try {
      const user = await getRequester(req);
      if (!ensureRole(res, user, ['admin', 'editor'])) return;
      if (req.method === 'GET') {
        const type = String(query.type || '');
        const status = String(query.status || '');
        return sendJSON(res, 200, { businessTypeCode: suggestedType(type), businessStatus: suggestedStatus(status), requiresConfirmation: suggestedType(type) === 'uncategorized_revenue' });
      }
      if (!['POST', 'PATCH'].includes(req.method)) return sendError(res, 405, '仅支持查询、新增、编辑和到账录入');
      const payload = await parseBody(req);
      client = await pool.connect();
      await client.query('BEGIN');

      if (query.action === 'payment') {
        if (!payload.payment || typeof payload.payment !== 'object') throw new Error('缺少到账明细');
        const projectId = String(query.id || payload.payment.spaceUsageId || '');
        const project = (await client.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE', [projectId])).rows[0];
        if (!project) throw new Error('空间项目不存在');
        const result=await require('./space-payment')(client,user,project,payload.payment);
        await client.query('COMMIT');
        return sendJSON(res,result.unchanged?200:201,{...result,payment:toCamel(result.payment)});
      }

      if (!payload.project || typeof payload.project !== 'object') throw new Error('缺少空间项目数据');
      const input = toSnake(payload.project);
      const id = String(query.id || input.id || crypto.randomUUID());
      let previous = null;
      if (req.method === 'PATCH') {
        previous = (await client.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!previous) throw new Error('空间项目不存在');
        if((await client.query("SELECT 1 FROM space_quick_rentals WHERE space_usage_id=$1 AND mode='simple'",[id])).rowCount)throw Error('此项目使用简易流程，请通过简易登记维护或转入完整流程');
      }
      const project = { ...(previous || {}), id };
      for (const key of editable) if (input[key] !== undefined) project[key] = input[key];
      project.business_status = String(project.business_status || (previous ? previous.business_status || '' : '线索'));
      const opportunity = spaceSchema.isOpportunity(project);
      if (!previous && !opportunity) throw new Error('请先建立线索或洽谈项目，再通过明确合作确认登记签约依据');
      if (previous && spaceSchema.isOpportunity(previous) && !opportunity) throw new Error('请在项目工作台通过明确合作确认登记签约依据');
      if (previous && !spaceSchema.isOpportunity(previous) && opportunity) throw new Error('正式或历史合作不能直接退回洽谈，请核对合同变更与收支');
      project.date = project.date || '';
      project.end_date = project.end_date || project.date;
      if ((!opportunity || project.date) && !validDate(project.date)) throw new Error('请选择有效的项目开始日期');
      if ((!opportunity || project.end_date) && !validDate(project.end_date)) throw new Error('请选择有效的项目结束日期');
      if (project.end_date < project.date) throw new Error('结束日期不能早于开始日期');
      if (opportunity && !previous) project.status = '筹备中';
      if(previous&&project.status!==previous.status)throw Error('请使用列表中的编辑状态并填写原因，不能在登记信息中直接改状态');
      if (!String(project.project_name || '').trim()) throw new Error('请输入项目/活动名称');
      project.receivable_amount = Math.round(Number(project.receivable_amount || 0) * 100) / 100;
      if (!Number.isFinite(project.receivable_amount) || project.receivable_amount < 0) throw new Error('应收金额不能为负数');
      if (project.rental_type === '免费') project.receivable_amount = 0;
      if (!opportunity && project.rental_type === '付费' && project.receivable_amount <= 0) throw new Error('付费合同必须填写应收金额');
      project.business_layer_code = 'art_transaction_cooperation';
      project.business_type_code = String(project.business_type_code || suggestedType(project.type));
      if (!typeCodes.has(project.business_type_code)) throw new Error('请选择有效业务类型');
      if (project.business_status && !businessStatuses.has(project.business_status)) throw new Error('请选择有效经营状态');
      await require('./space-catalog').guardSelection(client,project.space,previous?.space,true);
      if (previous) await require('./space-accounting').guardProject(client, project);
      if (!String(project.cooperation_mode || '').trim()) throw new Error('请选择合作方式');
      if (['已签约', '执行中', '已完成'].includes(project.business_status) && project.rental_type === '付费' && !String(project.contract_no || '').trim()) throw new Error('付费签约项目必须填写合同编号');
      if (['已确认','进行中'].includes(project.status)) {const booking=require('./space-booking');await booking.guard(client,{id,space:project.space,...await booking.range(client,project)});}
      if(previous)await require('./space-booking').sync(client,project);
      let saved;
      if (previous) saved = (await client.query(`UPDATE space_usage SET ${editable.map((key, i) => `"${key}"=$${i + 1}`).join(',')} WHERE id=$${editable.length + 1} RETURNING *`, [...editable.map(key => project[key]), id])).rows[0];
      else saved = (await client.query(`INSERT INTO space_usage(id,${editable.map(k => `"${k}"`).join(',')}) VALUES($1,${editable.map((_, i) => '$' + (i + 2)).join(',')}) RETURNING *`, [id, ...editable.map(key => project[key])])).rows[0];
      await log(client, user, previous ? 'update' : 'create', id, { source: 'space-entry-v2', before: previous, after: saved, classificationSource: payload.classificationSource || 'manual' });
      await client.query('COMMIT');
      return sendJSON(res, previous ? 200 : 201, { project: toCamel(saved) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return sendError(res, error.status || (error.message === '请求内容过大' ? 413 : 400), error.code === '23505' ? '合同编号或记录已存在' : error.message);
    } finally { client?.release(); }
  };
};
