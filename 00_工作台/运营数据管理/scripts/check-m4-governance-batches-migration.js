const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration=fs.readFileSync('sql/20260909_m4_09_governance_batches.sql','utf8');
const rollback=fs.readFileSync('sql/20260909_m4_09_rollback.sql','utf8');
(async()=>{const db=new Client({...cfg,user:'postgres'});await db.connect();try{
  await db.query("DELETE FROM governance_batch_events WHERE batch_id='m409-schema';DELETE FROM governance_batch_items WHERE batch_id='m409-schema';DELETE FROM governance_batches WHERE id='m409-schema'");
  await db.query("INSERT INTO governance_batches(id,name,status,created_by) VALUES('m409-schema','M409结构保留','draft','m409-tester')");
  await db.query(`INSERT INTO governance_batch_items(id,batch_id,sequence_no,candidate_type,candidate_id,source_table,source_id,source_line_key,proposed_payload,affected_amount)
    VALUES('m409-schema-item','m409-schema',1,'revenue_attribution','revenuecand_m409schema','revenue','m409-schema-source','other_amount','{"businessLayerCode":"visit"}',10)`);
  await db.query("INSERT INTO governance_batch_events(id,batch_id,action,from_status,to_status,actor_id) VALUES('m409-schema-event','m409-schema','create','','draft','m409-tester')");
  const sources=async()=>JSON.stringify((await db.query("SELECT (SELECT COUNT(*) FROM revenue)::INTEGER revenue_count,(SELECT COALESCE(SUM(ticket_amount+combo_amount+coffee_amount+workshop_amount+retail_amount+creative_amount+venue_amount+other_amount),0) FROM revenue)::NUMERIC revenue_amount,(SELECT COUNT(*) FROM expense)::INTEGER expense_count,(SELECT COALESCE(SUM(amount),0) FROM expense)::NUMERIC expense_amount,(SELECT COUNT(*) FROM record_business_links)::INTEGER link_count")).rows[0]);
  const before=await sources();await db.query(rollback);assert.equal((await db.query("SELECT to_regclass('governance_batch_summary_v2') IS NULL ok")).rows[0].ok,true);assert.equal(Number((await db.query("SELECT COUNT(*) FROM governance_batches WHERE id='m409-schema'")).rows[0].count),1);for(let i=0;i<2;i++)await db.query(migration);assert.equal(await sources(),before);
  const batch=(await db.query("SELECT * FROM governance_batch_summary_v2 WHERE id='m409-schema'")).rows[0];assert.equal(batch.item_count,1);assert.equal(batch.event_count,1);assert.equal(Number(batch.affected_amount),10);assert.equal(batch.items[0].candidateId,'revenuecand_m409schema');
  console.log('PASS M4-09 migration: additive batch/item/event schema, summary view, idempotence, audit retention on rollback and unchanged source facts');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
