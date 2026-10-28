'use strict';
const crypto=require('node:crypto'),schema=require('./app/js/space-project-schema'),booking=require('./space-booking');
const STATES=['筹备中','已确认','进行中','已完成','已取消'];
const cents=v=>Math.round(Number(v||0)*100);
function classify(r){
 const p=r.project,amount=cents(p.receivable_amount),received=cents(r.received_amount),disposed=p.status==='已取消'||['已取消','未成交'].includes(p.business_status),executionCount=Number(r.planned_count)+Number(r.confirmed_count);
 let closed=false,label='待推进';
 if(disposed){closed=received===0&&executionCount===0;label=closed?'取消／作废，收支已结清':received!==0?'已取消，收退款待核对':'已取消，使用明细待核对';}
 else if(received<0||received>amount){label='收退款待核对';}
 else if(p.status==='已完成'){
  const settled=p.rental_type==='免费'?amount===0&&received===0:amount>0&&received===amount;
  closed=settled&&Number(r.planned_count)===0;label=closed?'已完成且收款结清':Number(r.planned_count)>0?'已完成，使用明细待核对':amount<=0&&p.rental_type!=='免费'?'已完成，金额待核对':'已完成，尾款待收';
 }else if((amount>0&&received===amount)||p.rental_type==='免费')label='待完成使用／执行';
 else if(amount>received)label='待推进，仍有待收款';
 return {closed,bucket:closed?'closed':'active',label};
}
const SQL=`SELECT row_to_json(s) project,
 COALESCE(p.received,0)::float8 received_amount,COALESCE(p.count,0)::int payment_count,COALESCE(p.hash,'') payment_hash,
 COALESCE(e.planned,0)::int planned_count,COALESCE(e.confirmed,0)::int confirmed_count,COALESCE(e.hash,'') execution_hash,
 q.mode quick_mode,q.completed_at,q.start_at,q.end_at,
 l.id last_change_id,l.created_at last_change_at,l.details->>'reason' last_reason,l.details->>'disposition' disposition
 FROM space_usage s
 LEFT JOIN LATERAL (SELECT SUM(amount) received,COUNT(*) count,md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) hash FROM space_payments p WHERE p.space_usage_id=s.id) p ON true
 LEFT JOIN LATERAL (SELECT COUNT(*) FILTER(WHERE status='planned') planned,COUNT(*) FILTER(WHERE status='confirmed') confirmed,md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) hash FROM space_execution_lines e WHERE e.space_usage_id=s.id) e ON true
 LEFT JOIN space_quick_rentals q ON q.space_usage_id=s.id
 LEFT JOIN LATERAL (SELECT id,created_at,details FROM operation_logs WHERE table_name='space_usage' AND record_id=s.id AND action='space_status_update' ORDER BY created_at DESC,id DESC LIMIT 1) l ON true`;
function present(r){const p=r.project;return {id:p.id,status:p.status,businessStatus:p.business_status,projectName:p.project_name,rentalType:p.rental_type,receivableAmount:Number(p.receivable_amount||0),receivedAmount:Number(r.received_amount),paymentCount:r.payment_count,quickMode:r.quick_mode||'',plannedCount:r.planned_count,confirmedCount:r.confirmed_count,disposition:r.disposition||'',lastReason:r.last_reason||'',lastChangeAt:r.last_change_at||null,version:crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'),...classify(r)};}
module.exports={classify,present,STATES};
module.exports.handler=({pool,getRequester,ensureRole,sendJSON,sendError})=>async(req,res,q={})=>{
 let db;try{
  const user=await getRequester(req);if(!ensureRole(res,user,req.method==='GET'?['admin','editor','viewer']:['admin','editor']))return;
  if(!['GET','POST'].includes(req.method))return sendError(res,405,'仅支持查询和更正状态');db=await pool.connect();
  if(req.method==='GET'){const rows=(await db.query(SQL+(q.id?' WHERE s.id=$1':' ORDER BY s.created_at DESC'),q.id?[String(q.id)]:[])).rows;if(q.id&&!rows.length)return sendError(res,404,'项目不存在');return sendJSON(res,200,q.id?present(rows[0]):{projects:rows.map(present)});}
  let chunks=[],size=0;for await(const b of req){size+=b.length;if(size>10000)throw Error('修改说明过长');chunks.push(b);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  if(Object.keys(body).some(k=>!['status','reason','disposition','version','requestId'].includes(k)))throw Error('此入口只能更正执行状态，不能更改签约、金额或收款');
  if(!STATES.includes(body.status))throw Error('请选择执行状态；签约及收款不能在此直接修改');
  const reason=typeof body.reason==='string'?body.reason.trim():'';if(!reason||reason.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason))throw Error('请填写本次状态修改原因（最多1000字）');
  const id=String(q.id||''),requestId=String(body.requestId||'');if(!id||!/^[a-f0-9-]{36}$/i.test(requestId))throw Error('修改请求标识无效，请重新打开编辑状态');
  const disposition=body.status==='已取消'?(body.disposition||'cancel'):'';if(disposition&&!['cancel','void'].includes(disposition))throw Error('请选择取消或录错作废');
  await db.query('BEGIN');const p=(await db.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!p)throw Error('项目不存在');
  const r=(await db.query(SQL+' WHERE s.id=$1',[id])).rows[0],before=present(r);
  const prior=(await db.query('SELECT * FROM operation_logs WHERE id=$1',[requestId])).rows[0];
  if(prior){if(prior.record_id!==id||prior.user_id!==user.id||prior.action!=='space_status_update'||prior.details.status!==body.status||prior.details.reason!==reason||prior.details.disposition!==disposition)throw Error('此修改标识已被使用，请刷新核对');await db.query('COMMIT');return sendJSON(res,200,{project:before,unchanged:true});}
  if(body.version!==before.version){const e=Error('项目状态或收支已变更，请重新打开后核对');e.status=409;throw e;}
  if(disposition==='void'&&(r.payment_count>0||r.planned_count>0||r.confirmed_count>0))throw Error('已有真实收付款或使用明细，不能按录错作废；请先核对收支与执行，再按取消处理');
  if(p.status==='已完成'&&!['已完成','已取消'].includes(body.status)&&r.confirmed_count>0)throw Error('已有确认的使用收入，请先在使用与执行中核对错误明细，再更正完成状态');
  const businessStatus=body.status!=='已取消'&&['已取消','未成交'].includes(p.business_status)?(r.quick_mode?'租赁确认':'待确认'):p.business_status;
  if(['已确认','进行中'].includes(body.status)){
   if(schema.isOpportunity({...p,business_status:businessStatus}))throw Error('洽谈项目请先在工作台确认合作，不能通过编辑状态替代签约或合作确认');
   if(!p.space||!p.date||!(p.end_date||p.date))throw Error('请先补齐场地和使用日期');
   await booking.guard(db,{id,space:p.space,...await booking.range(db,p)});
  }
  const after=(await db.query('UPDATE space_usage SET status=$2,business_status=$3 WHERE id=$1 RETURNING *',[id,body.status,businessStatus])).rows[0];
  if(body.status!=='已完成'&&r.confirmed_count===0&&r.completed_at)await db.query('UPDATE space_quick_rentals SET completed_at=NULL,version=version+1,updated_by=$2,updated_at=now() WHERE space_usage_id=$1',[id,user.id]);
  await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details,created_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[requestId,user.id,'space_status_update','space_usage',id,JSON.stringify({before:p,after,status:body.status,reason,disposition,financialBefore:{receivedAmount:before.receivedAmount,paymentCount:r.payment_count,quickMode:r.quick_mode||'',plannedCount:r.planned_count,confirmedCount:r.confirmed_count},financialUnchanged:true,quickCompletionBefore:r.completed_at||null,quickCompletionCleared:body.status!=='已完成'&&r.confirmed_count===0&&!!r.completed_at})]);
  const updated=present((await db.query(SQL+' WHERE s.id=$1',[id])).rows[0]);await db.query('COMMIT');return sendJSON(res,200,{project:updated,saved:true});
 }catch(e){await db?.query('ROLLBACK').catch(()=>{});return sendError(res,e.status||(e.code==='23505'?409:400),e.code==='23505'?'修改请求已处理，请刷新核对':e.message);}finally{db?.release();}
};
