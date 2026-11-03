'use strict';
// A dedicated local database restored from backup, never a production connection.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{Client}=require('pg');
(async()=>{const database=process.env.OPTIONAL_PACKAGE_TEST_DB||'aiwei_m3_05_test';assert(['aiwei_m3_05_test','aiwei_optional_release'].includes(database));const db=new Client({host:'127.0.0.1',port:55435,user:'postgres',database});await db.connect();try{
 const sql=name=>fs.readFileSync(path.join(__dirname,'../sql',name),'utf8');
 await db.query(sql('20260908_m4_04_product_cost_evidence.sql'));
 const before=(await db.query('SELECT * FROM product_master_governance_v2 ORDER BY product_id')).rows;
 const fingerprint=async()=>JSON.stringify((await db.query("SELECT 'products' kind,md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) hash FROM creative_products t UNION ALL SELECT 'sales',md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) FROM revenue t")).rows);
 const original=await fingerprint();
 await db.query(sql('20261103_optional_package_spec.sql'));
 const after=(await db.query('SELECT * FROM product_master_governance_v2 ORDER BY product_id')).rows;
 assert(before.length>0);assert.equal(after.length,before.length);
 let changed=0,empty=0;
 for(let i=0;i<before.length;i++){
  const a=before[i],b=after[i];assert.equal(b.product_id,a.product_id);
  assert.equal(b.classification_issue_count,a.classification_issue_count-(a.missing_package_spec?1:0));
  for(const field of ['package_spec','missing_package_spec','current_cost','missing_current_cost','unverified_cost_line_count','snapshot_evidence_count','cost_evidence_status'])assert.deepEqual(b[field],a[field],field);
  const hasCostGap=b.unverified_cost_line_count>0||b.missing_current_cost;
  assert.equal(b.governance_status,b.classification_issue_count>0?(hasCostGap?'classification_and_cost_review':'classification_review'):(hasCostGap?'cost_evidence_review':'complete'));
  if(a.missing_package_spec)empty++;
  if(a.governance_status!==b.governance_status)changed++;
 }
 assert(empty>0,'Test data must include empty packaging');assert(changed>0,'Test data must demonstrate a changed status');
 assert.equal(await fingerprint(),original);
 await db.query(sql('20261103_optional_package_spec.sql'));
 assert.deepEqual((await db.query('SELECT * FROM product_master_governance_v2 ORDER BY product_id')).rows,after);
 console.log(JSON.stringify({passed:true,products:after.length,emptyPackaging:empty,statusesChanged:changed,rawRecordsUnchanged:true,idempotent:true,productionWrites:false}));
}finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});
