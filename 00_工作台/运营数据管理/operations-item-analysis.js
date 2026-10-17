// Read-only analysis of the existing 2.0 facts. No migrations or historical writes.
const DAY = 86400000;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期须为 YYYY-MM-DD');
  const result = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+result) || result.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  return result;
}
function validate(query) {
  const allowed = new Set(['action','kind','dimension','start','end','compareStart','compareEnd','objects','offset','limit']);
  for (const [key, value] of Object.entries(query)) if (!allowed.has(key) || typeof value !== 'string') throw new Error('查询参数无效');
  const q = { action:'summary', kind:'revenue', dimension:'type', offset:'0', limit:'100', ...query };
  if (!['objects','summary','details','ranking','business','funnel'].includes(q.action) || !['revenue','cost'].includes(q.kind)) throw new Error('分析类型无效');
  if(['business','funnel'].includes(q.action)&&q.kind!=='revenue')throw new Error('经营分析须选择收入');
  if (!(q.kind === 'revenue' ? ['layer','type','product','project'] : ['layer','costType','item','project']).includes(q.dimension)) throw new Error('分析维度无效');
  if (+date(q.end) < +date(q.start) || (+date(q.end)-+date(q.start))/DAY > 1096) throw new Error('分析范围须在三年内，结束日期不能早于开始日期');
  if (q.compareStart || q.compareEnd) {
    if (+date(q.compareEnd) < +date(q.compareStart) || (+date(q.compareEnd)-+date(q.compareStart))/DAY > 1096) throw new Error('比较范围无效');
    if(q.compareStart<q.start||q.compareEnd>q.end)throw new Error('比较子期间必须在所选分析范围内');
  }
  q.ids = q.objects ? JSON.parse(q.objects) : [];
  if (!Array.isArray(q.ids) || q.ids.length > 3 || q.ids.some(id => typeof id !== 'string' || !id || id.length > 1500)) throw new Error('请选择最多三个分析对象');
  if(q.action==='ranking'&&(q.kind!=='revenue'||q.dimension!=='product'))throw new Error('商品排行须选择收入商品维度');
  if (!['objects','ranking','business','funnel'].includes(q.action) && !q.ids.length) throw new Error('请选择分析对象');
  if (q.action === 'details' && q.ids.length !== 1) throw new Error('明细须选择一个对象');
  for (const key of ['offset','limit']) if (!/^\d+$/.test(q[key])) throw new Error('分页参数无效');
  q.offset = Number(q.offset); q.limit = Number(q.limit);
  if (q.offset > 100000 || q.limit < 1 || q.limit > 200) throw new Error('分页范围无效');
  return q;
}

// Expressions are fixed here; all dates and object keys are bound parameters.
function dimension(q) {
  const r = q.kind === 'revenue';
  if (q.dimension === 'layer') return ["COALESCE(NULLIF(f.business_layer_code,''),'unclassified')", "COALESCE(NULLIF(f.business_layer_name,''),'待归类业务')"];
  if (q.dimension === 'type') return ["COALESCE(NULLIF(f.business_type_code,''),'unclassified')", "COALESCE(NULLIF(f.business_type_name,''),'待归类收入')"];
  if (q.dimension === 'costType') return ["COALESCE(NULLIF(f.cost_type_code,''),'unclassified')", "COALESCE(NULLIF(f.cost_type_name,''),'待归类成本')"];
  if (q.dimension === 'project') return ["COALESCE(NULLIF(f.project_name,''),'')", "COALESCE(NULLIF(f.project_name,''),'未归属项目')"];
  if (q.dimension === 'item') return ["jsonb_build_array(f.cost_type_code,CASE WHEN f.source_table='expense' THEN COALESCE(NULLIF(e.category,''),'未分类') ELSE f.product_name_standard END,CASE WHEN f.source_table='expense' THEN COALESCE(NULLIF(e.description,''),'未填写说明') ELSE f.product_name_standard END)::text", "CASE WHEN f.source_table='expense' THEN CONCAT_WS(' · ',NULLIF(e.category,''),COALESCE(NULLIF(e.description,''),'未填写说明')) ELSE f.product_name_standard END"];
  return ["jsonb_build_array(f.business_type_code,COALESCE(NULLIF(f.product_id,''),f.product_name_standard),COALESCE(f.package_spec,''))::text", "COALESCE(NULLIF(f.product_name_standard,''),'未命名商品') || CASE WHEN COALESCE(f.package_spec,'')<>'' THEN ' · '||f.package_spec ELSE '' END || CASE WHEN COALESCE(f.product_id,'')='' THEN '（历史名称项）' ELSE '' END"];
}
function source(q) {
  const [key,label] = dimension(q);
  const revenue = q.kind === 'revenue';
  const rawItem="CASE WHEN f.source_line_key LIKE 'retail:%' THEN raw.retail_items ELSE raw.workshop_items END -> (CASE WHEN f.source_line_key ~ '^(retail|workshop):[0-9]+$' THEN split_part(f.source_line_key,':',2)::int-1 ELSE 0 END)";
  const rawQty=`COALESCE((${rawItem})->>'qty',(${rawItem})->>'quantity',(${rawItem})->>'count','')`;
  const quantityValid=`f.quantity>0 AND CASE WHEN f.source_table='revenue' AND f.source_line_key ~ '^(retail|workshop):[0-9]+$' THEN ${rawQty} ~ '^[0-9]+(\\.[0-9]+)?$' ELSE true END`;
  return `WITH base AS (
    SELECT f.*, ${key} AS object_key, ${label} AS object_label ${revenue?`, (${quantityValid}) quantity_valid`:''}
    FROM ${revenue ? 'business_revenue_facts_v2' : 'business_cost_facts_v2'} f
    ${revenue?"LEFT JOIN revenue raw ON f.source_table='revenue' AND raw.id=f.source_id":''}
    ${q.dimension === 'item' ? "LEFT JOIN expense e ON f.source_table='expense' AND e.id=f.source_id" : ''}
    WHERE f.business_date BETWEEN $1 AND $2
  )`;
}
function params(q) { return [q.start,q.end]; }
function numberRows(rows) {
  const numeric=new Set(['amount','quantity','priced_amount','sales_amount','gross_amount','net_amount','cost_amount','refund_amount','deduction_amount','unit_price','unit_cost','covered_profit','cost_covered_revenue','current_amount','compare_amount','current_quantity','compare_quantity','ticket_quantity','visit_revenue','visit_covered_profit','ticket_count','combo_count','standalone_coffee_count']);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, numeric.has(key)&&typeof value==='string' ? Number(value) : value])));
}
function matchedCosts() {return `, matched_cost AS (
  SELECT source_table,source_id,source_line_key,SUM(cost_amount) amount,
  BOOL_OR(COALESCE(unit_cost,0)<=0 OR quality_flags @> '{"missing_unit_cost":true}'::jsonb OR quality_flags @> '{"missing_settlement_price":true}'::jsonb) missing
  FROM business_cost_facts_v2 WHERE cost_basis IN ('sold_cogs','gallery_settlement') AND business_date BETWEEN $1 AND $2
  GROUP BY source_table,source_id,source_line_key)
`;}
// Operational classification is separate from the frozen accounting dictionary.
function analysisGroup(alias='b') {return `CASE
  WHEN ${alias}.source_table IN ('space_usage','space_payments') OR ${alias}.source_line_key='venue_amount' OR ${alias}.business_type_code='space_rental' THEN 'space_cooperation'
  WHEN ${alias}.source_table='gallery_sales' OR ${alias}.business_type_code='gallery_sale' THEN 'art'
  WHEN ${alias}.business_layer_code='visit' THEN 'visit'
  WHEN ${alias}.business_layer_code='onsite_consumption' THEN 'retail'
  WHEN ${alias}.business_layer_code='experience_activity' THEN 'experience'
  ELSE 'unclassified' END`;}
async function queryAnalysis(db, q) {
  const p = params(q), cte = source(q), revenue = q.kind === 'revenue';
  if (q.action === 'objects') {
    const rows = (await db.query(`${cte} SELECT object_key,MIN(object_label) label, SUM(${revenue ? 'net_amount' : 'cost_amount'}) amount,COUNT(*)::int fact_count
      FROM base GROUP BY object_key ORDER BY amount DESC,object_key`,p)).rows;
    return { objects:numberRows(rows), attribution:'existing_facts' };
  }
  if(q.action==='ranking') {
    const rows=(await db.query(`${cte}${matchedCosts()} SELECT b.object_key,MIN(b.object_label) label,MIN(b.business_type_code) business_type_code,MIN(b.business_type_name) business_type_name,
      BOOL_OR(b.source_table='gallery_sales' OR b.business_type_code='gallery_sale') is_gallery_artwork,
      SUM(CASE WHEN b.quantity_valid AND b.gross_amount>=0 THEN b.quantity ELSE 0 END) quantity,
      SUM(CASE WHEN b.quantity_valid AND b.gross_amount>=0 THEN b.gross_amount ELSE 0 END) priced_amount,
      SUM(GREATEST(b.gross_amount,0)) sales_amount,SUM(b.net_amount) net_amount,
      COUNT(*) FILTER(WHERE b.gross_amount>0 AND NOT b.quantity_valid)::int missing_quantity,
      COUNT(DISTINCT b.business_date) FILTER(WHERE b.gross_amount>0)::int sales_days,
      SUM(CASE WHEN b.gross_amount>=0 AND c.amount IS NOT NULL AND NOT c.missing AND b.quantity_valid THEN b.net_amount-c.amount ELSE 0 END) covered_profit,
      COUNT(*) FILTER(WHERE b.gross_amount>=0 AND (c.amount IS NULL OR c.missing OR NOT b.quantity_valid))::int missing_cost,
      COUNT(*)::int fact_count FROM base b LEFT JOIN matched_cost c ON c.source_table=b.source_table AND c.source_id=b.source_id AND c.source_line_key=b.source_line_key
      LEFT JOIN creative_products product ON b.source_table='revenue' AND product.id=b.product_id
      WHERE b.source_table='gallery_sales' OR b.business_type_code='gallery_sale' OR (b.business_type_code='creative_retail' AND NOT COALESCE(product.is_beverage,false))
      GROUP BY b.object_key ORDER BY quantity DESC,net_amount DESC,b.object_key`,p)).rows;
    const refunds=(await db.query("SELECT COUNT(*)::int count FROM business_revenue_facts_v2 WHERE source_table='transaction_adjustments' AND business_date BETWEEN $1 AND $2",p)).rows[0].count;
    return {rows:numberRows(rows),scope:'creative_and_gallery_excluding_beverages',unattributedRefundCount:refunds,complete:true};
  }
  p.push(q.ids);
  if (q.action === 'details') {
    const snapshot = (await db.query(`${cte} SELECT COUNT(*)::int total,MD5(string_agg(to_jsonb(base)::text,'|' ORDER BY fact_id)) fingerprint FROM base WHERE object_key=ANY($3::text[]) AND business_date BETWEEN $1 AND $2`,p)).rows[0];
    const rows = (await db.query(`${cte} SELECT fact_id,business_date,source_table,source_id,source_line_key,object_label,project_name,quantity,
      ${revenue ? 'gross_amount,net_amount,unit_price,quantity_valid AS quantity_reliable' : 'cost_amount,cost_basis'},quality_flags
      FROM base WHERE object_key=ANY($3::text[]) AND business_date BETWEEN $1 AND $2
      ORDER BY business_date,fact_id LIMIT $4 OFFSET $5`, [...p,q.limit,q.offset])).rows;
    return {rows:numberRows(rows),...snapshot,offset:q.offset,limit:q.limit};
  }
  let rows;
  if (['business','funnel'].includes(q.action)) { rows=[]; }
  else if (revenue) {
    rows = (await db.query(`${cte}${matchedCosts()} SELECT b.object_key,MIN(b.object_label) label,b.business_date,
      SUM(b.gross_amount) gross_amount,SUM(b.net_amount) net_amount,
      SUM(CASE WHEN b.source_table='transaction_adjustments' THEN GREATEST(-b.net_amount,0) WHEN b.source_table='gallery_sales' THEN COALESCE(g.refund_amount,0) ELSE GREATEST(b.gross_amount-b.net_amount,0) END) refund_amount,
      SUM(CASE WHEN b.source_table='gallery_sales' THEN GREATEST(b.gross_amount-b.net_amount-COALESCE(g.refund_amount,0),0) ELSE 0 END) deduction_amount,
      SUM(GREATEST(b.gross_amount,0)) sales_amount,
      SUM(CASE WHEN b.quantity_valid AND b.gross_amount>=0 THEN b.quantity ELSE 0 END) quantity,
      SUM(CASE WHEN b.quantity_valid AND b.gross_amount>=0 THEN b.gross_amount ELSE 0 END) priced_amount,
      COUNT(*)::int fact_count,COUNT(DISTINCT (b.source_table,b.source_id))::int record_count,
      COUNT(*) FILTER(WHERE b.gross_amount>0 AND NOT b.quantity_valid)::int missing_quantity,
      jsonb_agg(DISTINCT jsonb_build_array(b.business_type_code,COALESCE(NULLIF(b.product_id,''),b.product_name_standard),b.package_spec)) FILTER(WHERE b.gross_amount>=0 AND b.quantity_valid) quantity_groups,
      SUM(CASE WHEN b.gross_amount>=0 AND c.amount IS NOT NULL AND NOT c.missing AND b.quantity_valid THEN b.net_amount-c.amount ELSE 0 END) covered_profit,
      COUNT(*) FILTER(WHERE b.gross_amount>=0 AND (c.amount IS NULL OR c.missing OR NOT b.quantity_valid))::int missing_cost,
      SUM(CASE WHEN b.gross_amount>=0 AND c.amount IS NOT NULL AND NOT c.missing AND b.quantity_valid THEN b.net_amount ELSE 0 END) cost_covered_revenue,
      COUNT(*) FILTER(WHERE b.source_table='transaction_adjustments')::int unattributed_refunds,
      COUNT(*) FILTER(WHERE b.mapping_status IN ('unmatched','pending_review','unmatched_default'))::int quality_count
    FROM base b LEFT JOIN matched_cost c ON c.source_table=b.source_table AND c.source_id=b.source_id AND c.source_line_key=b.source_line_key
    LEFT JOIN gallery_sales g ON b.source_table='gallery_sales' AND g.id=b.source_id
    WHERE b.object_key=ANY($3::text[]) GROUP BY b.object_key,b.business_date ORDER BY b.business_date,b.object_key`,p)).rows;
  } else {
    rows = (await db.query(`${cte} SELECT object_key,MIN(object_label) label,business_date,SUM(cost_amount) cost_amount,
      COUNT(*)::int fact_count,COUNT(DISTINCT (source_table,source_id))::int record_count,
      COUNT(*) FILTER(WHERE mapping_status IN ('unmatched','pending_review','unmatched_default'))::int quality_count
      FROM base WHERE object_key=ANY($3::text[]) GROUP BY object_key,business_date ORDER BY business_date,object_key`,p)).rows;
  }
  const relatedCosts = revenue && q.dimension === 'project' ? (await db.query(`SELECT project_name object_key,business_date,SUM(cost_amount) cost_amount FROM business_cost_facts_v2
    WHERE cost_basis='period_expense' AND project_name=ANY($3::text[]) AND project_name<>''
    AND business_date BETWEEN $1 AND $2 GROUP BY project_name,business_date`,p)).rows : [];
  const refundCount = revenue ? (await db.query(`SELECT COUNT(*)::int count FROM business_revenue_facts_v2 WHERE source_table='transaction_adjustments'
    AND business_date BETWEEN $1 AND $2`,p.slice(0,2))).rows[0].count : 0;
  const dailyTotals=revenue?(await db.query(`${cte}${matchedCosts()} SELECT b.business_date,SUM(b.net_amount) amount,
    SUM(CASE WHEN b.business_type_code IN ('ticket','visit_combo') AND b.quantity_valid THEN b.quantity ELSE 0 END) ticket_quantity,
    SUM(CASE WHEN b.business_type_code IN ('ticket','visit_combo','coffee','creative_retail') THEN b.net_amount ELSE 0 END) visit_revenue,
    SUM(CASE WHEN b.business_type_code IN ('ticket','visit_combo','coffee','creative_retail') AND c.amount IS NOT NULL AND NOT c.missing AND b.quantity_valid THEN b.net_amount-c.amount ELSE 0 END) visit_covered_profit,
    COUNT(*) FILTER(WHERE b.business_type_code IN ('ticket','visit_combo','coffee','creative_retail') AND (c.amount IS NULL OR c.missing OR NOT b.quantity_valid))::int visit_missing_cost
    FROM base b LEFT JOIN matched_cost c ON c.source_table=b.source_table AND c.source_id=b.source_id AND c.source_line_key=b.source_line_key
    GROUP BY b.business_date ORDER BY b.business_date`,p.slice(0,2))).rows:(await db.query(`${cte} SELECT business_date,SUM(cost_amount) amount FROM base GROUP BY business_date ORDER BY business_date`,p.slice(0,2))).rows;
  const visitorDays=revenue?(await db.query(`SELECT date business_date,SUM(GREATEST(COALESCE(ticket_qty,0),0)) ticket_count,SUM(GREATEST(COALESCE(combo_qty,0),0)) combo_count,SUM(GREATEST(COALESCE(coffee_qty,0),0)) standalone_coffee_count,
    COUNT(*) FILTER(WHERE ticket_amount>0 AND COALESCE(ticket_qty,0)<=0)::int missing_ticket_quantity,
    COUNT(*) FILTER(WHERE combo_amount>0 AND COALESCE(combo_qty,0)<=0)::int missing_combo_quantity,
    COUNT(*) FILTER(WHERE (ticket_amount>0 AND COALESCE(ticket_qty,0)<=0) OR (combo_amount>0 AND COALESCE(combo_qty,0)<=0))::int missing_visitor_quantity
    FROM revenue WHERE date BETWEEN $1 AND $2 AND COALESCE(status,'正常')<>'已作废' GROUP BY date ORDER BY date`,p.slice(0,2))).rows:[];
  const typeDays=revenue?(await db.query(`${cte}${matchedCosts()} SELECT b.business_date,b.business_type_code,MIN(b.business_type_name) business_type_name,${analysisGroup()} analysis_group,
    SUM(b.net_amount) net_amount,SUM(GREATEST(b.gross_amount,0)) sales_amount,
    SUM(CASE WHEN b.quantity_valid AND b.gross_amount>=0 THEN b.quantity ELSE 0 END) quantity,
    COUNT(*) FILTER(WHERE b.gross_amount>0 AND NOT b.quantity_valid)::int missing_quantity,
    SUM(CASE WHEN b.gross_amount>=0 AND c.amount IS NOT NULL AND NOT c.missing AND b.quantity_valid THEN b.net_amount-c.amount ELSE 0 END) covered_profit,
    COUNT(*) FILTER(WHERE b.gross_amount>=0 AND (c.amount IS NULL OR c.missing OR NOT b.quantity_valid))::int missing_cost,
    COUNT(*)::int fact_count
    FROM base b LEFT JOIN matched_cost c ON c.source_table=b.source_table AND c.source_id=b.source_id AND c.source_line_key=b.source_line_key
    ${q.action==='funnel'?`WHERE (b.business_type_code='visit_combo' OR b.business_type_code='creative_retail' OR ${analysisGroup()}='experience' OR ${analysisGroup()}='art') AND NOT (b.business_type_code='creative_retail' AND EXISTS (SELECT 1 FROM creative_products fp WHERE fp.id=b.product_id AND fp.is_beverage=true))`:''}
    GROUP BY b.business_date,b.business_type_code,${analysisGroup()} ORDER BY b.business_date,b.business_type_code`,p.slice(0,2))).rows:[];
  return {typeDays:numberRows(typeDays),visitorDays:numberRows(visitorDays),dailyTotals:numberRows(dailyTotals),rows:numberRows(rows),relatedCosts:numberRows(relatedCosts),unattributedRefundCount:refundCount,complete:true};
}
module.exports = function createHandler({pool,getRequester,ensureRole,sendJSON,sendError,toCamel,readOperationsRollout,rolloutEnabledForRole}) {
  return async (req,res,query) => {
    try {
      const user = await getRequester(req);
      if (!ensureRole(res,user,['admin','editor'])) return;
      if (req.method !== 'GET') return sendError(res,405,'逐项分析只读');
      const rollout = await readOperationsRollout();
      if (!rolloutEnabledForRole(rollout.mode,user.role)) return sendError(res,403,'运营管理当前未开放');
      let q; try { q=validate(query); } catch (error) { return sendError(res,400,error.message); }
      // All queries in one read-only snapshot: totals and paginated counts cannot disagree within a response.
      const db = await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await db.query("SET LOCAL statement_timeout='15s'");
        const result = await queryAnalysis(db,q);
        await db.query('COMMIT');
        // The existing converter is intentionally shallow. Convert each fact, not just the envelope.
        const payload={...result};
        for(const key of ['objects','rows','relatedCosts','dailyTotals','visitorDays','typeDays'])if(payload[key])payload[key]=payload[key].map(toCamel);
        if(payload.totals)payload.totals=toCamel(payload.totals);
        if(payload.ticketTotals)payload.ticketTotals=toCamel(payload.ticketTotals);
        sendJSON(res,200,payload);
      } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
    } catch (error) { console.error('Item analysis failed:', error.message); sendError(res,500,'分析暂不可用，请重试或缩小时间范围'); }
  };
};
module.exports.validate=validate;
module.exports.queryAnalysis=queryAnalysis;
