'use strict';
const crypto=require('node:crypto'),coffee=require('./coffee-forecast');
const day=coffee.dateKey,add=coffee.addDays;
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
const money=n=>Math.round((Number(n)||0)*100)/100;
function validateDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw Error('日期无效');return v;}
function income(period){return money(Object.values(period.types).reduce((n,r)=>n+r.income,0));}
const names={ticket:'普通门票',visit_combo:'咖啡套票',coffee:'单售咖啡',beverage_retail:'饮料',creative_retail:'文创零售',workshop:'工坊',gallery_sale:'画廊',space_rental:'场地租赁'};
function summarize(finance){
 const current=finance.day.metrics.current,previous=finance.day.metrics.previous,total=income(current),before=income(previous);
 return {income:total,previousIncome:before,changeAmount:money(total-before),changeRate:before>0?(total-before)/before:null,
 previousVisitors:previous.visitors.value,visitorChangeAmount:current.visitors.value==null||previous.visitors.value==null?null:current.visitors.value-previous.visitors.value,visitorChangeRate:current.visitors.value!=null&&previous.visitors.value>0?(current.visitors.value-previous.visitors.value)/previous.visitors.value:null,
 visitors:current.visitors.value,recordedVisitors:current.visitors.recorded,monthIncome:income(finance.month.metrics.current),
 target:finance.target??null,targetProgress:finance.target>0?income(finance.month.metrics.current)/finance.target:null,
 expenses:money((finance.day.periodExpenses||[]).filter(r=>r.businessDate===finance.date).reduce((n,r)=>n+r.amount,0)),
 businesses:[...new Set([...Object.keys(current.types),...Object.keys(previous.types)])].map(code=>{const r=current.types[code];return {code,name:names[code]||code,income:money(r?.income??0),previousIncome:money(previous.types[code]?.income??0),quantity:r?.missingQuantityFacts?null:r?.quantity??0};}),
 spaceAccounting:finance.day.spaceAccounting?.current||null,
 paymentReminders:finance.paymentReminders||[],
 closing:finance.closing,background:finance.background||{},alerts:finance.day.metrics.quality.alerts};
}
function fallback(snapshot){
 const template=require('./daily-brief-template'),review=template.review(snapshot);
 if(template.isClosed(snapshot))return {mode:'basic',review,tomorrow:'',actions:[]};
 const actions=[];
 if(snapshot.coffee?.status==='setup')actions.push('完成咖啡豆首次盘点与库存初始化。');
 else if(snapshot.coffee?.suggestedGrams>0)actions.push('查看库存模块的采购建议及在途状态，确认备料安排。');
 if(snapshot.weather.status!=='ok')actions.push('补充天气资料；本期不依据缺失天气解释经营变化。');
 return {mode:'basic',review,tomorrow:'明日安排以已记录的经营背景、天气预报和库存提示为依据；未取得的活动安排不作推断。',actions:actions.slice(0,3)};
}
async function fingerprint(db,date){
 const result=await db.query(`SELECT 'income' kind,COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text)),'empty') value FROM business_revenue_facts_v2 t WHERE (business_date BETWEEN $2 AND $1 OR business_date=$3)
 UNION ALL SELECT 'cost',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text)),'empty') FROM business_cost_facts_v2 t WHERE (business_date BETWEEN $2 AND $1 OR business_date=$3)
 UNION ALL SELECT 'closing',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text)),'empty') FROM daily_closings t WHERE date=$1
 UNION ALL SELECT 'space_orders',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)),'empty') FROM space_usage t
 UNION ALL SELECT 'space_receipts',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)),'empty') FROM space_payments t WHERE payment_date<=$1
 UNION ALL SELECT 'space_execution',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)),'empty') FROM space_execution_lines t
 UNION ALL SELECT 'legacy_space',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)),'empty') FROM revenue t WHERE COALESCE(venue_amount,0)<>0 AND (date BETWEEN $2 AND $1 OR date=$3)
 UNION ALL SELECT 'context',COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text)),'empty') FROM app_config t WHERE key=ANY($4::text[])`,[date,date.slice(0,7)+'-01',add(date,-7),['daily_brief_month_targets','daily_brief:'+date]]);
 return hash(result.rows);
}
async function collect(db,date,now=new Date().toISOString()){
 validateDate(date);if(date>day(now))throw Error('不能生成未来日报');
 const {collectPacket}=require('./operations-report-packet');
 const earlier=add(date,-7),month=date.slice(0,7)+'-01',priorEnd=add(month,-1),priorStart=priorEnd.slice(0,7)+'-01';
 const packet=await collectPacket(db,{start:date,end:date},{start:earlier,end:earlier},'经营日报，上周同日比较');
 const monthPacket=await collectPacket(db,{start:month,end:date},{start:priorStart,end:priorEnd},'自然月累计，不累加日报');
 const closing=(await db.query('SELECT status FROM daily_closings WHERE date=$1 ORDER BY updated_at DESC,id DESC',[date])).rows;
 const settings=(await db.query("SELECT key,value FROM app_config WHERE key=ANY($1::text[])",[['daily_brief_month_targets','daily_brief:'+date]])).rows;
 const values=Object.fromEntries(settings.map(r=>[r.key,r.value]));
 const paymentProjects=(await db.query(`SELECT s.id,s.project_name,s.status,s.business_status,s.expected_payment_date,s.receivable_amount,
 COALESCE((SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id=s.id AND p.payment_date<=$1),0)::float8 received
 FROM space_usage s WHERE s.rental_type='付费'`,[date])).rows;
 const paymentReminders=duePayments(paymentProjects,date);
 const finance={date,day:packet,month:monthPacket,closing:closing.map(r=>r.status),target:values.daily_brief_month_targets?.[date.slice(0,7)]??null,background:values['daily_brief:'+date]||{},paymentReminders};
 const state=(await db.query("SELECT version,payload FROM coffee_inventory_state WHERE id='coffee'")).rows[0];let inventory=null;
 // Historical generation must never substitute today's stock for a past day's stock.
 if(state&&date===day(now)){const since=state.payload.anchor?.date&&state.payload.anchor.date<add(date,-168)?state.payload.anchor.date:add(date,-168);const rows=(await db.query('SELECT id,date,coffee_qty,combo_qty,coffee_items,status FROM revenue WHERE date>=$1 AND date<=$2 ORDER BY date,created_at,id',[since,date])).rows;inventory={...coffee.forecast(state.payload,rows,now),stateVersion:state.version};}
 return {finance,coffee:inventory,sourceHash:await fingerprint(db,date)};
}
function assemble(collected,date,now,weather,previous){
 const metrics=summarize(collected.finance),closing=metrics.closing;
 if(date===day(now))previous=null;
 const finalized=closing.length>0&&closing.every(s=>['已确认','已复核','已结账','已日结','已完成'].includes(s));
 const snapshot={schemaVersion:1,templateVersion:require('./daily-brief-template').version,date,generatedAt:now,cutoffTime:now,closeTime:'17:30',sourceHash:collected.sourceHash,
 finalized,metrics,finance:collected.finance,weather:previous?.weather||weather,coffee:previous?.coffee??collected.coffee,
 quality:{dayClosingComplete:finalized,weatherMissing:(previous?.weather||weather).status!=='ok',historicalStockUnavailable:!previous&&date!==day(now)}};
 snapshot.analysis=fallback(snapshot);return snapshot;
}
function duePayments(projects,date){
 const {isOpportunity}=require('./app/js/space-project-schema');
 return projects.filter(p=>p.status!=='已取消'&&p.business_status!=='已取消'&&!isOpportunity(p)).flatMap(p=>{
  const due=p.expected_payment_date,remaining=money(Number(p.receivable_amount)-Number(p.received));
  if(!remaining||remaining<0||!/^\d{4}-\d{2}-\d{2}$/.test(due||'')||due>add(date,1))return [];
  try{validateDate(due);}catch{return [];}
  return [{projectName:p.project_name,dueDate:due,remaining,timing:due>date?'tomorrow':due===date?'today':'overdue',overdueDays:Math.max(0,Math.round((Date.parse(date)-Date.parse(due))/86400000))}];
 }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.projectName.localeCompare(b.projectName));
}
module.exports={day,add,validateDate,canonical,hash,money,income,summarize,fingerprint,collect,assemble,fallback,duePayments};
