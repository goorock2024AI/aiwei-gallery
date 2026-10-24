'use strict';
const crypto=require('node:crypto'),core=require('./daily-brief-core');
const validMonth=v=>typeof v==='string'&&/^(20\d{2})-(0[1-9]|1[0-2])$/.test(v);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const version=value=>core.hash(value||{});
module.exports=({pool,getRequester,ensureRole,sendJSON,sendError})=>async(req,res,q)=>{
 let db;
 try{
  const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor','viewer']))return;
  if(req.method==='GET'){
   const month=q.month||core.day(new Date()).slice(0,7);if(!validMonth(month))throw fail('月份无效');
   db=await pool.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const settings=(await db.query("SELECT key,value FROM app_config WHERE key=ANY($1::text[])",[['daily_brief_month_targets','operations_month_target_history']])).rows;
   const values=Object.fromEntries(settings.map(r=>[r.key,r.value])),targets=values.daily_brief_month_targets||{},history=values.operations_month_target_history||[];
   const today=core.day(new Date()),start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),cutoff=end<today?end:today;
   const facts=start>today?null:(await db.query('SELECT COUNT(*)::int count,COALESCE(SUM(net_amount),0)::float8 income,MAX(business_date) last_date FROM business_revenue_facts_v2 WHERE business_date BETWEEN $1 AND $2',[start,cutoff])).rows[0];
   await db.query('COMMIT');
   const actual=facts?core.money(facts.income):null,target=typeof targets[month]==='number'?targets[month]:null;
   return sendJSON(res,200,{month,targets,version:version(targets),history:history.filter(r=>r.month.startsWith(month.slice(0,4))),actual,target,completion:actual!=null&&target>0?actual/target:null,gap:actual!=null&&target!=null?core.money(target-actual):null,cutoff:start>today?null:cutoff,lastBusinessDate:facts?.last_date||null,factCount:facts?.count??null,generatedAt:new Date().toISOString(),basis:'统一收入事实，按业务日期归属；截至查询时点，未完成日结的数据可能修订',canSetTargets:user.role==='admin'});
  }
  if(req.method!=='POST')return sendError(res,405,'仅支持读取和保存月度目标');
  if(!ensureRole(res,user,['admin']))return;
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>10000)throw fail('内容过大',413);chunks.push(Buffer.from(chunk));}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('请求格式无效');}
  if(!body||body.action!=='set-target'||!validMonth(body.month)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>999999999||Math.abs(body.amount*100-Math.round(body.amount*100))>0.00001)throw fail('请输入有效月份及大于零、最多两位小数的收入目标');
  if(typeof body.version!=='string'||!/^[a-f0-9]{64}$/.test(body.version))throw fail('请先刷新目标数据');
  const reason=typeof body.reason==='string'?body.reason.trim():'';if(reason.length>1000)throw fail('调整原因过长');
  db=await pool.connect();await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['operations-month-targets']);
  const rows=(await db.query("SELECT key,value FROM app_config WHERE key=ANY($1::text[]) FOR UPDATE",[['daily_brief_month_targets','operations_month_target_history']])).rows;
  const values=Object.fromEntries(rows.map(r=>[r.key,r.value])),targets=values.daily_brief_month_targets||{},history=values.operations_month_target_history||[];
  if(version(targets)!==body.version)throw fail('目标已被其他人修改，请刷新后重新核对',409);
  const previous=targets[body.month]??null;if(previous!=null&&!reason)throw fail('调整已有目标需要填写原因');
  if(previous===body.amount)throw fail('目标金额未变化，无需保存');
  const entry={id:crypto.randomUUID(),month:body.month,previous,amount:body.amount,reason:reason||'首次设置',actor:user.id,actorName:user.display_name||user.username||user.id,createdAt:new Date().toISOString(),previousVersion:version(targets)};
  targets[body.month]=core.money(body.amount);entry.version=version(targets);history.push(entry);
  for(const [key,value] of [['daily_brief_month_targets',targets],['operations_month_target_history',history]])await db.query('INSERT INTO app_config(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',[key,JSON.stringify(value)]);
  await db.query("INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,'set_month_target','app_config',$3,$4::jsonb)",[entry.id,user.id,'daily_brief_month_targets',JSON.stringify(entry)]);
  await db.query('COMMIT');return sendJSON(res,201,{saved:true,entry,version:entry.version});
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});sendError(res,e.status||500,e.status?e.message:'经营概览暂不可用，请稍后重试');}finally{db?.release();}
};
module.exports.validMonth=validMonth;module.exports.version=version;
