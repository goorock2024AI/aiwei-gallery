const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));const migration=fs.readFileSync('sql/20260908_m4_05_revenue_attribution_candidates.sql','utf8'),rollback=fs.readFileSync('sql/20260908_m4_05_rollback.sql','utf8');
async function seed(db){await db.query("DELETE FROM record_business_links WHERE id LIKE 'm405-%';DELETE FROM business_mapping_rules WHERE id LIKE 'm405-%';DELETE FROM revenue WHERE id LIKE 'm405-%'");
  await db.query(`INSERT INTO business_mapping_rules(id,source_table,source_field,match_type,match_value,business_layer_code,business_type_code,priority,confidence,is_active,notes) VALUES
    ('m405-rule-unique-top','revenue','other_desc','contains','企业团建','art_transaction_cooperation','brand_event',500,0.95,true,'企业团建精确业务候选'),
    ('m405-rule-unique-low','revenue','other_desc','contains','团建','experience_activity','workshop',400,0.70,true,'低优先级规则不得覆盖'),
    ('m405-rule-amb-a','revenue','other_desc','contains','合作冲突','art_transaction_cooperation','brand_event',600,0.90,true,'同级候选 A'),
    ('m405-rule-amb-b','revenue','other_desc','prefix','M405合作','art_transaction_cooperation','space_rental',600,0.90,true,'同级候选 B')`);
  const rows=[['m405-unique','2026-10-01','M405企业团建收入',1200],['m405-ambiguous','2026-10-02','M405合作冲突',800],['m405-none','2026-10-03','M405无法判断收入',300],['m405-manual','2026-10-04','M405已有人工归属',500],['m405-pending','2026-10-05','M405人工待补',200]];
  for(const row of rows)await db.query("INSERT INTO revenue(id,date,other_desc,other_amount,status) VALUES($1,$2,$3,$4,'正常')",row);
  await db.query(`INSERT INTO record_business_links(id,source_table,source_id,source_line_key,business_layer_code,business_type_code,override_reason,created_by) VALUES
    ('m405-link-manual','revenue','m405-manual','other_amount','experience_activity','workshop','现场体验收入已核实','m405-reviewer'),
    ('m405-link-pending','revenue','m405-pending','other_amount','','','等待业务负责人确认','m405-reviewer')`);
}
(async()=>{const db=new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});await db.connect();try{await seed(db);
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT (SELECT COUNT(*) FROM revenue WHERE id LIKE 'm405-%')::INTEGER revenue_count,(SELECT COALESCE(SUM(other_amount),0) FROM revenue WHERE id LIKE 'm405-%')::NUMERIC(14,2) revenue_amount,(SELECT COUNT(*) FROM business_mapping_rules WHERE id LIKE 'm405-%')::INTEGER rule_count,(SELECT COUNT(*) FROM record_business_links WHERE id LIKE 'm405-%')::INTEGER link_count`)).rows[0]);const before=await snapshot();
  await db.query(rollback);assert.equal((await db.query("SELECT to_regclass('revenue_attribution_candidates_v2') IS NULL ok")).rows[0].ok,true);for(let i=0;i<2;i++)await db.query(migration);assert.equal(await snapshot(),before);
  assert.equal((await db.query("SELECT governance_safe_regex_match('abc','[') ok")).rows[0].ok,false,'invalid regex must fail closed');
  const rows=(await db.query("SELECT * FROM revenue_attribution_candidates_v2 WHERE source_id LIKE 'm405-%' ORDER BY source_id")).rows;assert.equal(rows.length,5);assert.ok(rows.every(x=>/^revenuecand_[0-9a-f]{20}$/.test(x.candidate_id)));assert.equal(new Set(rows.map(x=>x.candidate_id)).size,5);
  const unique=rows.find(x=>x.source_id==='m405-unique');assert.equal(unique.candidate_status,'unique_rule');assert.equal(unique.matched_rule_count,2);assert.equal(unique.top_rule_count,1);assert.equal(unique.suggested_business_type_code,'brand_event');
  const ambiguous=rows.find(x=>x.source_id==='m405-ambiguous');assert.equal(ambiguous.candidate_status,'ambiguous_rules');assert.equal(ambiguous.candidate_count,2);assert.equal(ambiguous.suggested_business_type_code,'');assert.equal(ambiguous.candidate_options.length,2);
  const none=rows.find(x=>x.source_id==='m405-none');assert.equal(none.candidate_status,'no_candidate');assert.equal(none.candidate_count,0);
  const manual=rows.find(x=>x.source_id==='m405-manual');assert.equal(manual.candidate_status,'manual_link');assert.equal(manual.suggested_business_type_code,'workshop');assert.equal(manual.candidate_basis,'record_business_links');
  const pending=rows.find(x=>x.source_id==='m405-pending');assert.equal(pending.candidate_status,'pending_manual_link');assert.equal(pending.review_priority,'P1');
  console.log('PASS M4-05 migration: manual priority, unique top rule, same-priority conflicts, no/pending candidates, safe regex, stable IDs, idempotence, rollback and unchanged sources');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
