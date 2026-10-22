'use strict';
const crypto=require('node:crypto'),core=require('./daily-brief-core'),store=require('./daily-brief-store'),rules=require('./daily-brief-policy');
const {webhook,summary}=require('./daily-brief-dispatch');
const id=()=>crypto.randomUUID();
async function detail(db,date,patch){await db.query(`INSERT INTO operations_daily_followup(business_date,detail) VALUES($1,$2::jsonb) ON CONFLICT(business_date) DO UPDATE SET detail=operations_daily_followup.detail||EXCLUDED.detail,updated_at=NOW()`,[date,JSON.stringify(patch)]);}
async function incident(db,date,code,context={}){await db.query(`INSERT INTO operations_daily_incidents(id,business_date,code,detail) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(business_date,code) DO UPDATE SET detail=EXCLUDED.detail,state='open',last_seen_at=NOW(),resolved_at=NULL`,[id(),date,code,JSON.stringify({reason:code,...context,independentReminder:'待配置独立渠道，不使用经营群Webhook作为唯一报警渠道'})]);}
async function resolve(db,date,code){await db.query("UPDATE operations_daily_incidents SET state='resolved',resolved_at=NOW(),last_seen_at=NOW() WHERE business_date=$1 AND code=$2 AND state='open'",[date,code]);}
async function events(db,date,channel){return (await db.query('SELECT * FROM operations_daily_outbox WHERE business_date=$1 AND channel_hash=$2 ORDER BY created_at,id',[date,channel])).rows;}
async function enqueue(db,row,target,kind,sequence,body,comparison={},baseline=null,now=new Date()){
 return (await db.query(`INSERT INTO operations_daily_outbox(id,business_date,channel_hash,kind,sequence,brief_id,baseline_id,body,comparison,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending',$10,$10) ON CONFLICT(business_date,channel_hash,kind,sequence) DO UPDATE SET id=operations_daily_outbox.id RETURNING *`,[id(),row.business_date,target.channel,kind,sequence,row.id,baseline,body,JSON.stringify(comparison),now])).rows[0];
}
async function bootstrap(db,date,target){
 if((await events(db,date,target.channel)).some(e=>e.kind==='initial'))return;
 const old=(await db.query(`SELECT d.*,b.business_date,b.payload FROM operations_daily_dispatch d JOIN operations_daily_briefs b ON b.id=d.brief_id WHERE b.business_date=$1 AND d.channel_hash=$2 AND d.part='text' ORDER BY CASE WHEN d.state IN('uncertain','sending') THEN 0 WHEN d.state='accepted' THEN 1 ELSE 2 END,d.updated_at DESC LIMIT 1`,[date,target.channel])).rows[0];
 if(!old)return;
 const state=old.state==='sending'?'uncertain':old.state;
 await db.query(`INSERT INTO operations_daily_outbox(id,business_date,channel_hash,kind,sequence,brief_id,body,state,attempts,last_code,next_attempt_at,accepted_at,comparison) VALUES($1,$2,$3,'initial',0,$4,$5,$6,$7,$8,$9,$10,'{"legacyImport":true,"bodyReconstructed":true}'::jsonb) ON CONFLICT(business_date,channel_hash,kind,sequence) DO NOTHING`,[id(),date,target.channel,old.brief_id,summary(old.payload),state,old.attempts,'legacy:'+String(old.last_code||state),old.next_attempt_at,state==='accepted'?old.updated_at:null]);
}
async function deliver(db,event,target,{now,fetcher=fetch,clock}){
 if(event.state==='sending'){await db.query("UPDATE operations_daily_outbox SET state='uncertain',last_code='interrupted' WHERE id=$1",[event.id]);await db.query("UPDATE operations_daily_attempts SET state='uncertain',code='interrupted',completed_at=$2 WHERE outbox_id=$1 AND state='sending'",[event.id,now]);return 'uncertain';}
 if(!['pending','retry'].includes(event.state)||event.attempts>=3||event.next_attempt_at&&+new Date(event.next_attempt_at)>+now)return event.state;
 if(Buffer.byteLength(event.body)>2048){await db.query("UPDATE operations_daily_outbox SET state='failed',last_code='message_too_long' WHERE id=$1",[event.id]);return 'failed';}
 let claim;const attemptId=id();await db.query('BEGIN');
 try{claim=await db.query("UPDATE operations_daily_outbox SET state='sending',attempts=attempts+1,updated_at=$2 WHERE id=$1 AND state IN('pending','retry') RETURNING *",[event.id,now]);if(!claim.rows.length){await db.query('ROLLBACK');return 'busy';}
 await db.query("INSERT INTO operations_daily_attempts(id,outbox_id,attempt_number,started_at,state) VALUES($1,$2,$3,$4,'sending')",[attemptId,event.id,claim.rows[0].attempts,now]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
 let state='uncertain',code='network_unknown';
 try{const r=await fetcher(target.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'text',text:{content:event.body}}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.ok){const data=await r.json();code=String(data.errcode);state=data.errcode===0?'accepted':data.errcode===45009&&claim.rows[0].attempts<3?'retry':'failed';}
  else if(r.status>=400&&r.status<500){state='failed';code='http_'+r.status;}
 }catch{/* URLs can contain credentials: never store exception messages. */}
 const completedAt=clock?new Date(clock()):now;
 await db.query('BEGIN');try{
 await db.query("UPDATE operations_daily_outbox SET state=$2,last_code=$3,next_attempt_at=CASE WHEN $2='retry' THEN $4::timestamptz+interval '5 minutes' ELSE NULL END,accepted_at=CASE WHEN $2='accepted' THEN $4::timestamptz ELSE NULL END,updated_at=$4 WHERE id=$1",[event.id,state,code,completedAt]);
 await db.query('UPDATE operations_daily_attempts SET state=$2,code=$3,completed_at=$4 WHERE id=$1',[attemptId,state,code,completedAt]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
 return state;
}
function service({pool,config=process.env,now=new Date(),fetcher=fetch,archive=store,clock}){
 now=new Date(now);const getNow=clock||(()=>new Date(now));const p=rules.policy(config.DAILY_CORRECTION_POLICY||{}),target=webhook(config);
 async function check(date){
  core.validateDate(date);if(+now<=rules.at(date,'18:20'))return {state:'not_due'};
  const row=await archive.latest(pool,date);if(target)await bootstrap(pool,date,target);
  const list=target?await events(pool,date,target.channel):[];let first=list.find(e=>e.kind==='initial');
  if(first?.state==='sending'){
   await pool.query("UPDATE operations_daily_outbox SET state='uncertain',last_code='deadline_interrupted' WHERE id=$1 AND state='sending'",[first.id]);
   await pool.query("UPDATE operations_daily_attempts SET state='uncertain',code='deadline_interrupted',completed_at=$2 WHERE outbox_id=$1 AND state='sending'",[first.id,now]);
   first=(await events(pool,date,target.channel)).find(e=>e.kind==='initial');
  }
  const ok=first?.state==='accepted',code=!row?'report_missing':!target?'channel_missing':!ok?'initial_'+(first?.state||'not_attempted'):!first.accepted_at?'acceptance_time_unconfirmed':+new Date(first.accepted_at)>rules.at(date,'18:20')?'accepted_after_deadline':null;
  if(code)await incident(pool,date,'delivery_deadline',{cause:code,interfaceAccepted:ok,owner:config.DAILY_REMINDER_OWNER||'待指定负责人',outboxState:first?.state||null});else await resolve(pool,date,'delivery_deadline');
  for(const event of list.filter(e=>e.kind==='correction'&&e.state!=='accepted')){
   let state=event.state;
   if(state==='sending'&&(!rules.within(date,now)||+now-+new Date(event.updated_at)>60000)){
    await pool.query("UPDATE operations_daily_outbox SET state='uncertain',last_code='check_interrupted' WHERE id=$1 AND state='sending'",[event.id]);
    await pool.query("UPDATE operations_daily_attempts SET state='uncertain',code='check_interrupted',completed_at=$2 WHERE outbox_id=$1 AND state='sending'",[event.id,now]);state='uncertain';
   }
   if(['uncertain','failed'].includes(state)||!rules.within(date,now))await incident(pool,date,'correction_delivery_attention',{cause:!rules.within(date,now)?'window_expired_'+state:state,outboxId:event.id,owner:config.DAILY_REMINDER_OWNER||'待指定负责人'});
  }
  await detail(pool,date,{deadlineCheckedAt:now.toISOString(),interfaceAccepted:ok,memberReceipt:'未确认（接口不提供成员收讫回执）',reminderChannel:'未配置独立渠道',owner:config.DAILY_REMINDER_OWNER||'待指定负责人'});
  return {state:code?'attention':'accepted',cause:code};
 }
 async function run(date,{archiveOnly=false,initial=false}={}){
  core.validateDate(date);const db=await pool.connect(),lock='daily-followup:'+date;let acquired=false;
  try{acquired=(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) ok',[lock])).rows[0].ok;if(!acquired)return {state:'busy'};
   if(!archiveOnly&&!initial&&!rules.within(date,now)){await detail(db,date,{reviewState:'窗口已截止，后续变更需人工复核',lastCheckedAt:now.toISOString()});return {state:'outside_window'};}
   let row;try{row=await archive.generate(pool,date,{now:now.toISOString(),actor:'service:daily-followup'});await resolve(db,date,'generation_failed');}
   catch{await incident(db,date,'generation_failed',{reason:'generation_or_archive_failed',checkedAt:now.toISOString()});throw Error('日报生成或归档失败');}
   await detail(db,date,{latestBriefId:row.id,revision:row.revision,finalized:row.payload.finalized,lastCheckedAt:now.toISOString(),cutoffTime:row.payload.cutoffTime,inventoryClosingMismatch:row.payload.coffee?.config?.closeHour!==undefined&&row.payload.coffee.config.closeHour!==17.5});
   if(archiveOnly)return {state:'archive_only',id:row.id};
   // Generation may be slow: re-check the real clock before claiming any external send.
   now=new Date(getNow());
   if(!target){await incident(db,date,'channel_missing');return {state:'channel_missing'};}
   await bootstrap(db,date,target);let list=await events(db,date,target.channel),first=list.find(e=>e.kind==='initial');
   if(initial&&date===core.day(now)&&+now>=rules.at(date,'18:00')&&+now<=rules.at(date,'18:20')&&config.DAILY_SEND_ENABLED==='true'){
    first=first||await enqueue(db,row,target,'initial',0,summary(row.payload),{},null,now);
    const result=await deliver(db,first,target,{now,fetcher,clock:getNow});
    await detail(db,date,{initialState:result,interfaceAccepted:result==='accepted',memberReceipt:'未确认（仅确认接口接受）'});
    if(['failed','uncertain'].includes(result))await incident(db,date,'initial_delivery_attention',{cause:result});
    // A new revision never causes a second full initial report.
    return {state:result,kind:'initial',id:first.id};
   }
   if(!rules.within(date,now)||!first||first.state!=='accepted')return {state:'archive_updated'};
   list=await events(db,date,target.channel);
   const unresolved=list.find(e=>e.kind==='correction'&&e.state!=='accepted');
   if(unresolved){const result=config.DAILY_SEND_ENABLED==='true'?await deliver(db,unresolved,target,{now,fetcher,clock:getNow}):'disabled';if(['failed','uncertain'].includes(result))await incident(db,date,'correction_delivery_attention',{cause:result,outboxId:unresolved.id});return {state:result,kind:'correction'};}
   const accepted=list.filter(e=>e.state==='accepted').sort((a,b)=>(b.kind==='correction'?b.sequence+1:0)-(a.kind==='correction'?a.sequence+1:0));
   const baseline=(await db.query('SELECT * FROM operations_daily_briefs WHERE id=$1',[accepted[0].brief_id])).rows[0];
   const diff=rules.compare(baseline.payload,row.payload,p);
   if(!diff.important){await detail(db,date,{reviewState:'仅更新档案',pending:null,archiveChanges:diff.changes});return {state:'archive_only'};}
   const state=(await db.query('SELECT detail FROM operations_daily_followup WHERE business_date=$1',[date])).rows[0]?.detail||{};
   let pending=state.pending;
   if(!pending)pending={since:now.toISOString(),lastChange:now.toISOString(),signature:diff.signature};
   else if(pending.signature!==diff.signature)pending={...pending,lastChange:now.toISOString(),signature:diff.signature};
   await detail(db,date,{pending,reviewState:p.approved?'更正合并等待':'更正阈值待批准',proposedChanges:diff.changes});
   if(!p.approved||config.DAILY_SEND_ENABLED!=='true')return {state:'policy_pending'};
   const count=list.filter(e=>e.kind==='correction').length;if(count>=p.maxCorrections){await incident(db,date,'correction_limit',{limit:p.maxCorrections});return {state:'limit_reached'};}
   if(+now-+new Date(pending.lastChange)<p.mergeMinutes*60000&&+now-+new Date(pending.since)<p.maxMergeMinutes*60000)return {state:'merging'};
   const supplied=row.payload.metrics.background?.correctionReason;
   const reason=typeof supplied==='string'&&supplied.trim()?supplied.trim().replace(/[\r\n]/g,' ').slice(0,120):diff.changes.every(c=>c.item==='日结状态')?'日结状态更新。':null;
   const e=await enqueue(db,row,target,'correction',count+1,rules.correction(date,diff,now,reason),diff,baseline.id,now);
   const result=await deliver(db,e,target,{now,fetcher,clock:getNow});await detail(db,date,{pending:null,reviewState:result==='accepted'?'更正已由接口接受':'更正需处理'});
   if(['failed','uncertain'].includes(result))await incident(db,date,'correction_delivery_attention',{cause:result,outboxId:e.id});return {state:result,kind:'correction',id:e.id};
  }finally{if(acquired)await db.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]);db.release();}
 }
 return {run,check};
}
module.exports={service,detail,incident,events,bootstrap,deliver};
