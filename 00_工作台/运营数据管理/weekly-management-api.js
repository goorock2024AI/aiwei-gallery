'use strict';
const crypto=require('node:crypto'),core=require('./daily-brief-core'),domain=require('./weekly-management'),store=require('./weekly-management-store');
module.exports=({pool,getRequester,ensureRole,sendJSON,sendError})=>async(req,res,q)=>{
 let db;
 try{
  const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor']))return;
  const config=require('./weekly-management-config').read();
  if(req.method==='GET'){
   const start=domain.week(q.start).start;
   const runs=(await pool.query('SELECT w.*,p.payload,p.sha256 FROM operations_weekly_runs w JOIN operations_analysis_packets p ON p.id=w.packet_id WHERE w.start_date=$1 ORDER BY w.created_at DESC,w.id DESC LIMIT 20',[start])).rows;
   const delivery=(await pool.query('SELECT id,report_id,kind,state,attempts,next_attempt_at,last_code,accepted_at,created_at FROM operations_weekly_outbox WHERE start_date=$1 ORDER BY created_at,id',[start])).rows;
   const attempts=(await pool.query('SELECT a.outbox_id,a.attempt_number,a.state,a.code,a.actor,a.started_at,a.completed_at FROM operations_weekly_attempts a JOIN operations_weekly_outbox o ON o.id=a.outbox_id WHERE o.start_date=$1 ORDER BY a.started_at',[start])).rows;
   const prior=(await pool.query("SELECT r.id,r.content->'actions' actions FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE r.content->>'reportType'='weekly' AND p.end_date=$1 AND NOT EXISTS(SELECT 1 FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id)",[core.add(start,-1)])).rows;
   for(const r of prior){r.feedback=[];for(let i=0;i<r.actions.length&&i<3;i++){const f=await store.actionFeedback(pool,r.id,i);if(f)r.feedback.push({...f,action_index:i});}}
   const todos=runs.length?[...runs[0].payload.managementContext.todos]:['尚未准备本周资料'];
   if(runs[0]?.state==='prepared')todos.push('待Agent撰写经营分析（14:00节点；尚未自动接入Agent执行器）');
   if(runs[0]?.state==='analyzed')todos.push('待管理员复核（15:00节点）');
   if(runs[0]?.state==='reviewed')todos.push('待管理员正式发布（16:00节点）');
   const missed=(await pool.query("SELECT detail FROM operations_weekly_events WHERE kind='cutoff_missed' AND detail->>'start'=$1 LIMIT 1",[start])).rows[0];
   if(!runs.length&&missed)todos.push('12:00截止快照未取得，不能倒填；请管理员决定按实际截止重新准备');
   return sendJSON(res,200,{operatorInput:await store.operatorInput(pool,start),runs,previous:prior,delivery,attempts,schedule:{timezone:'Asia/Shanghai',approved:true,cutoff:'周一12:00',prepare:'13:00',agent:'14:00',review:'15:00',publish:'16:00',enabled:config.WEEKLY_PREPARE_ENABLED==='true',owner:'管理员'},sendEnabled:config.WEEKLY_SEND_ENABLED==='true',channel:'与经营日报相同的内部群（启用前核对服务器配置）',memberReceipt:'接口接受不代表成员收到',todos});
  }
  if(req.method!=='POST')return sendError(res,405,'不支持该操作');
  const chunks=[];let bytes=0;for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>200000)throw Object.assign(Error('内容过大'),{status:413});chunks.push(buffer);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(['send','retry'].includes(body.action)){
   if(!ensureRole(res,user,['admin']))return;
   const result=await require('./weekly-management-dispatch').dispatch(pool,body.id,{config,actor:user.id,retry:body.action==='retry'});return sendJSON(res,200,result);
  }
  db=await pool.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  if(body.action==='submit-input'){
   req.weeklySubmission=body;
   const range=domain.week(body.start);if(range.end>=core.day(new Date()))throw Object.assign(Error('请在该周结束后提交'),{status:400});
   if(typeof body.text!=='string'||body.text.length>6000)throw Object.assign(Error('补充内容最多6000字'),{status:400});
   if(typeof body.requestId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)))throw Object.assign(Error('提交标识无效'),{status:400});
   const existing=await store.submittedInput(db,body.requestId,body.start,body.text);if(existing){await db.query('COMMIT');return sendJSON(res,200,existing);}
   const detail={start:body.start,text:body.text,textHash:core.hash({text:body.text})};
   await db.query("INSERT INTO operations_weekly_events(id,run_id,kind,actor,detail) VALUES($1,NULL,'operator_input',$2,$3::jsonb)",[body.requestId,user.id,JSON.stringify(detail)]);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['weekly-prepare:'+body.start]);
   const result=await store.prepare(db,body.start,user.id);await store.event(db,result.id,'input_submitted',user.id,{requestId:body.requestId,start:body.start,textHash:detail.textHash});
   await db.query('COMMIT');return sendJSON(res,201,result);
  }
  if(body.action==='feedback'){
   if(!Number.isInteger(body.index)||body.index<0||body.index>2)throw Object.assign(Error('行动序号无效'),{status:400});
   const report=(await db.query("SELECT content FROM operations_analysis_reports WHERE id=$1 AND content->>'reportType'='weekly'",[body.reportId])).rows[0];
   if(!report?.content.actions[body.index])throw Object.assign(Error('行动不存在'),{status:404});
   const detail=domain.feedback(body),id=crypto.randomUUID();await db.query('INSERT INTO operations_weekly_feedback(id,report_id,action_index,detail,created_by) VALUES($1,$2,$3,$4::jsonb,$5)',[id,body.reportId,body.index,JSON.stringify(detail),user.id]);
   await store.event(db,null,'feedback',user.id,{id,reportId:body.reportId,index:body.index,...detail});await db.query('COMMIT');return sendJSON(res,201,{id});
  }
  if(body.action==='prepare'){
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['weekly-prepare:'+body.start]);
   const result=await store.prepare(db,body.start,user.id);await db.query('COMMIT');return sendJSON(res,201,result);
  }
  const run=(await db.query('SELECT w.*,p.payload FROM operations_weekly_runs w JOIN operations_analysis_packets p ON p.id=w.packet_id WHERE w.id=$1 FOR UPDATE OF w',[body.id])).rows[0];
  if(!run)throw Object.assign(Error('准备记录不存在'),{status:404});if(run.state==='published')throw Object.assign(Error('已发布记录不能修改，请新增修订'),{status:409});
  if(body.action==='analyze'){
   const analysis=domain.validateAnalysis(body.analysis,run.payload),management=store.management(run.payload,analysis);
   const monthText=Object.entries(management.monthGoals).map(([month,goal])=>{const actual=management.monthActuals.find(r=>r.month===month)?.income;if(actual==null)return month+'月目标'+(goal??'待设定')+'元（未取得该月已记录收入）';return month+'已记录累计'+actual+'元；月目标'+(goal??'待设定')+'元；完成'+(goal>0?(actual/goal*100).toFixed(1)+'%':'率不适用')+'；差额'+(goal==null?'待确认':core.money(actual-goal))+'元';}).join('。');
   const report=require('./operations-reports').validateReport({...body.report,packetId:run.packet_id,reportType:'weekly',actions:analysis.actions,management,weekly:{...body.report.weekly,monthText,overviewRows:store.overview(management)}});
   const saved={report,analysis};await db.query("UPDATE operations_weekly_runs SET analysis=$2::jsonb,state='analyzed',reviewed_by=NULL,reviewed_at=NULL WHERE id=$1",[run.id,JSON.stringify(saved)]);
   await store.event(db,run.id,'analyze',user.id,saved);await db.query('COMMIT');return sendJSON(res,200,{id:run.id,state:'analyzed',report});
  }
  if(body.action==='review'){
   if(!ensureRole(res,user,['admin'])){await db.query('ROLLBACK');return;}
   if(run.state!=='analyzed'||!run.analysis||body.confirmed!==true)throw Object.assign(Error('须先完成Agent分析，并明确确认复核'),{status:409});
   if(!run.payload.managementContext.daily.complete)throw Object.assign(Error('日报缺失、暂报或待修订，请先补齐；不能生成看似完整的正式报告'),{status:409});
   await store.assertFresh(db,run.payload);
   await db.query("UPDATE operations_weekly_runs SET state='reviewed',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",[run.id,user.id]);await store.event(db,run.id,'review',user.id,{confirmed:true,sourceSha256:run.payload.sha256});await db.query('COMMIT');return sendJSON(res,200,{id:run.id,state:'reviewed',report:run.analysis.report});
  }
  throw Object.assign(Error('操作无效'),{status:400});
 }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});
  if(e.code==='23505'&&req.method==='POST'&&req.weeklySubmission){try{const b=req.weeklySubmission,existing=await store.submittedInput(pool,b.requestId,b.start,b.text);if(existing)return sendJSON(res,200,existing);}catch(conflict){return sendError(res,conflict.status||409,conflict.message);}}
  sendError(res,e.status||400,e.status?e.message:'周报操作失败，请检查输入及初始化状态');}finally{db?.release();}
};
