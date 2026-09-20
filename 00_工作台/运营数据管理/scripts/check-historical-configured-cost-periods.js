#!/usr/bin/env node
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Historical configured-cost test only accepts the dedicated local test database');
}

const baseMigration = fs.readFileSync('sql/20260920_configured_sale_cost_snapshots.sql', 'utf8');
const baseRollback = fs.readFileSync('sql/20260920_configured_sale_cost_snapshots_rollback.sql', 'utf8');
const migration = fs.readFileSync('sql/20260920_historical_configured_cost_periods.sql', 'utf8');
const rollback = fs.readFileSync('sql/20260920_historical_configured_cost_periods_rollback.sql', 'utf8');
const ids = ['cost-sync-september', 'cost-sync-august', 'cost-sync-snapshot'];
const configKeys = ['ticket_products', 'coffee_products', 'workshop_products'];

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  let baseApplied = false;
  let fallbackApplied = false;
  let configBefore = [];
  const restoreConfig = async () => {
    await db.query('DELETE FROM app_config WHERE key = ANY($1)', [configKeys]);
    for (const row of configBefore) {
      await db.query('INSERT INTO app_config(key,value,updated_at) VALUES($1,$2::jsonb,$3)', [
        row.key, JSON.stringify(row.value), row.updated_at
      ]);
    }
  };
  try {
    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]);
    configBefore = (await db.query('SELECT key,value,updated_at FROM app_config WHERE key = ANY($1)', [configKeys])).rows;
    await db.query(`INSERT INTO app_config(key,value) VALUES
      ('ticket_products',$1::jsonb),('coffee_products',$2::jsonb),('workshop_products',$3::jsonb)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [
      JSON.stringify([{ name: '普通票', costPrice: 0, price: 10 }, { name: '套票', costPrice: 4.5, price: 20 }]),
      JSON.stringify([{ name: '手冲咖啡', cost_price: 3, price: 15 }]),
      JSON.stringify([{ name: '果壳风铃', costPrice: 12, price: 128 }])
    ]);

    const rawBefore = Number((await db.query('SELECT COUNT(*) FROM revenue')).rows[0].count);
    await db.query(baseMigration);
    baseApplied = true;
    await db.query(migration);
    fallbackApplied = true;
    await db.query(migration);

    await db.query(`INSERT INTO revenue(
      id,date,ticket_qty,ticket_amount,ticket_items,combo_qty,combo_amount,
      coffee_qty,coffee_amount,coffee_items,workshop_items,workshop_amount,project_name,status
    ) VALUES(
      'cost-sync-september','2026-09-05',1,10,
      '[{"name":"普通票","qty":1,"price":10,"amount":10,"costPriceSnapshot":0,"snapshotVersion":1},{"name":"套票","qty":2,"price":20,"amount":40}]',
      2,40,2,30,'[{"name":"手冲咖啡","qty":2,"price":15,"amount":30}]',
      '[{"productName":"果壳风铃","qty":1,"participantCount":1,"unitPrice":128,"amount":128}]',128,'测试工坊','正常'
    ),(
      'cost-sync-august','2026-08-31',0,0,
      '[{"name":"套票","qty":1,"price":20,"amount":20}]',1,20,0,0,'[]','[]',0,'','正常'
    ),(
      'cost-sync-snapshot','2026-09-05',0,0,
      '[{"name":"套票","qty":1,"price":20,"amount":20,"costPriceSnapshot":9,"snapshotVersion":1}]',
      1,20,0,0,'[]','[]',0,'','正常'
    )`);

    const costs = (await db.query(`SELECT source_id,source_line_key,unit_cost,cost_amount,mapping_status,quality_flags
      FROM configured_sale_cost_facts_v2 WHERE source_id = ANY($1) ORDER BY source_id,source_line_key`, [ids])).rows;
    assert.equal(costs.filter(row => row.source_id === 'cost-sync-august').length, 0, 'fallback must not reach before September');
    assert.deepEqual(costs.filter(row => row.source_id === 'cost-sync-september').map(row => [
      row.source_line_key, Number(row.unit_cost), Number(row.cost_amount), row.mapping_status,
      Boolean(row.quality_flags.missing_unit_cost)
    ]), [
      ['coffee', 3, 6, 'current_config_backfill', false],
      ['combo', 4.5, 9, 'current_config_backfill', false],
      ['ticket', 0, 0, 'missing_cost_config', true],
      ['workshop:1', 12, 12, 'current_config_backfill', false]
    ]);
    assert.deepEqual(costs.filter(row => row.source_id === 'cost-sync-snapshot').map(row => [
      row.source_line_key, Number(row.unit_cost), Number(row.cost_amount), row.mapping_status
    ]), [['combo', 9, 9, 'sale_snapshot']], 'positive sale snapshot must override current configuration');

    const missingIssue = await db.query(`SELECT issue_type,priority FROM data_governance_issues_v2
      WHERE source_id='cost-sync-september' AND source_line_key='ticket' AND issue_type='missing_product_cost'`);
    assert.equal(missingIssue.rowCount, 1, 'zero configuration must remain visible as missing cost');

    await db.query(`UPDATE app_config SET value=$1::jsonb,updated_at=NOW() WHERE key='ticket_products'`, [
      JSON.stringify([{ name: '普通票', costPrice: 2, price: 10 }, { name: '套票', costPrice: 4.5, price: 20 }])
    ]);
    const updatedTicket = (await db.query(`SELECT unit_cost,cost_amount,mapping_status,quality_flags
      FROM configured_sale_cost_facts_v2 WHERE source_id='cost-sync-september' AND source_line_key='ticket'`)).rows[0];
    assert.deepEqual([
      Number(updatedTicket.unit_cost), Number(updatedTicket.cost_amount), updatedTicket.mapping_status,
      Boolean(updatedTicket.quality_flags.missing_unit_cost)
    ], [2, 2, 'current_config_backfill', false], 'filling a product cost must update historical cost facts automatically');

    const rawAfter = Number((await db.query('SELECT COUNT(*) FROM revenue')).rows[0].count);
    assert.equal(rawAfter, rawBefore + ids.length, 'migration must not rewrite or duplicate revenue');

    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]);
    await restoreConfig();
    await db.query(rollback);
    fallbackApplied = false;
    await db.query(baseRollback);
    baseApplied = false;
    console.log('PASS historical configured-cost sync: all categories, missing-cost governance, live completion, snapshot priority, idempotence and rollback.');
  } finally {
    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]).catch(() => {});
    await restoreConfig().catch(() => {});
    if (fallbackApplied) await db.query(rollback).catch(() => {});
    if (baseApplied) await db.query(baseRollback).catch(() => {});
    await db.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
