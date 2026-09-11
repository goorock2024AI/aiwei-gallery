const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const projectDir = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, 'tmp', 'm3-05-test.json'), 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') throw new Error('M6-07 only accepts the dedicated local regression database');

const artifactDir = path.join(projectDir, 'tmp', 'm6-07-restore-rehearsal');
const baselineSql = fs.readFileSync(path.join(projectDir, 'sql', 'm6-07-baseline.sql'), 'utf8');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const targetDatabase = `aiwei_m6_07_restore_${stamp}_${process.pid}`;
const dumpPath = path.join(artifactDir, `aiwei-m6-07-${stamp}.dump`);
const listPath = `${dumpPath}.list`;
const manifestPath = `${dumpPath}.manifest.json`;
const resultPath = path.join(artifactDir, 'result.json');
const expectedRelations = [
  'business_dimensions','business_mapping_rules','product_aliases','record_business_links',
  'governance_batches','governance_batch_items','governance_batch_events','trial_run_issues','trial_run_issue_events',
  'business_revenue_facts_v2','business_cost_facts_v2','business_profit_facts_v2',
  'workshop_project_performance_v2','gallery_transaction_performance_v2','space_project_performance_v2',
  'business_layer_summary_v2','data_governance_issues_v2','data_governance_baseline_v2',
  'product_alias_candidates_v2','product_cost_evidence_v2','product_master_governance_v2',
  'revenue_attribution_candidates_v2','cost_attribution_candidates_v2','gallery_link_candidates_v2',
  'workshop_link_candidates_v2','space_classification_candidates_v2','governance_batch_summary_v2','trial_run_issue_register_v2'
];

function executable(name) {
  const configured = process.env.M6_PG_BIN ? path.join(process.env.M6_PG_BIN, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : '';
  const windowsDefault = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform === 'win32' && fs.existsSync(windowsDefault)) return windowsDefault;
  return name;
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: projectDir,
    env: { ...process.env, PGPASSWORD: cfg.password },
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  return result.stdout;
}

function quoteIdentifier(value) {
  assert.match(value, /^aiwei_m6_07_restore_[0-9_]+$/);
  return `"${value}"`;
}

function stableBaseline(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.capturedAt;
  delete copy.database;
  return copy;
}

async function captureBaseline(client) {
  const result = await client.query(baselineSql);
  return result.rows[0].baseline;
}

async function validateRestored(client, sourceBaseline) {
  const restored = await captureBaseline(client);
  assert.deepEqual(stableBaseline(restored), stableBaseline(sourceBaseline), 'Restored counts, amounts or schema differ from the source backup point');
  const relations = (await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1)`, [expectedRelations])).rows.map(row => row.relname);
  assert.deepEqual(expectedRelations.filter(name => !relations.includes(name)), [], 'Restored database is missing required 2.0 relations');
  assert.equal(restored.configuration.operationsRollout, 'off', 'Recovery point must keep the 2.0 entry off');
  const openCritical = (await client.query("SELECT COUNT(*)::INTEGER count FROM trial_run_issues WHERE severity IN ('P0','P1') AND status<>'verified'")).rows[0].count;
  assert.equal(openCritical, 0, 'Recovery point must not contain unresolved P0/P1 issues');
  return restored;
}

(async () => {
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  const admin = new Client({ ...cfg, database: 'postgres', user: 'postgres' });
  const source = new Client({ ...cfg, user: 'postgres' });
  const pgDump = executable('pg_dump');
  const pgRestore = executable('pg_restore');
  const timings = {};
  let created = false;
  await admin.connect();
  await source.connect();
  try {
    assert.equal(Number((await admin.query('SELECT COUNT(*) FROM pg_database WHERE datname=$1', [targetDatabase])).rows[0].count), 0);
    const sourceBaseline = await captureBaseline(source);
    assert.equal(sourceBaseline.configuration.operationsRollout, 'off', 'Source rollout must be off before creating a recovery point');
    const unresolved = (await source.query("SELECT COUNT(*)::INTEGER count FROM trial_run_issues WHERE severity IN ('P0','P1') AND status<>'verified'")).rows[0].count;
    assert.equal(unresolved, 0, 'Source has unresolved P0/P1 issues');

    let started = Date.now();
    run(pgDump, ['-h', cfg.host, '-p', String(cfg.port), '-U', 'postgres', '-d', cfg.database, '-Fc', '--no-owner', '--no-acl', '-f', dumpPath]);
    timings.backupMs = Date.now() - started;
    const bytes = fs.readFileSync(dumpPath);
    assert.ok(bytes.length > 1024, 'Backup dump is unexpectedly small');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const list = run(pgRestore, ['--list', dumpPath]);
    fs.writeFileSync(listPath, list);
    for (const relation of ['revenue', 'expense', 'gallery_sales', 'space_usage', 'trial_run_issues']) assert.match(list, new RegExp(`\\b${relation}\\b`));

    const restorePasses = [];
    for (let pass = 1; pass <= 2; pass++) {
      if (created) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [targetDatabase]);
        await admin.query(`DROP DATABASE ${quoteIdentifier(targetDatabase)}`);
        created = false;
      }
      await admin.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)} TEMPLATE template0 ENCODING 'UTF8'`);
      created = true;
      started = Date.now();
      run(pgRestore, ['-h', cfg.host, '-p', String(cfg.port), '-U', 'postgres', '-d', targetDatabase, '--no-owner', '--no-acl', '--exit-on-error', dumpPath]);
      const restoreMs = Date.now() - started;
      const restoredClient = new Client({ ...cfg, database: targetDatabase, user: 'postgres' });
      // A forced cleanup can race with Windows socket shutdown after Client.end().
      // Ignore only the expected administrator termination for this disposable database.
      restoredClient.on('error', () => {});
      await restoredClient.connect();
      const restored = await validateRestored(restoredClient, sourceBaseline);
      if (pass === 1) await restoredClient.query("INSERT INTO app_config(key,value) VALUES('m607_restore_probe','{}'::jsonb)");
      if (pass === 2) assert.equal(Number((await restoredClient.query("SELECT COUNT(*) FROM app_config WHERE key='m607_restore_probe'")).rows[0].count), 0, 'Second restore retained a mutation made after the recovery point');
      await restoredClient.end();
      restorePasses.push({ pass, restoreMs, fingerprint: restored.schema.fingerprint, baselineMatched: true });
    }
    timings.restoreMs = restorePasses.map(row => row.restoreMs);
    assert.deepEqual(stableBaseline(await captureBaseline(source)), stableBaseline(sourceBaseline), 'Backup and restore rehearsal changed the source database');

    const manifest = {
      createdAt: new Date().toISOString(), source: 'dedicated-local-regression-database',
      backupFile: path.basename(dumpPath), sizeBytes: bytes.length, sha256,
      format: 'pg_dump_custom', pgRestoreListVerified: true,
      baseline: sourceBaseline, restorePasses, sourceUnchanged: true
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = {
      passed: true, backupFile: dumpPath, manifestFile: manifestPath, listFile: listPath,
      sizeBytes: bytes.length, sha256, backupMs: timings.backupMs,
      restorePasses: 2, restoreMs: timings.restoreMs,
      schemaFingerprint: sourceBaseline.schema.fingerprint,
      countsAndAmountsMatched: true, rolloutOff: true, unresolvedCriticalIssues: 0,
      postBackupMutationRemoved: true, sourceUnchanged: true
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`PASS M6-07 restore rehearsal: verified ${bytes.length} byte custom dump, two isolated restores, matching baseline ${sourceBaseline.schema.fingerprint}`);
    console.log(JSON.stringify(result));
  } finally {
    await source.end().catch(() => {});
    if (created) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [targetDatabase]).catch(() => {});
      await admin.query(`DROP DATABASE ${quoteIdentifier(targetDatabase)}`).catch(() => {});
    }
    await admin.end().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
