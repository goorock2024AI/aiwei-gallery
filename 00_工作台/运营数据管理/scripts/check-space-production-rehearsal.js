'use strict';
// Restore a private production backup into a dedicated loopback database. No remote writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(process.env.AIWEI_TEST_CONFIG||path.join(root,'tmp/m3-05-test.json'))),dump=process.env.AIWEI_BACKUP_DUMP;
assert.equal(config.host,'127.0.0.1');assert.equal(config.port,55435);assert(dump&&fs.existsSync(dump));
const name='aiwei_space_restore_'+Date.now(),admin=new Client({...config,user:'postgres',database:'postgres'});let db,created=false;
(async()=>{await admin.connect();try{
 await admin.query('CREATE DATABASE '+name);created=true;
 const restored=spawnSync(process.env.PG_RESTORE_PATH||'C:/Program Files/PostgreSQL/17/bin/pg_restore.exe',['--no-owner','--exit-on-error','-h',config.host,'-p',String(config.port),'-U','postgres','-d',name,dump],{env:{...process.env,PGPASSWORD:config.password},encoding:'utf8',windowsHide:true});assert.equal(restored.status,0,restored.stderr);
 db=new Client({...config,user:'postgres',database:name});await db.connect();
 const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
 const fingerprints=async()=>{const out={};for(const t of tables)out[t]=(await db.query(`SELECT COUNT(*)::int n,COALESCE(md5(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text)),'empty') hash FROM "${t}" t`)).rows[0];return out;};
 const before=await fingerprints(),nonSpace=(await db.query("SELECT * FROM business_revenue_facts_v2 WHERE source_table<>'space_payments' AND NOT(source_table='revenue' AND source_line_key='venue_amount') ORDER BY fact_id")).rows;
 for(const f of ['sql/20261024_space_execution.sql','sql/20261025_space_project_workflow.sql'])for(let i=0;i<2;i++)await db.query(fs.readFileSync(path.join(root,f),'utf8'));
 assert.deepEqual(await fingerprints(),before);assert.deepEqual((await db.query('SELECT * FROM business_revenue_facts_v2 ORDER BY fact_id')).rows,nonSpace);
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM space_contract_documents')).rows[0].n,0);assert.equal((await db.query('SELECT COUNT(*)::int n FROM space_execution_lines')).rows[0].n,0);
 await db.query(fs.readFileSync(path.join(root,'sql/20261025_space_project_workflow_rollback.sql'),'utf8'));await db.query(fs.readFileSync(path.join(root,'sql/20261024_space_execution_rollback.sql'),'utf8'));assert.deepEqual(await fingerprints(),before);
 for(const f of ['sql/20261024_space_execution.sql','sql/20261025_space_project_workflow.sql'])await db.query(fs.readFileSync(path.join(root,f),'utf8'));assert.deepEqual(await fingerprints(),before);
 const result={passed:true,restored:true,sourceTableCount:tables.length,sourceTablesUnchanged:true,nonSpaceFactsUnchanged:true,historicalExecutionNotFabricated:true,contractSamplesNotCreated:true,idempotence:true,rollbackAndReapply:true,productionWrites:0};
 const out=process.env.AIWEI_REHEARSAL_RESULT||path.join(root,'tmp/space-rehearsal-result.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await db?.end();if(created)await admin.query('DROP DATABASE '+name);await admin.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
