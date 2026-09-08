const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration = fs.readFileSync('sql/20260908_m4_03_product_alias_candidates.sql', 'utf8');
const rollback = fs.readFileSync('sql/20260908_m4_03_rollback.sql', 'utf8');

async function seed(db) {
  await db.query("DELETE FROM product_aliases WHERE id LIKE 'm403-%'; DELETE FROM creative_products WHERE id LIKE 'm403-%'; DELETE FROM revenue WHERE id LIKE 'm403-%'");
  await db.query(`INSERT INTO creative_products
    (id,name,standard_name,business_type_code,package_spec,retail_price,cost_price,is_active,updated_at)
    VALUES
    ('m403-product-mapped','M403标准饮品','M403标准饮品','beverage_retail','550ml',6,2,true,NOW()),
    ('m403-product-unique','M403唯一商品','M403唯一标准商品','creative_retail','单件',12,4,true,NOW()),
    ('m403-product-amb-a','M403歧义商品','M403歧义商品 A','creative_retail','小号',20,7,true,NOW()),
    ('m403-product-amb-b','M403歧义商品','M403歧义商品 B','creative_retail','大号',30,10,true,NOW())`);
  await db.query(`INSERT INTO product_aliases
    (id,alias_name,standard_product_id,standard_name,business_type_code,package_spec,unit_price,confidence,is_active)
    VALUES ('m403-alias-mapped','M403历史水','m403-product-mapped','M403标准饮品','beverage_retail','550ml',6,0.98,true)`);
  const rows = [
    ['m403-revenue-mapped','2026-09-01','M403历史水',6,12],
    ['m403-revenue-unique','2026-09-02','M403唯一商品',12,24],
    ['m403-revenue-ambiguous','2026-09-03','M403歧义商品',25,50],
    ['m403-revenue-none','2026-09-04','M403没有这个商品',12,24]
  ];
  for (const [id,date,productName,unitPrice,amount] of rows) {
    await db.query(`INSERT INTO revenue (id,date,retail_items,retail_amount,status)
      VALUES ($1,$2,$3::jsonb,$4,'正常')`, [id,date,JSON.stringify([{productName,qty:2,unitPrice,amount}]),amount]);
  }
}

(async () => {
  const db = new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});
  await db.connect();
  try {
    await seed(db);
    const sourceSnapshot = async () => (await db.query(`SELECT
      (SELECT COUNT(*) FROM revenue WHERE id LIKE 'm403-%')::INTEGER revenue_count,
      (SELECT COALESCE(SUM(retail_amount),0) FROM revenue WHERE id LIKE 'm403-%')::NUMERIC(14,2) revenue_amount,
      (SELECT COUNT(*) FROM creative_products WHERE id LIKE 'm403-%')::INTEGER product_count,
      (SELECT COUNT(*) FROM product_aliases WHERE id LIKE 'm403-%')::INTEGER alias_count`)).rows[0];
    const before = await sourceSnapshot();
    await db.query(rollback);
    assert.equal((await db.query("SELECT to_regclass('product_alias_candidates_v2') IS NULL ok")).rows[0].ok, true);
    await db.query(migration);
    await db.query(migration);
    assert.deepEqual(await sourceSnapshot(), before, 'migration must not change source facts or master data');

    const candidates = (await db.query("SELECT * FROM product_alias_candidates_v2 WHERE normalized_alias LIKE 'm403%' ORDER BY candidate_status,alias_name")).rows;
    assert.equal(candidates.length, 4);
    assert.deepEqual(new Set(candidates.map(x => x.candidate_status)), new Set(['matched','unique_candidate','ambiguous','no_candidate']));
    assert.equal(new Set(candidates.map(x => x.candidate_id)).size, 4);
    assert.ok(candidates.every(x => /^aliascand_[0-9a-f]{20}$/.test(x.candidate_id)));

    const mapped = candidates.find(x => x.candidate_status === 'matched');
    assert.equal(mapped.candidate_basis, 'existing_alias');
    assert.equal(mapped.suggested_product_id, 'm403-product-mapped');
    const unique = candidates.find(x => x.candidate_status === 'unique_candidate');
    assert.equal(unique.candidate_basis, 'exact_name_and_price');
    assert.equal(unique.suggested_product_id, 'm403-product-unique');
    const ambiguous = candidates.find(x => x.candidate_status === 'ambiguous');
    assert.equal(ambiguous.candidate_count, 2);
    assert.equal(ambiguous.suggested_product_id, '');
    assert.equal(ambiguous.candidate_options.length, 2);
    const none = candidates.find(x => x.candidate_status === 'no_candidate');
    assert.equal(none.candidate_count, 0);
    assert.equal(none.suggested_product_id, '');
    assert.equal(Number(none.unit_price), 12, 'equal price alone must not create a candidate');
    assert.ok(candidates.every(x => Number(x.line_count) === 1 && Number(x.affected_record_count) === 1));

    const stable = (await db.query("SELECT candidate_id FROM product_alias_candidates_v2 WHERE normalized_alias LIKE 'm403%' ORDER BY normalized_alias,unit_price")).rows;
    const stableAgain = (await db.query("SELECT candidate_id FROM product_alias_candidates_v2 WHERE normalized_alias LIKE 'm403%' ORDER BY normalized_alias,unit_price")).rows;
    assert.deepEqual(stableAgain, stable);
    console.log('PASS M4-03 migration: four review states, exact-name rules, no price-only inference, stable IDs, idempotence, rollback and unchanged source facts');
  } finally {
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
