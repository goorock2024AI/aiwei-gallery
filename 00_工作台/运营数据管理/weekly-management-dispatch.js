'use strict';
const crypto=require('node:crypto'),core=require('./daily-brief-core'),domain=require('./weekly-management');
const uuid=()=>crypto.randomUUID();
const meaning=r=>core.hash({summary:r.summary,judgments:r.content.management.judgments,actions:r.content.management.actions,forecast:r.content.management.forecast,currentTarget:r.content.management.currentTarget,nextTarget:r.content.management.nextTarget,monthGoals:r.content.management.monthGoals,monthAllocations:r.content.management.monthAllocations});
function target(config){return require('./daily-brief-dispatch').webhook({DAILY_WECOM_WEBHOOK:config.WEEKLY_WECOM_WEBHOOK||(config.WEEKLY_USE_DAILY_CHANNEL==='true'?config.DAILY_WECOM_WEBHOOK:null)});}
async function enqueue(db,report){
 const m=report.content.management;if(!m)return null;
 const existing=(await db.query('SELECT * FROM operations_weekly_outbox WHERE report_id=$1',[report.id])).rows[0];if(existing)return existing;
 const list=(await db.query('SELECT o.*,r.summary,r.content FROM operations_weekly_outbox o JOIN operations_analysis_reports r ON r.id=o.report_id WHERE o.start_date=$1 ORDER BY o.created_at,o.id',[report.startDate])).rows;
 const first=list.find(r=>r.kind==='initial'&&r.state!=='suppressed');
 let kind=first?'correction':'initial',state='pending',reason=m.correctionReason;
 if(list.some(r=>r.state!=='suppressed'&&meaning(r)===meaning(report)))state='suppressed';
 else if(first&&first.attempts===0&&first.state==='pending'){
  await db.query("UPDATE operations_weekly_outbox SET state='suppressed',last_code='replaced_before_send' WHERE id=$1",[first.id]);kind='initial';
 }else if(first&&(!m.importantCorrection||!report.content.supersedes))state='suppressed';
 const id=uuid();return (await db.query('INSERT INTO operations_weekly_outbox(id,start_date,report_id,kind,body,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(report_id) DO UPDATE SET id=operations_weekly_outbox.id RETURNING *',[id,report.startDate,report.id,kind,domain.summary(report,{correction:kind==='correction',reason}),state])).rows[0];
}
async function dispatch(pool,eventId,{config=process.env,fetcher=fetch,now=new Date(),actor='service:weekly-summary',retry=false}={}){
 if(config.WEEKLY_SEND_ENABLED!=='true')return {state:'disabled'};
 const channel=target(config);if(!channel)return {state:'channel_missing'};
 const db=await pool.connect();let lock;
 try{
  let event=(await db.query('SELECT * FROM operations_weekly_outbox WHERE id=$1',[eventId])).rows[0];if(!event)throw Object.assign(Error('摘要待办不存在'),{status:404});
  lock='weekly-dispatch:'+event.start_date;if(!(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) ok',[lock])).rows[0].ok){lock=null;return {state:'busy'};}
  event=(await db.query('SELECT * FROM operations_weekly_outbox WHERE id=$1',[eventId])).rows[0];
  if(event.state==='sending'){
   await db.query("UPDATE operations_weekly_outbox SET state='uncertain',last_code='interrupted',updated_at=$2 WHERE id=$1",[event.id,now]);
   await db.query("UPDATE operations_weekly_attempts SET state='uncertain',code='interrupted',completed_at=$2 WHERE outbox_id=$1 AND state='sending'",[event.id,now]);return {state:'uncertain'};
  }
  const blocked=(await db.query("SELECT id FROM operations_weekly_outbox WHERE start_date=$1 AND state IN('sending','uncertain')",[event.start_date])).rows;
  if(blocked.length)return {state:'uncertain',reason:'先人工核实该周投递，禁止盲目补发'};
  if(event.channel_hash&&event.channel_hash!==channel.channel)return {state:'channel_changed',reason:'原投递渠道已锁定，不能自动换群重发'};
  if(event.kind==='correction'&&!(await db.query("SELECT id FROM operations_weekly_outbox WHERE start_date=$1 AND kind='initial' AND state='accepted'",[event.start_date])).rows.length)return {state:'waiting_initial'};
  if(event.kind==='correction'&&(await db.query("SELECT id FROM operations_weekly_outbox WHERE start_date=$1 AND id<>$2 AND created_at<$3 AND state IN('pending','retry','failed')",[event.start_date,event.id,event.created_at])).rows.length)return {state:'waiting_prior',reason:'先处理较早的摘要投递，避免乱序更正'};
  if(event.state==='failed'&&!retry||!['pending','retry','failed'].includes(event.state)||event.attempts>=3)return {state:event.state};
  if(event.next_attempt_at&&+new Date(event.next_attempt_at)>+now)return {state:'backoff'};
  const attempt=uuid();await db.query('BEGIN');
  try{event=(await db.query("UPDATE operations_weekly_outbox SET state='sending',attempts=attempts+1,channel_hash=$2,updated_at=$3 WHERE id=$1 AND state IN('pending','retry','failed') RETURNING *",[event.id,channel.channel,now])).rows[0];
   await db.query("INSERT INTO operations_weekly_attempts(id,outbox_id,attempt_number,state,actor,started_at) VALUES($1,$2,$3,'sending',$4,$5)",[attempt,event.id,event.attempts,actor,now]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
  let state='uncertain',code='network_unknown';
  try{const response=await fetcher(channel.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'text',text:{content:event.body}}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(response.ok){const result=await response.json();if(typeof result.errcode==='number'){code=String(result.errcode);state=result.errcode===0?'accepted':result.errcode===45009&&event.attempts<3?'retry':'failed';}else code='response_unknown';}
   else if(response.status>=400&&response.status<500){state='failed';code='http_'+response.status;}
  }catch{/* Deliberately do not log webhook URLs, response bodies or exception text. */}
  await db.query('BEGIN');try{
   await db.query("UPDATE operations_weekly_outbox SET state=$2,last_code=$3,next_attempt_at=CASE WHEN $2='retry' THEN $4::timestamptz+interval '5 minutes' ELSE NULL END,accepted_at=CASE WHEN $2='accepted' THEN $4 ELSE NULL END,updated_at=$4 WHERE id=$1",[event.id,state,code,now]);
   await db.query('UPDATE operations_weekly_attempts SET state=$2,code=$3,completed_at=$4 WHERE id=$1',[attempt,state,code,now]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
  return {state,interfaceAccepted:state==='accepted',memberReceipt:'未确认（接口接受不代表群成员实际收到）'};
 }finally{if(lock)await db.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]);db.release();}
}
module.exports={target,enqueue,dispatch};
