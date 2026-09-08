const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration = fs.readFileSync('sql/20260908_m4_04_product_cost_evidence.sql','utf8');
const rollback = fs.readFileSync('sql/20260908_m4_04_rollback.sql','utf8');

async function seed(db) {
  await db.query("DELETE FROM product_aliases WHERE id LIKE 'm404-%'; DELETE FROM revenue WHERE id LIKE 'm404-%'; DELETE FROM creative_products WHERE id LIKE 'm404-%'");
  await db.query(`INSERT INTO creative_products
    (id,name,standard_name,business_type_code,package_spec,cost_price,retail_price,is_beverage,is_active,approval_status,created_at,updated_at)
    VALUES
    ('m404-verified','M404快照商品','M404快照标准商品','creative_retail','单件',4,12,false,true,'已上架','2026-09-01','2026-09-01'),
    ('m404-classification','M404分类待补','','','',0,18,false,true,'待确认','2026-09-01','2026-09-01'),
    ('m404-current-only','M404仅当前成本','M404仅当前成本','creative_retail','单件',3,10,false,true,'已上架','2026-09-01','2026-09-01'),
    ('m404-alias-reference','M404别名标准商品','M404别名标准商品','creative_retail','盒装',0,20,false,true,'已上架','2026-09-01','2026-09-01')`);
  await db.query(`INSERT INTO product_aliases
    (id,alias_name,standard_product_id,standard_name,business_type_code,package_spec,unit_price,cost_price_snapshot,is_beverage,confidence,is_active,created_at,updated_at)
    VALUES ('m404-alias','M404历史别名','m404-alias-reference','M404别名标准商品','creative_retail','盒装',20,7,false,0.90,true,'2026-09-02','2026-09-02')`);
  const sales = [
    ['m404-sale-snapshot','2026-09-03',[{productName:'M404快照商品',standardName:'M404快照标准商品',productId:'m404-verified',businessTypeCode:'creative_retail',packageSpec:'单件',qty:2,unitPrice:12,amount:24,costPriceSnapshot:4,snapshotVersion:1}],24],
    ['m404-sale-current','2026-08-01',[{productName:'M404仅当前成本',qty:2,unitPrice:10,amount:20}],20],
    ['m404-sale-alias','2026-08-02',[{productName:'M404历史别名',qty:1,unitPrice:20,amount:20}],20]
  ];
  for (const [id,date,items,amount] of sales) {
    await db.query("INSERT INTO revenue(id,date,retail_items,retail_amount,status) VALUES($1,$2,$3::jsonb,$4,'正常')",[id,date,JSON.stringify(items),amount]);
  }
}

(async()=>{
  const db = new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});
  await db.connect();
  try {
    await seed(db);
    const sourceSnapshot = async () => (await db.query(`SELECT
      (SELECT COUNT(*) FROM revenue WHERE id LIKE 'm404-%')::INTEGER revenue_count,
      (SELECT COALESCE(SUM(retail_amount),0) FROM revenue WHERE id LIKE 'm404-%')::NUMERIC(14,2) revenue_amount,
      (SELECT COUNT(*) FROM creative_products WHERE id LIKE 'm404-%')::INTEGER product_count,
      (SELECT COUNT(*) FROM product_aliases WHERE id LIKE 'm404-%')::INTEGER alias_count`)).rows[0];
    const before = await sourceSnapshot();
    await db.query(rollback);
    assert.equal((await db.query("SELECT to_regclass('product_cost_evidence_v2') IS NULL AND to_regclass('product_master_governance_v2') IS NULL ok")).rows[0].ok,true);
    await db.query(migration);
    await db.query(migration);
    assert.deepEqual(await sourceSnapshot(),before,'governance migration must not modify sources');

    const products=(await db.query("SELECT * FROM product_master_governance_v2 WHERE product_id LIKE 'm404-%' ORDER BY product_id")).rows;
    assert.equal(products.length,4);
    assert.ok(products.every(x=>/^productgov_[0-9a-f]{20}$/.test(x.governance_id)));
    assert.equal(new Set(products.map(x=>x.governance_id)).size,4);
    const verified=products.find(x=>x.product_id==='m404-verified');
    assert.equal(verified.governance_status,'complete');
    assert.equal(verified.cost_evidence_status,'verified_sale_snapshots');
    assert.equal(Number(verified.suggested_historical_unit_cost),4);
    assert.equal(verified.snapshot_observed_from,'2026-09-03');
    const classification=products.find(x=>x.product_id==='m404-classification');
    assert.equal(classification.governance_status,'classification_and_cost_review');
    assert.equal(classification.classification_issue_count,3);
    assert.equal(classification.missing_current_cost,true);
    assert.equal(classification.suggested_standard_name,'M404分类待补');
    const currentOnly=products.find(x=>x.product_id==='m404-current-only');
    assert.equal(currentOnly.cost_evidence_status,'current_only_no_backdate');
    assert.equal(currentOnly.governance_status,'cost_evidence_review');
    assert.equal(currentOnly.suggested_historical_unit_cost,null,'current cost must not become historical suggestion');
    assert.equal(currentOnly.unverified_cost_line_count,1);
    const aliasRef=products.find(x=>x.product_id==='m404-alias-reference');
    assert.equal(aliasRef.cost_evidence_status,'alias_reference_requires_period');
    assert.equal(aliasRef.suggested_historical_unit_cost,null,'alias reference without period must not become historical suggestion');

    const evidence=(await db.query("SELECT * FROM product_cost_evidence_v2 WHERE product_id LIKE 'm404-%' ORDER BY evidence_type,product_id")).rows;
    assert.deepEqual(new Set(evidence.map(x=>x.evidence_type)),new Set(['sale_snapshot','alias_cost_snapshot','current_master_cost']));
    assert.ok(evidence.every(x=>/^costev_[0-9a-f]{20}$/.test(x.evidence_id)));
    assert.equal(evidence.find(x=>x.product_id==='m404-current-only'&&x.evidence_type==='current_master_cost').historical_application,'current_forward_only');
    assert.equal(evidence.find(x=>x.evidence_type==='alias_cost_snapshot').historical_application,'requires_period_confirmation');
    console.log('PASS M4-04 migration: classification gaps, evidence provenance/periods, snapshot-only historical suggestions, no current-cost backdating, idempotence, rollback and unchanged sources');
  } finally { await db.end(); }
})().catch(error=>{console.error(error);process.exitCode=1});
