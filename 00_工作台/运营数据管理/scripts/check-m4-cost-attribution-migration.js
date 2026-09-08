const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration=fs.readFileSync('sql/20260908_m4_06_cost_attribution_candidates.sql','utf8');
const rollback=fs.readFileSync('sql/20260908_m4_06_rollback.sql','utf8');
async function seed(db){
  await db.query("DELETE FROM record_business_links WHERE id LIKE 'm406-%';DELETE FROM business_mapping_rules WHERE id LIKE 'm406-%';DELETE FROM expense WHERE id LIKE 'm406-%';DELETE FROM project_registry WHERE id LIKE 'm406-%'");
  await db.query(`INSERT INTO project_registry(id,name,status,notes) VALUES
    ('m406-project-unique','M406唯一项目','active','唯一项目候选'),
    ('m406-project-amb-a','M406同名项目','active','同名候选 A'),
    ('m406-project-amb-b','M406同名项目','active','同名候选 B')`);
  await db.query(`INSERT INTO business_mapping_rules(id,source_table,source_field,match_type,match_value,business_layer_code,business_type_code,cost_type_code,capability_axis_code,priority,confidence,is_active,notes) VALUES
    ('m406-rule-unique-top','expense','category','exact','M406执行材料','experience_activity','workshop','activity_execution','content_ip',700,0.95,true,'完整唯一候选'),
    ('m406-rule-unique-low','expense','description','contains','M406','', '', 'marketing','audience_membership',600,0.70,true,'低优先级不得覆盖'),
    ('m406-rule-amb-a','expense','category','exact','M406冲突','experience_activity','workshop','activity_execution','content_ip',800,0.90,true,'冲突候选 A'),
    ('m406-rule-amb-b','expense','description','contains','M406冲突','art_transaction_cooperation','brand_event','marketing','audience_membership',800,0.90,true,'冲突候选 B'),
    ('m406-rule-partial','expense','category','exact','M406能力投入','','','','content_ip',750,0.80,true,'只有能力轴的部分候选'),
    ('m406-rule-invalid-regex','expense','description','regex','[','','','labor','',900,0.50,true,'无效正则必须安全忽略')`);
  const rows=[
    ['m406-unique','2026-11-01','运营支出','M406唯一项目','M406执行材料',1200,'M406执行物料','小艾'],
    ['m406-ambiguous','2026-11-02','运营支出','M406同名项目','M406冲突',800,'M406冲突支出','小艾'],
    ['m406-partial','2026-11-03','运营支出','运营','M406能力投入',300,'能力建设','小艾'],
    ['m406-none','2026-11-04','运营支出','运营','M406其他',200,'无法判断','小艾'],
    ['m406-manual','2026-11-05','运营支出','M406唯一项目','M406人工',500,'已有人工归属','小艾'],
    ['m406-pending','2026-11-06','运营支出','运营','M406待补',150,'人工链接待补','小艾'],
    ['m406-project-conflict','2026-11-07','运营支出','M406同名项目','M406执行材料',400,'M406项目冲突','小艾']
  ];
  for(const row of rows)await db.query("INSERT INTO expense(id,date,type,project,category,amount,description,handler,related_activity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'')",row);
  await db.query(`INSERT INTO record_business_links(id,source_table,source_id,source_line_key,business_layer_code,business_type_code,cost_type_code,capability_axis_code,override_reason,created_by) VALUES
    ('m406-link-manual','expense','m406-manual','expense','experience_activity','workshop','activity_execution','content_ip','支出用途已核实','m406-reviewer'),
    ('m406-link-pending','expense','m406-pending','expense','','','uncategorized_cost','','等待成本类型确认','m406-reviewer')`);
}
(async()=>{const db=new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});await db.connect();try{
  await seed(db);
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT
    (SELECT COUNT(*) FROM expense WHERE id LIKE 'm406-%')::INTEGER expense_count,
    (SELECT COALESCE(SUM(amount),0) FROM expense WHERE id LIKE 'm406-%')::NUMERIC(14,2) expense_amount,
    (SELECT COUNT(*) FROM business_mapping_rules WHERE id LIKE 'm406-%')::INTEGER rule_count,
    (SELECT COUNT(*) FROM record_business_links WHERE id LIKE 'm406-%')::INTEGER link_count,
    (SELECT COUNT(*) FROM project_registry WHERE id LIKE 'm406-%')::INTEGER project_count`)).rows[0]);
  const before=await snapshot();await db.query(rollback);
  assert.equal((await db.query("SELECT to_regclass('cost_attribution_candidates_v2') IS NULL ok")).rows[0].ok,true);
  assert.equal((await db.query("SELECT to_regprocedure('governance_safe_expense_regex_match(text,text)') IS NULL ok")).rows[0].ok,true);
  for(let i=0;i<2;i++)await db.query(migration);assert.equal(await snapshot(),before);
  assert.equal((await db.query("SELECT governance_safe_expense_regex_match('abc','[') ok")).rows[0].ok,false);
  const rows=(await db.query("SELECT * FROM cost_attribution_candidates_v2 WHERE source_id LIKE 'm406-%' ORDER BY source_id")).rows;
  assert.equal(rows.length,7);assert.ok(rows.every(x=>/^costcand_[0-9a-f]{20}$/.test(x.candidate_id)));assert.equal(new Set(rows.map(x=>x.candidate_id)).size,7);
  const unique=rows.find(x=>x.source_id==='m406-unique');assert.equal(unique.candidate_status,'unique_rule');assert.equal(unique.matched_rule_count,2);assert.equal(unique.top_rule_count,1);assert.equal(unique.suggested_cost_type_code,'activity_execution');assert.equal(unique.suggested_business_type_code,'workshop');assert.equal(unique.suggested_capability_axis_code,'content_ip');assert.equal(unique.original_category,'M406执行材料');assert.equal(unique.project_match_status,'unique_project');assert.equal(unique.suggested_project_id,'m406-project-unique');
  const ambiguous=rows.find(x=>x.source_id==='m406-ambiguous');assert.equal(ambiguous.candidate_status,'ambiguous_rules');assert.equal(ambiguous.cost_candidate_count,2);assert.equal(ambiguous.suggested_cost_type_code,'');assert.equal(ambiguous.project_match_status,'ambiguous_projects');
  const partial=rows.find(x=>x.source_id==='m406-partial');assert.equal(partial.candidate_status,'partial_rule');assert.equal(partial.suggested_capability_axis_code,'content_ip');assert.equal(partial.suggested_cost_type_code,'');
  assert.equal(rows.find(x=>x.source_id==='m406-none').candidate_status,'no_candidate');
  const manual=rows.find(x=>x.source_id==='m406-manual');assert.equal(manual.candidate_status,'manual_link');assert.equal(manual.candidate_basis,'record_business_links');assert.equal(manual.suggested_cost_type_code,'activity_execution');
  assert.equal(rows.find(x=>x.source_id==='m406-pending').candidate_status,'pending_manual_link');
  assert.equal(rows.find(x=>x.source_id==='m406-project-conflict').project_match_status,'ambiguous_projects');
  const ids=(await db.query("SELECT candidate_id FROM cost_attribution_candidates_v2 WHERE source_id LIKE 'm406-%' ORDER BY source_id")).rows.map(x=>x.candidate_id);assert.deepEqual(ids,rows.map(x=>x.candidate_id));
  console.log('PASS M4-06 migration: original categories preserved, manual priority, unique/partial/conflicting rules, project candidates, safe regex, stable IDs, idempotence, rollback and unchanged sources');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
