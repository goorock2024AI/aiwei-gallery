'use strict';
const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg');
(async()=>{
 const db=new Client({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});
 await db.connect();try{
  await db.query("SELECT pg_advisory_lock(hashtext('aiwei-space-execution-migration'))");
  await db.query(fs.readFileSync(path.join(__dirname,'../sql/20261024_space_execution.sql'),'utf8'));
  console.log('Space execution migration verified; historical receipts and reports retained');
 }finally{await db.query("SELECT pg_advisory_unlock(hashtext('aiwei-space-execution-migration'))").catch(()=>{});await db.end();}
})().catch(()=>{console.error('Space execution migration failed; deployment stopped');process.exitCode=1;});
