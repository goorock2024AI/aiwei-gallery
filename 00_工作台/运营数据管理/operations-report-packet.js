const crypto=require('node:crypto'),analysis=require('./operations-item-analysis'),metrics=require('./operations-report-metrics');
const toCamel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const camelData=data=>{const out={...data};for(const key of ['typeDays','visitorDays','dailyTotals','rows','relatedCosts'])if(out[key])out[key]=out[key].map(toCamel);return out;};
async function collectPacket(db,current,previous,context=''){
 current=analysis.validate({action:'business',kind:'revenue',dimension:'type',start:current.start,end:current.end});previous=analysis.validate({action:'business',kind:'revenue',dimension:'type',start:previous.start,end:previous.end});
 const start=[current.start,previous.start].sort()[0],end=[current.end,previous.end].sort().pop();
  const business=camelData(await analysis.queryAnalysis(db,{...current,start,end}));const funnel=camelData(await analysis.queryAnalysis(db,{...current,start,end,action:'funnel'}));
  const products={current:camelData(await analysis.queryAnalysis(db,{...current,action:'ranking',dimension:'product'})),previous:camelData(await analysis.queryAnalysis(db,{...previous,action:'ranking',dimension:'product'}))};
  const periodExpenses=(await db.query(`SELECT business_date,business_layer_code,cost_type_code,SUM(cost_amount)::float8 amount FROM business_cost_facts_v2 WHERE cost_basis='period_expense' AND business_date BETWEEN $1 AND $2 GROUP BY 1,2,3 ORDER BY 1,2,3`,[start,end])).rows.map(toCamel);
  const refundDays=(await db.query("SELECT business_date,COUNT(*)::int count,SUM(net_amount)::float8 amount FROM business_revenue_facts_v2 WHERE source_table='transaction_adjustments' AND business_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",[start,end])).rows.map(toCamel);
  const fingerprints=[];for(const table of ['revenue','gallery_sales','expense','transaction_adjustments','space_usage','space_payments']){const r=(await db.query(`SELECT COUNT(*)::int count,MD5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) fingerprint FROM ${table} t`)).rows[0];fingerprints.push({table,...r});}
  const id=crypto.randomUUID(),payload={schemaVersion:1,metricVersion:'operations-report-20261011',id,generatedAt:new Date().toISOString(),current:{start:current.start,end:current.end},previous:{start:previous.start,end:previous.end},context,questions:['馆内总人均收入与四项人均收入如何变化？','套票销量变化及普通票和单售咖啡的同步变化？','销量变化中客流与销量转化分别贡献多少？','毛利变化是否可计算，已知毛利和成本缺口是什么？'],methodology:['到馆=普通门票数量+套票数量；免费未登记访客未覆盖','销量转化非购买人数转化；套票咖啡权益非实际核销杯量','四项范围=套票、非饮料文创、工坊、画廊；完整馆内收入另含普通票、咖啡与饮料','未知成本不补零，部分覆盖毛利不得当完整毛利；空间独立；待归属退款不强制分配','同日与前后变化非因果；对比须考虑营业日、展览、假日、促销'],business,funnel,products,periodExpenses,refundDays,fingerprints,complete:true};
  payload.spaceAccounting={current:await require('./space-accounting').summary(db,current.start,current.end),previous:await require('./space-accounting').summary(db,previous.start,previous.end)};
  payload.metricVersion='operations-report-space-execution-20261024';
  payload.methodology.push('场地按已确认使用日期计入已执行收入；收款按到账日期进入日结，两个口径不可相加；历史旧场地款缺执行证据列为待核对；本口径为经营管理口径');
  payload.schemaVersion=3;payload.ruleVersion=metrics.RULE_VERSION;payload.metrics=metrics.calculate(payload);
  payload.weeklyReviews=await require('./report-archive').context(db,current.start,current.end);
  if((Date.parse(current.end)-Date.parse(current.start))/86400000===6&&new Date(current.start+'T12:00:00Z').getUTCDay()===1){
   const initialized=(await db.query("SELECT to_regclass('public.operations_weekly_runs') ready")).rows[0].ready;
   if(initialized)payload.managementContext=await require('./weekly-management-store').collect(db,payload);
  }
  payload.sha256=crypto.createHash('sha256').update(require("./operations-reports").canonical(payload)).digest('hex');

 return payload;
}
module.exports={collectPacket};
