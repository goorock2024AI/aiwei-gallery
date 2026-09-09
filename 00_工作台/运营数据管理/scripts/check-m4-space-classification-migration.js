const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration=fs.readFileSync('sql/20260909_m4_08_space_classification_candidates.sql','utf8');
const rollback=fs.readFileSync('sql/20260909_m4_08_rollback.sql','utf8');
async function seed(db){
  await db.query("DELETE FROM space_payments WHERE space_usage_id LIKE 'm408-%';DELETE FROM space_usage WHERE id LIKE 'm408-%'");
  const rows=[
    ['m408-complete','2026-12-01','1号厅','M408完整品牌合作','品牌快闪','品牌甲','已确认','付费',10000,'brand_event','联办','M408-C-001','已签约'],
    ['m408-ready','2026-12-02','2号厅','M408租赁候选','场地租赁','客户乙','筹备中','付费',6000,'','','M408-C-READY',''],
    ['m408-exhibition','2026-12-03','1号厅','M408自营展览','展览','','筹备中','免费',0,'','','',''],
    ['m408-cooperation','2026-12-04','咖啡区','M408合作方式待审','品牌快闪','品牌丙','已确认','付费',8000,'brand_event','','M408-C-COOP','已签约'],
    ['m408-contract','2026-12-05','2号厅','M408缺合同项目','品牌快闪','品牌丁','进行中','付费',12000,'brand_event','赞助','','执行中'],
    ['m408-dup-a','2026-12-06','1号厅','M408重复合同A','场地租赁','客户戊','已完成','付费',3000,'space_rental','租赁','M408-DUP','已完成'],
    ['m408-dup-b','2026-12-07','2号厅','M408重复合同B','场地租赁','客户己','已完成','付费',4000,'space_rental','租赁','m408-dup','已完成'],
    ['m408-invalid','2026-12-08','咖啡区','M408无效字典','场地租赁','客户庚','已完成','免费',0,'legacy_space','合资','','归档']
  ];
  for(const row of rows)await db.query(`INSERT INTO space_usage(id,date,space,project_name,type,client,status,rental_type,receivable_amount,business_type_code,cooperation_mode,contract_no,business_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,row);
  await db.query("INSERT INTO space_payments(id,space_usage_id,payment_date,amount,payment_method) VALUES('m408-pay-complete','m408-complete','2026-12-02',4000,'转账'),('m408-pay-contract','m408-contract','2026-12-06',5000,'转账')");
}
(async()=>{const db=new Client({...cfg,user:'postgres'});await db.connect();try{await seed(db);
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT
    (SELECT COUNT(*) FROM space_usage WHERE id LIKE 'm408-%')::INTEGER project_count,
    (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage WHERE id LIKE 'm408-%')::NUMERIC receivable_amount,
    (SELECT COUNT(*) FROM space_payments WHERE space_usage_id LIKE 'm408-%')::INTEGER payment_count,
    (SELECT COALESCE(SUM(amount),0) FROM space_payments WHERE space_usage_id LIKE 'm408-%')::NUMERIC payment_amount`)).rows[0]);
  const before=await snapshot();await db.query(rollback);assert.equal((await db.query("SELECT to_regclass('space_classification_candidates_v2') IS NULL ok")).rows[0].ok,true);for(let i=0;i<2;i++)await db.query(migration);assert.equal(await snapshot(),before);
  const rows=(await db.query("SELECT * FROM space_classification_candidates_v2 WHERE source_id LIKE 'm408-%' ORDER BY source_id")).rows;assert.equal(rows.length,8);assert.ok(rows.every(x=>/^spacecand_[0-9a-f]{20}$/.test(x.candidate_id)));assert.equal(new Set(rows.map(x=>x.candidate_id)).size,8);
  const complete=rows.find(x=>x.source_id==='m408-complete');assert.equal(complete.candidate_status,'complete');assert.equal(complete.issue_count,0);assert.equal(Number(complete.received_amount),4000);
  const ready=rows.find(x=>x.source_id==='m408-ready');assert.equal(ready.candidate_status,'ready_candidate');assert.equal(ready.suggested_business_type_code,'space_rental');assert.equal(ready.suggested_cooperation_mode,'租赁');assert.equal(ready.suggested_business_status,'洽谈');
  const exhibition=rows.find(x=>x.source_id==='m408-exhibition');assert.equal(exhibition.candidate_status,'classification_review');assert.equal(exhibition.business_type_requires_review,true);assert.equal(exhibition.suggested_business_type_code,'uncategorized_revenue');
  assert.equal(rows.find(x=>x.source_id==='m408-cooperation').candidate_status,'cooperation_review');
  const contract=rows.find(x=>x.source_id==='m408-contract');assert.equal(contract.candidate_status,'contract_review');assert.equal(contract.contract_status,'missing_required');assert.equal(Number(contract.received_amount),5000);
  for(const id of ['m408-dup-a','m408-dup-b']){const row=rows.find(x=>x.source_id===id);assert.equal(row.contract_status,'duplicate');assert.equal(row.contract_usage_count,2);assert.equal(row.candidate_status,'contract_review')}
  const invalid=rows.find(x=>x.source_id==='m408-invalid');assert.equal(invalid.candidate_status,'classification_review');assert.equal(invalid.business_type_status,'invalid');assert.equal(invalid.cooperation_status,'invalid');assert.equal(invalid.business_status_status,'invalid');assert.equal(invalid.review_priority,'P1');
  const ids=(await db.query("SELECT candidate_id FROM space_classification_candidates_v2 WHERE source_id LIKE 'm408-%' ORDER BY source_id")).rows.map(x=>x.candidate_id);assert.deepEqual(ids,rows.map(x=>x.candidate_id));
  console.log('PASS M4-08 migration: four-dimension states, safe suggestions, mixed-use review, contract gaps/duplicates, stable IDs, idempotence, rollback and unchanged sources');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
