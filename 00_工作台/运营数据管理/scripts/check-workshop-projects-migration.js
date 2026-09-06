#!/usr/bin/env node
// Requires the dedicated local M3 test database on port 55435. Never use production data.
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');
const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') throw new Error('Requires the dedicated local M3 test database');
(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  try {
    const snapshot = async () => JSON.stringify((await db.query("SELECT (SELECT jsonb_agg(e ORDER BY id) FROM expense e) expense,(SELECT jsonb_agg(r ORDER BY id) FROM revenue r) revenue,(SELECT jsonb_agg(l ORDER BY id) FROM record_business_links l) links,pg_get_viewdef('business_cost_facts_v2'::regclass) cost_view")).rows[0]);
    const before = await snapshot();
    await db.query(fs.readFileSync('sql/20260906_m3_06_rollback.sql', 'utf8'));
    assert.equal(await snapshot(), before);
    assert.equal((await db.query("SELECT to_regclass('workshop_project_performance_v2') AS name")).rows[0].name, null);
    for (let i = 0; i < 2; i++) await db.query(fs.readFileSync('sql/20260906_m3_06_workshop_projects.sql', 'utf8'));
    assert.equal(await snapshot(), before);
    const project = (await db.query("SELECT * FROM workshop_project_performance_v2 WHERE activity_month='2026-09' AND project_key='m306亲子木刻'")).rows[0];
    assert.equal(Number(project.revenue_amount), 354);
    assert.equal(Number(project.direct_cost_amount), 100);
    console.log('PASS M3-06 rollback/reapply/idempotence: raw expense, revenue, links and M3-05 cost view unchanged.');
  } finally { await db.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
