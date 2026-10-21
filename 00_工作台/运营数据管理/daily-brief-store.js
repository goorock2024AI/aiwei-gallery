'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('./daily-brief-core'),render=require('./daily-brief-render'),connectors=require('./daily-brief-connectors');
const directory=()=>path.join(process.env.REPORT_ARCHIVE_DIR||'/tmp/aiwei-report-archive','daily');
async function latest(db,date){return (await db.query('SELECT * FROM operations_daily_briefs WHERE business_date=$1 ORDER BY revision DESC LIMIT 1',[date])).rows[0];}
async function generate(pool,date,{now=new Date().toISOString(),actor='service:daily-brief',weather,analysis,force=false}={}){
 core.validateDate(date);const db=await pool.connect();let committed=false,artifacts;
 // A session lock is acquired before the repeatable-read snapshot so competing runs cannot create duplicate revisions.
 await db.query('SELECT pg_advisory_lock(hashtext($1))',['daily-brief:'+date]);
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const old=await latest(db,date),collected=await core.collect(db,date,now);
  if(old&&old.source_hash===collected.sourceHash&&!force&&(date!==core.day(now)||(old.payload.coffee?.stateVersion??null)===(collected.coffee?.stateVersion??null))){await db.query('COMMIT');committed=true;return old;}
  const observed=weather||await connectors.weather(date);
  const p=core.assemble(collected,date,now,observed,old?.payload);p.id=crypto.randomUUID();p.revision=(old?.revision||0)+1;
  p.analysis=analysis||await connectors.analyze(p);artifacts=render.renderFiles(p,directory());
  const row=(await db.query('INSERT INTO operations_daily_briefs(id,business_date,revision,source_hash,payload,artifacts,supersedes,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING *',[p.id,date,p.revision,p.sourceHash,JSON.stringify(p),JSON.stringify(artifacts),old?.id||null,actor])).rows[0];
  await db.query("INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,'generate_daily_brief','operations_daily_briefs',$3,$4::jsonb)",[crypto.randomUUID(),actor,p.id,JSON.stringify({date,revision:p.revision,sourceHash:p.sourceHash,supersedes:old?.id||null})]);
  await db.query('COMMIT');committed=true;return row;
 }finally{if(!committed){await db.query('ROLLBACK').catch(()=>{});if(artifacts)for(const a of Object.values(artifacts))fs.unlinkSync(path.join(directory(),a.file));}await db.query('SELECT pg_advisory_unlock(hashtext($1))',['daily-brief:'+date]);db.release();}
}
function read(row,format){const a=row.artifacts[format];if(!a||!new RegExp('^'+row.id+'\\.(html|png)$').test(a.file))throw Error('日报文件索引无效');const bytes=fs.readFileSync(path.join(directory(),a.file));if(core.hash(bytes)!==a.sha256)throw Error('日报文件校验失败');return bytes;}
async function weekly(pool,start,{refresh=false}={}){
 core.validateDate(start);if(new Date(start+'T12:00:00Z').getUTCDay()!==1)throw Error('周资料包须从周一开始');
 const reports=[],missing=[],stale=[];
 for(let i=0;i<7;i++){const date=core.add(start,i);let row=await latest(pool,date);if(!row){missing.push(date);continue;}
  if(await core.fingerprint(pool,date)!==row.source_hash){if(refresh)row=await generate(pool,date);else stale.push(date);}
  reports.push({id:row.id,date,revision:row.revision,sourceHash:row.source_hash,metrics:row.payload.metrics,weather:row.payload.weather,coffee:row.payload.coffee,analysis:row.payload.analysis,finalized:row.payload.finalized});}
 return {schemaVersion:1,start,end:core.add(start,6),complete:missing.length===0&&stale.length===0&&reports.every(r=>r.finalized),missing,stale,provisionalDates:reports.filter(r=>!r.finalized).map(r=>r.date),
  totals:{basis:missing.length||stale.length?'已取得日期小计，不能当完整周总额':'七天合计',income:core.money(reports.reduce((n,r)=>n+r.metrics.income,0)),visitors:reports.some(r=>r.metrics.visitors==null)?null:reports.reduce((n,r)=>n+r.metrics.visitors,0)},reports,
  basis:'按日读取最新有效日报；缺失不补零，数据变化必须修订；周报读取本包，跨月月报不得整周累加。'};
}
module.exports={directory,latest,generate,read,weekly};
