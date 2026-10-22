'use strict';
// Preparation and dispatch only. Never calls a model or publishes a report.
const {Pool}=require('pg'),core=require('../daily-brief-core'),domain=require('../weekly-management'),store=require('../weekly-management-store');
async function tick(pool,{config=require('../weekly-management-config').read(),now=new Date(),fetcher=fetch}={}){
 const date=core.day(now),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now),monday=new Date(date+'T12:00:00Z').getUTCDay()===1;
 const result={preparation:'disabled',dispatch:'disabled',autoPublish:false};
 if(config.WEEKLY_PREPARE_ENABLED==='true'&&monday){
  const start=core.add(date,-7),db=await pool.connect();
  try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['weekly-prepare:'+start]);
   const existing=(await db.query('SELECT id,state FROM operations_weekly_runs WHERE start_date=$1 ORDER BY created_at DESC LIMIT 1',[start])).rows[0];
   if(time==='12:00'&&!existing){const p=await store.prepare(db,start,'service:weekly-prepare');result.preparation='cutoff_frozen';result.runId=p.id;}
   else result.preparation=existing?existing.state:time>'12:00'?'cutoff_missed':'not_due';
   if(['13:00','14:00','15:00','16:00'].includes(time)){
    const kind=existing?'schedule_'+time:'cutoff_missed';
    if(!(await db.query('SELECT id FROM operations_weekly_events WHERE kind=$1 AND detail->>\'start\'=$2 LIMIT 1',[kind,start])).rows.length)await store.event(db,existing?.id||null,kind,'service:weekly-prepare',{start,at:now.toISOString(),state:result.preparation,owner:'管理员'});
   }
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
 if(config.WEEKLY_SEND_ENABLED==='true'){
  const events=(await pool.query("SELECT id FROM operations_weekly_outbox WHERE state IN('pending','retry','sending') ORDER BY created_at,id LIMIT 20")).rows;
  result.dispatch=[];for(const e of events)result.dispatch.push(await require('../weekly-management-dispatch').dispatch(pool,e.id,{config,now,fetcher}));
 }
 return result;
}
if(require.main===module){const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});tick(pool).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('周报准备/投递任务失败，请检查后台待办；未输出凭据');process.exitCode=1;}).finally(()=>pool.end());}
module.exports={tick};
