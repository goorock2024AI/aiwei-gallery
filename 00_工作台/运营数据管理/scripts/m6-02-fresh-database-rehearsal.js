const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const projectDir = path.resolve(__dirname, '..');
const manifestPath = path.join(projectDir, 'sql', 'm6-forward-manifest.json');
const resultPath = path.join(projectDir, 'tmp', 'm6-02-fresh-rehearsal-result.json');
const keepDatabase = process.argv.includes('--keep-database');
const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const requiredTables = [
  'business_dimensions', 'business_mapping_rules', 'product_aliases', 'record_business_links',
  'governance_batches', 'governance_batch_items', 'governance_batch_events'
];
const requiredViews = [
  'business_revenue_facts_v2', 'business_cost_facts_v2', 'business_profit_facts_v2',
  'workshop_project_performance_v2', 'gallery_transaction_performance_v2', 'space_project_performance_v2',
  'business_layer_summary_v2', 'data_governance_issues_v2', 'data_governance_baseline_v2',
  'product_alias_candidates_v2', 'product_cost_evidence_v2', 'product_master_governance_v2',
  'revenue_attribution_candidates_v2', 'cost_attribution_candidates_v2',
  'gallery_link_candidates_v2', 'workshop_link_candidates_v2',
  'space_classification_candidates_v2', 'governance_batch_summary_v2'
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function quotedIdentifier(value) {
  assert.match(value, /^aiwei_m6_[a-z0-9_]+$/, 'Database name must use the aiwei_m6_ prefix');
  return `"${value}"`;
}

function loadAdminConfig() {
  if (process.env.M6_PG_ADMIN_URL) {
    const parsed = new URL(process.env.M6_PG_ADMIN_URL);
    assert.equal(parsed.protocol, 'postgresql:', 'M6_PG_ADMIN_URL must use postgresql://');
    assert.ok(localHosts.has(parsed.hostname), 'Fresh database rehearsal only accepts a local PostgreSQL host');
    return { connectionString: process.env.M6_PG_ADMIN_URL };
  }

  const localConfigPath = path.join(projectDir, 'tmp', 'm3-05-test.json');
  assert.ok(fs.existsSync(localConfigPath), 'Set M6_PG_ADMIN_URL or provide the ignored local test config');
  const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  assert.ok(localHosts.has(config.host), 'Ignored test config must point to a local PostgreSQL host');
  return {
    host: config.host,
    port: config.port,
    database: 'postgres',
    user: 'postgres',
    password: config.password
  };
}

function targetConfig(adminConfig, database) {
  if (adminConfig.connectionString) {
    const parsed = new URL(adminConfig.connectionString);
    parsed.pathname = `/${database}`;
    return { connectionString: parsed.toString() };
  }
  return { ...adminConfig, database };
}

function verifyManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.forward.length, 19, 'Forward chain must contain the 1.0 approval prerequisite and M3-02 through M6-05');
  assert.equal(manifest.rollback.length, 15, 'Rollback chain must contain the supported reverse path');
  const entries = [manifest.baseline, ...manifest.forward, ...manifest.rollback];
  const seen = new Set();
  for (const entry of entries) {
    const absolutePath = path.join(projectDir, entry.path);
    assert.ok(fs.existsSync(absolutePath), `Missing manifest file: ${entry.path}`);
    const actual = sha256(fs.readFileSync(absolutePath));
    assert.equal(actual, entry.sha256, `Checksum mismatch: ${entry.path}`);
    assert.ok(!seen.has(entry.path), `Duplicate manifest path: ${entry.path}`);
    seen.add(entry.path);
  }
  return sha256(fs.readFileSync(manifestPath));
}

async function runSqlFile(client, entry, phase, timings) {
  const started = Date.now();
  try {
    await client.query(fs.readFileSync(path.join(projectDir, entry.path), 'utf8'));
  } catch (error) {
    throw new Error(`${phase} ${entry.path}: ${error.message}`, { cause: error });
  }
  timings.push({ phase, path: entry.path, durationMs: Date.now() - started });
}

async function seedLegacyFacts(client) {
  await client.query(`
    INSERT INTO creative_products(id,name,sku,supplier,cost_price,retail_price,stock)
    VALUES('m602-product','M602旧版商品','M602-SKU','M602供应商',12.50,30.00,5);
    INSERT INTO revenue(id,date,ticket_qty,ticket_amount,retail_items,retail_amount,other_amount,other_desc,status,payment_method)
    VALUES('m602-revenue','2026-09-10',2,20.00,'[{"productName":"M602旧版商品","qty":1,"unitPrice":30,"amount":30}]',30.00,7.25,'M602待归类','正常','扫码支付');
    INSERT INTO expense(id,date,type,project,category,amount,description)
    VALUES('m602-expense','2026-09-10','运营支出','M602项目','办公行政',18.75,'M602旧版支出');
    INSERT INTO gallery_sales(id,date,artwork_no,artwork_name,artist,price,commission,refund_amount,status)
    VALUES('m602-gallery','2026-09-10','M602-A','M602作品','M602艺术家',100.00,10.00,0,'已售出');
    INSERT INTO space_usage(id,date,space,project_name,type,client,status,rental_type,receivable_amount)
    VALUES('m602-space','2026-09-10','1号厅','M602空间项目','展览','M602客户','进行中','付费',200.00);
    INSERT INTO space_payments(id,space_usage_id,payment_date,amount,payment_method)
    VALUES('m602-payment','m602-space','2026-09-10',120.00,'转账');
    INSERT INTO daily_closings(id,date,system_net_amount,confirmed_amount,difference_amount,status)
    VALUES('m602-closing','2026-09-10',177.25,177.25,0,'草稿');
  `);
}

async function legacySnapshot(client) {
  return (await client.query(`SELECT jsonb_build_object(
    'revenue',(SELECT jsonb_agg(jsonb_build_object('id',id,'date',date,'ticketQty',ticket_qty,'ticketAmount',ticket_amount,'retailAmount',retail_amount,'otherAmount',other_amount,'otherDesc',other_desc,'status',status) ORDER BY id) FROM revenue WHERE id='m602-revenue'),
    'expense',(SELECT jsonb_agg(jsonb_build_object('id',id,'date',date,'type',type,'project',project,'category',category,'amount',amount,'description',description) ORDER BY id) FROM expense WHERE id='m602-expense'),
    'gallery',(SELECT jsonb_agg(jsonb_build_object('id',id,'date',date,'artworkNo',artwork_no,'price',price,'commission',commission,'refund',refund_amount,'status',status) ORDER BY id) FROM gallery_sales WHERE id='m602-gallery'),
    'space',(SELECT jsonb_agg(jsonb_build_object('id',id,'date',date,'space',space,'project',project_name,'type',type,'status',status,'receivable',receivable_amount) ORDER BY id) FROM space_usage WHERE id='m602-space'),
    'payment',(SELECT jsonb_agg(jsonb_build_object('id',id,'usage',space_usage_id,'date',payment_date,'amount',amount) ORDER BY id) FROM space_payments WHERE id='m602-payment'),
    'closing',(SELECT jsonb_agg(jsonb_build_object('id',id,'date',date,'system',system_net_amount,'confirmed',confirmed_amount,'difference',difference_amount,'status',status) ORDER BY id) FROM daily_closings WHERE id='m602-closing'),
    'product',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'cost',cost_price,'retail',retail_price,'stock',stock) ORDER BY id) FROM creative_products WHERE id='m602-product')
  ) snapshot`)).rows[0].snapshot;
}

async function schemaFingerprint(client) {
  return (await client.query(`SELECT md5(COALESCE(string_agg(definition, '' ORDER BY object_name),'')) fingerprint
    FROM (
      SELECT c.relname object_name,pg_get_viewdef(c.oid,true) definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='v' AND c.relname=ANY($1)
      UNION ALL
      SELECT table_name||'.'||column_name,table_name||'.'||column_name||':'||data_type||':'||COALESCE(column_default,'')
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($2)
    ) objects`, [requiredViews, requiredTables])).rows[0].fingerprint;
}

async function validateForwardState(client) {
  const relations = (await client.query(`SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1)`, [[...requiredTables, ...requiredViews]])).rows;
  const found = new Map(relations.map(row => [row.relname, row.relkind]));
  for (const table of requiredTables) assert.equal(found.get(table), 'r', `Missing table ${table}`);
  for (const view of requiredViews) assert.equal(found.get(view), 'v', `Missing view ${view}`);

  const dimensions = (await client.query(`SELECT dimension_type,COUNT(*)::INTEGER count
    FROM business_dimensions GROUP BY dimension_type ORDER BY dimension_type`)).rows;
  assert.deepEqual(Object.fromEntries(dimensions.map(row => [row.dimension_type, row.count])), {
    business_layer: 4, business_type: 11, capability_axis: 3, cost_type: 10
  });

  const layerOrder = (await client.query(`SELECT code FROM business_dimensions
    WHERE dimension_type='business_layer' ORDER BY sort_order,code`)).rows.map(row => row.code);
  assert.deepEqual(layerOrder, ['visit', 'onsite_consumption', 'experience_activity', 'art_transaction_cooperation']);

  const facts = (await client.query(`SELECT
    (SELECT COALESCE(SUM(net_amount),0) FROM business_revenue_facts_v2 WHERE source_id='m602-revenue') total_revenue,
    (SELECT COALESCE(SUM(net_amount),0) FROM business_revenue_facts_v2
      WHERE source_id='m602-revenue' AND business_type_code<>'uncategorized_revenue') classified_revenue,
    (SELECT COUNT(*)::INTEGER FROM data_governance_issues_v2 WHERE source_id IN ('m602-revenue','m602-expense')) issues,
    (SELECT COUNT(*)::INTEGER FROM business_layer_summary_v2 WHERE period_month='2026-09') summary_rows`)).rows[0];
  assert.equal(Number(facts.total_revenue), 57.25, 'The v2 fact layer must preserve the complete legacy revenue amount');
  assert.equal(Number(facts.classified_revenue), 50, 'Classified v2 revenue must exclude the pending other amount');
  assert.ok(facts.issues >= 1, 'Pending legacy facts must remain visible in governance');
  assert.equal(facts.summary_rows, 4, 'Each populated month must preserve four business layers');
  const rolloutMode = (await client.query("SELECT value->>'mode' mode FROM app_config WHERE key='operations_rollout'")).rows[0]?.mode;
  assert.equal(rolloutMode, 'off', 'Fresh databases must default the operations module to off');
  return { dimensions: 28, requiredTables: requiredTables.length, requiredViews: requiredViews.length };
}

async function validateRollbackState(client) {
  const removedViews = (await client.query(`SELECT COUNT(*)::INTEGER count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1) AND c.relkind='v'`, [requiredViews])).rows[0].count;
  assert.equal(removedViews, 0, 'All v2 views must be disabled after the full reverse path');
  const removedCoreTables = (await client.query(`SELECT COUNT(*)::INTEGER count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1) AND c.relkind='r'`,
  [['business_dimensions', 'business_mapping_rules', 'product_aliases', 'record_business_links']])).rows[0].count;
  assert.equal(removedCoreTables, 0, 'M3-02 additive mapping tables must be removed by rollback');
  const auditTables = (await client.query(`SELECT COUNT(*)::INTEGER count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1) AND c.relkind='r'`,
  [['governance_batches', 'governance_batch_items', 'governance_batch_events']])).rows[0].count;
  assert.equal(auditTables, 3, 'M4 audit tables must be retained even when their summary view is disabled');
  const rolloutRows = (await client.query("SELECT COUNT(*)::INTEGER count FROM app_config WHERE key='operations_rollout'")).rows[0].count;
  assert.equal(rolloutRows, 0, 'M6-05 rollback must remove the rollout configuration');
}

async function applyEntries(client, entries, phase, timings) {
  for (const entry of entries) await runSqlFile(client, entry, phase, timings);
}

async function applyEntriesWithImmediateReplay(client, entries, timings) {
  for (const entry of entries) {
    await runSqlFile(client, entry, 'forward-1', timings);
    await runSqlFile(client, entry, 'idempotence', timings);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestSha256 = verifyManifest(manifest);
  const adminConfig = loadAdminConfig();
  const suffix = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const database = process.env.M6_TEST_DATABASE || `aiwei_m6_02_${suffix}_${process.pid}`;
  const databaseSql = quotedIdentifier(database);
  const admin = new Client(adminConfig);
  const timings = [];
  let testClient;
  let created = false;
  let result;

  await admin.connect();
  try {
    const exists = Number((await admin.query('SELECT COUNT(*) FROM pg_database WHERE datname=$1', [database])).rows[0].count);
    assert.equal(exists, 0, `Target database already exists: ${database}`);
    await admin.query(`CREATE DATABASE ${databaseSql} TEMPLATE template0 ENCODING 'UTF8'`);
    created = true;
    testClient = new Client(targetConfig(adminConfig, database));
    await testClient.connect();

    await runSqlFile(testClient, manifest.baseline, 'baseline', timings);
    await seedLegacyFacts(testClient);
    const legacyBefore = await legacySnapshot(testClient);

    await applyEntriesWithImmediateReplay(testClient, manifest.forward, timings);
    const validation = await validateForwardState(testClient);
    const fingerprint1 = await schemaFingerprint(testClient);
    assert.deepEqual(await legacySnapshot(testClient), legacyBefore, 'First forward pass changed legacy facts');

    await applyEntries(testClient, manifest.rollback, 'rollback', timings);
    await validateRollbackState(testClient);
    assert.deepEqual(await legacySnapshot(testClient), legacyBefore, 'Rollback changed legacy facts');

    await applyEntries(testClient, manifest.forward, 'forward-after-rollback', timings);
    await validateForwardState(testClient);
    const fingerprint2 = await schemaFingerprint(testClient);
    assert.equal(fingerprint2, fingerprint1, 'Reapply after rollback changed the final schema');
    assert.deepEqual(await legacySnapshot(testClient), legacyBefore, 'Reapply after rollback changed legacy facts');

    result = {
      passed: true,
      database,
      manifestSha256,
      baselineSourceCommit: manifest.baseline.sourceCommit,
      forwardFiles: manifest.forward.length,
      rollbackFiles: manifest.rollback.length,
      forwardChainPasses: 2,
      perFileIdempotencePasses: 1,
      rollbackPasses: 1,
      validation,
      schemaFingerprint: fingerprint1,
      legacyFactsUnchanged: true,
      keptDatabase: keepDatabase,
      durationMs: timings.reduce((sum, row) => sum + row.durationMs, 0),
      timings
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`PASS M6-02 fresh database: ${manifest.forward.length} forward files, immediate idempotence replay, rollback and full reapply; ${manifest.rollback.length} rollback files, 28 dimensions, ${requiredViews.length} views, unchanged legacy facts`);
    console.log(JSON.stringify({ ...result, timings: undefined }));
  } catch (error) {
    fs.writeFileSync(resultPath, JSON.stringify({ passed: false, database, error: error.message, timings }, null, 2));
    throw error;
  } finally {
    if (testClient) await testClient.end().catch(() => {});
    if (created && !keepDatabase) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
      await admin.query(`DROP DATABASE ${databaseSql}`);
    }
    await admin.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
