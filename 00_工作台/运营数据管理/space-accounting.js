'use strict';
const crypto=require('node:crypto');
const {isOpportunity}=require('./app/js/space-project-schema');
const BASIS='space-execution-20261024';
const money=n=>Math.round(Number(n)*100)/100;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function date(v){const d=new Date(String(v)+'T00:00:00Z');if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw Error('日期无效');return v;}
function cents(n){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>999999999||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('金额须为非负数，最多两位小数');return Math.round(n*100);}
function split(start,end,amount){date(start);date(end);const days=(Date.parse(end)-Date.parse(start))/86400000+1,total=cents(amount);if(days<1||days>366)throw Error('连续分摊范围须在366天内');return Array.from({length:days},(_,i)=>({date:new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),amount:(Math.floor(total/days)+(i<total%days?1:0))/100}));}
async function summary(db,start,end){
 date(start);date(end);if(end<start)throw Error('结束日期不能早于开始日期');
 const projects=(await db.query(`SELECT s.id,s.project_name,s.receivable_amount,s.rental_type,s.status,s.business_status,
 COALESCE((SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id=s.id AND p.payment_date BETWEEN $1 AND $2),0)::float8 receipts,
 COALESCE((SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id=s.id AND p.payment_date<=$2),0)::float8 received,
 COALESCE((SELECT SUM(amount) FROM space_execution_lines e WHERE e.space_usage_id=s.id AND e.status='confirmed' AND e.usage_date BETWEEN $1 AND $2),0)::float8 executed,
 COALESCE((SELECT SUM(amount) FROM space_execution_lines e WHERE e.space_usage_id=s.id AND e.status='confirmed' AND e.usage_date<=$2),0)::float8 earned,
 COALESCE((SELECT SUM(amount) FROM space_execution_lines e WHERE e.space_usage_id=s.id AND e.status<>'voided'),0)::float8 allocated,
 (SELECT COUNT(*)::int FROM space_execution_lines e WHERE e.space_usage_id=s.id AND e.status='planned' AND e.usage_date<=$2) pending_days
 FROM space_usage s WHERE s.rental_type='付费'`,[start,end])).rows;
 const result={basis:BASIS,start,end,receipts:0,executed:0,receivedUnexecuted:0,executedUnpaid:0,unallocatedContract:0,pendingDays:0,projects:[]};
 for(const p of projects){const cancelled=p.status==='已取消'||p.business_status==='已取消'||isOpportunity(p);const r={id:p.id,projectName:p.project_name,contract:money(p.receivable_amount),receipts:p.receipts,executed:p.executed,received:p.received,earned:p.earned,receivedUnexecuted:money(Math.max(0,p.received-p.earned)),executedUnpaid:money(Math.max(0,p.earned-p.received)),unallocatedContract:cancelled?0:money(Math.max(0,Number(p.receivable_amount)-p.allocated)),pendingDays:p.pending_days};result.projects.push(r);for(const k of ['receipts','executed','receivedUnexecuted','executedUnpaid','unallocatedContract','pendingDays'])result[k]=money(result[k]+r[k]);}
 const legacy=(await db.query(`SELECT COUNT(*)::int count,COALESCE(SUM(venue_amount),0)::float8 amount FROM revenue WHERE date BETWEEN $1 AND $2 AND COALESCE(status,'')<>'已作废' AND COALESCE(venue_amount,0)<>0`,[start,end])).rows[0];
 result.legacyUnverified={count:legacy.count,amount:money(legacy.amount)};
 return result;
}
async function guardProject(db,project){
 const received=Number((await db.query('SELECT COALESCE(SUM(amount),0) amount FROM space_payments WHERE space_usage_id=$1',[project.id])).rows[0].amount);
 if(Number(project.receivable_amount)<received)throw Error('合同金额不能低于净收款，请先核对退款');
 const lines=(await db.query("SELECT usage_date,amount,status FROM space_execution_lines WHERE space_usage_id=$1 AND status<>'voided'",[project.id])).rows;
 if(!lines.length)return;
 if(project.rental_type!=='付费')throw Error('已有执行明细的付费订单不能改为免费，请先核对并作废明细');
 if(lines.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)>Math.round(project.receivable_amount*100))throw Error('合同金额不能低于已安排的执行金额');
 if(lines.some(r=>r.usage_date<project.date||r.usage_date>project.end_date))throw Error('项目日期须覆盖已有使用明细，改期请先作废原明细');
 if((project.status==='已取消'||project.business_status==='已取消')&&lines.some(r=>r.status==='planned'))throw Error('取消订单前请先作废待执行明细；已执行记录继续保留');
 const earned=(await db.query("SELECT 1 FROM space_execution_lines WHERE space_usage_id=$1 AND status='confirmed' LIMIT 1",[project.id])).rowCount;
 if(earned&&['space_rental','brand_event','uncategorized_revenue'].includes(project.business_type_code)===false)throw Error('已执行订单业务类型无效');
}
module.exports={BASIS,date,split,summary,guardProject};
module.exports.handler=({pool,getRequester,ensureRole,sendJSON,sendError,toCamel})=>async(req,res,q)=>{
 let db;
 try{
  const user=await getRequester(req);if(!ensureRole(res,user,req.method==='GET'?['admin','editor','viewer']:['admin','editor']))return;
  if(!['GET','POST'].includes(req.method))return sendError(res,405,'仅支持查看、安排和确认执行');
  db=await pool.connect();
  if(req.method==='GET'){
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const end=q.end||today(),start=q.start||end.slice(0,7)+'-01';date(start);date(end);if(end>today())throw Error('统计截止日期不能晚于今天');
   const totals=await summary(db,start,end);
   const lines=q.id?(await db.query('SELECT * FROM space_execution_lines WHERE space_usage_id=$1 ORDER BY usage_date,created_at',[q.id])).rows.map(toCamel):[];
   await db.query('COMMIT');return sendJSON(res,200,{...totals,lines});
  }
  let buffers=[],size=0;for await(const b of req){size+=b.length;if(size>131072)throw Error('请求内容过大');buffers.push(Buffer.from(b));}
  const body=JSON.parse(Buffer.concat(buffers).toString('utf8'));
  if(!['schedule','confirm','void','refund'].includes(body.action))throw Error('操作无效');
  await db.query('BEGIN');
  const project=(await db.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE',[q.id])).rows[0];if(!project)throw Error('场地订单不存在');
  let before=null,after;
  if(body.action==='refund'){
   if(user.role!=='admin'){await db.query('ROLLBACK');return sendError(res,403,'仅管理员可登记退款');}
   date(body.date);if(body.date>today())throw Error('实际退款日期不能晚于今天');
   const amount=cents(body.amount);if(amount<=0)throw Error('退款金额必须大于零');
   const reason=typeof body.reason==='string'?body.reason.trim():'';if(!reason||reason.length>500)throw Error('请填写退款原因（最多500字）');
   before=(await db.query('SELECT * FROM space_payments WHERE id=$1 AND space_usage_id=$2 FOR UPDATE',[body.paymentId,project.id])).rows[0];
   if(!before||Number(before.amount)<=0)throw Error('原收款记录不存在');if(body.date<before.payment_date)throw Error('退款日期不能早于原到账日期');
   const refunded=Number((await db.query('SELECT COALESCE(-SUM(p.amount),0) amount FROM space_payment_refunds r JOIN space_payments p ON p.id=r.refund_payment_id WHERE r.original_payment_id=$1',[before.id])).rows[0].amount);
   if(amount>Math.round((Number(before.amount)-refunded)*100))throw Error('退款不能超过原收款尚未退还的金额');
   const id=String(body.refundId||'');if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('退款请求标识无效，请刷新后重试');
   const existing=(await db.query('SELECT * FROM space_payment_refunds WHERE id=$1',[id])).rows[0];
   if(existing)throw Error('此退款请求已经登记，请刷新核对，勿重复退款');
   after=(await db.query('INSERT INTO space_payments(id,space_usage_id,payment_date,amount,payment_method,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,project.id,body.date,-amount/100,before.payment_method,'退款：'+reason])).rows[0];
   await db.query('INSERT INTO space_payment_refunds(id,original_payment_id,refund_payment_id,reason,operator_id) VALUES($1,$2,$1,$3,$4)',[id,before.id,reason,user.id]);
   if(before.payment_method==='现金')await db.query("INSERT INTO cash_movements(id,date,type,amount,source_type,source_id,operator_id,operator_name,reason,notes) VALUES($1,$2,'cash_refund',$3,'space',$4,$5,$6,$7,'由场地实际退款事务生成')",['cash_space_'+id,body.date,-amount/100,id,user.id,user.display_name||user.username||'',reason]);
  }else if(body.action==='schedule'){
   if(isOpportunity(project)||project.rental_type!=='付费'||project.status==='已取消'||project.business_status==='已取消')throw Error('只能为有效付费订单安排执行');
   const lines=body.mode==='continuous'?split(body.start,body.end,body.amount):body.lines;
   if(!Array.isArray(lines)||!lines.length||lines.length>366)throw Error('请填写1至366条使用明细');
   const keys=new Set();let total=0;for(const line of lines){date(line.date);total+=cents(line.amount);if(line.date<project.date||line.date>(project.end_date||project.date))throw Error('使用日期须在项目起止日期内');if(keys.has(line.date))throw Error('使用日期不能重复');keys.add(line.date);}
   const allocated=Number((await db.query("SELECT COALESCE(SUM(amount),0) amount FROM space_execution_lines WHERE space_usage_id=$1 AND status<>'voided'",[project.id])).rows[0].amount);
   if(Math.round(allocated*100)+total>Math.round(Number(project.receivable_amount)*100))throw Error('使用明细金额合计不能超过合同金额');
   after=[];for(const line of lines)after.push((await db.query('INSERT INTO space_execution_lines(id,space_usage_id,usage_date,amount,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[crypto.randomUUID(),project.id,line.date,line.amount,String(body.notes||'').slice(0,500)])).rows[0]);
  }else{
   before=(await db.query('SELECT * FROM space_execution_lines WHERE id=$1 AND space_usage_id=$2 FOR UPDATE',[body.lineId,project.id])).rows[0];if(!before)throw Error('使用明细不存在');
   if(body.action==='confirm'){
    if(before.status==='confirmed'){await db.query('COMMIT');return sendJSON(res,200,{line:toCamel(before),unchanged:true});}
    if(isOpportunity(project)||before.status!=='planned'||project.rental_type!=='付费'||project.status==='已取消'||project.business_status==='已取消')throw Error('只有有效订单的待执行明细可以确认');
    if(before.usage_date>today())throw Error('未来日期不能提前确认为已执行');
    after=(await db.query("UPDATE space_execution_lines SET status='confirmed',confirmed_by=$2,confirmed_at=now() WHERE id=$1 RETURNING *",[before.id,user.id])).rows[0];
   }else{
    if(before.status==='voided')throw Error('此明细已经作废');
    if(before.status==='confirmed'&&user.role!=='admin')return await db.query('ROLLBACK').then(()=>sendError(res,403,'已执行明细仅管理员可作废'));
    const reason=typeof body.reason==='string'?body.reason.trim():'';if(!reason||reason.length>500)throw Error('请填写作废或改期原因（最多500字）');
    after=(await db.query("UPDATE space_execution_lines SET status='voided',void_reason=$2,voided_by=$3,voided_at=now() WHERE id=$1 RETURNING *",[before.id,reason,user.id])).rows[0];
   }
  }
  await db.query("INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,'space_execution_lines',$4,$5::jsonb)",[crypto.randomUUID(),user.id,'space_'+body.action,project.id,JSON.stringify({basis:BASIS,before,after})]);
  await db.query('COMMIT');return sendJSON(res,201,{saved:true,lines:(Array.isArray(after)?after:[after]).map(toCamel)});
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});return sendError(res,e.code==='23505'?409:400,e.code==='23505'?'该使用日期已有有效明细，请先核对或作废原记录':e.message);}finally{db?.release();}
};
