'use strict';
// Deployment-only, additive and idempotent. No business rows are modified.
const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg');
(async()=>{
 const client=new Client({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});
 await client.connect();
 try{
  await client.query("SELECT pg_advisory_lock(hashtext('aiwei-coffee-migration'))");
  await client.query(fs.readFileSync(path.join(__dirname,'sql/20261021_coffee_inventory.sql'),'utf8'));
  const result=await client.query("SELECT version FROM coffee_inventory_state WHERE id='coffee'");
  if(result.rowCount!==1)throw new Error('Coffee inventory singleton missing');
  console.log('Coffee inventory additive migration verified');
 }finally{await client.query("SELECT pg_advisory_unlock(hashtext('aiwei-coffee-migration'))").catch(()=>{});await client.end();}
})().catch(()=>{console.error('Coffee inventory migration failed; deployment stopped');process.exitCode=1;});
