#!/usr/bin/env node
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Configured-sale cost integration only accepts the dedicated local test database');
}

const migration = fs.readFileSync('sql/20260920_configured_sale_cost_snapshots.sql', 'utf8');
const rollback = fs.readFileSync('sql/20260920_configured_sale_cost_snapshots_rollback.sql', 'utf8');
const ids = ['costsnap-main', 'costsnap-legacy', 'costsnap-zero'];

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  let applied = false;
  try {
    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]);
    const rawBefore = Number((await db.query('SELECT COUNT(*) FROM revenue')).rows[0].count);
    await db.query(migration);
    applied = true;
    await db.query(migration); // idempotence

    await db.query(`INSERT INTO revenue(
      id,date,ticket_qty,ticket_amount,ticket_items,combo_qty,combo_amount,
      coffee_qty,coffee_amount,coffee_items,workshop_items,workshop_amount,project_name,status
    ) VALUES(
      'costsnap-main','2026-12-20',2,20,
      '[{"name":"普通票","qty":2,"price":10,"amount":20,"costPriceSnapshot":3,"snapshotVersion":1},{"name":"套票","qty":1,"price":25,"amount":25,"costPriceSnapshot":7,"snapshotVersion":1}]',
      1,25,2,30,
      '[{"name":"手冲咖啡","qty":2,"price":15,"amount":30,"costPriceSnapshot":4,"snapshotVersion":1}]',
      '[{"productName":"果壳风铃","projectName":"成本快照工坊","activityTypeCode":"workshop","qty":3,"participantCount":3,"unitPrice":100,"amount":300,"costPriceSnapshot":20,"snapshotVersion":1}]',
      300,'成本快照工坊','正常'
    ),(
      'costsnap-legacy','2026-12-20',1,10,'[{"name":"普通票","qty":1,"price":10,"amount":10}]',
      0,0,0,0,'[]','[]',0,'','正常'
    ),(
      'costsnap-zero','2026-12-20',0,0,'[]',0,0,1,15,
      '[{"name":"零成本咖啡","qty":1,"price":15,"amount":15,"costPriceSnapshot":0,"snapshotVersion":1}]',
      '[]',0,'','正常'
    )`);

    const costs = (await db.query(`SELECT source_id,source_line_key,quantity,unit_cost,cost_amount
      FROM business_cost_facts_v2 WHERE source_id = ANY($1) ORDER BY source_id,source_line_key,unit_cost`, [ids])).rows;
    assert.equal(costs.length, 5);
    assert.equal(costs.filter(row => row.source_id === 'costsnap-legacy').length, 0, 'legacy rows must not be backfilled');
    assert.deepEqual(Object.fromEntries(costs.filter(row => row.source_id === 'costsnap-main')
      .map(row => [row.source_line_key, Number(row.cost_amount)])), { coffee: 8, combo: 7, ticket: 6, 'workshop:1': 60 });

    const summary = (await db.query(`SELECT business_layer_code,revenue_amount,sales_cost_amount,gross_profit
      FROM business_layer_summary_v2 WHERE period_month='2026-12' ORDER BY sort_order`)).rows;
    const visit = summary.find(row => row.business_layer_code === 'visit');
    const onsite = summary.find(row => row.business_layer_code === 'onsite_consumption');
    const workshop = summary.find(row => row.business_layer_code === 'experience_activity');
    assert.deepEqual([Number(visit.revenue_amount),Number(visit.sales_cost_amount),Number(visit.gross_profit)],[55,13,42]);
    assert.deepEqual([Number(onsite.revenue_amount),Number(onsite.sales_cost_amount),Number(onsite.gross_profit)],[45,8,37]);
    assert.deepEqual([Number(workshop.revenue_amount),Number(workshop.sales_cost_amount),Number(workshop.gross_profit)],[300,60,240]);

    const profits = (await db.query(`SELECT source_line_key,cost_amount,gross_profit FROM business_profit_facts_v2
      WHERE source_id='costsnap-main' ORDER BY source_line_key`)).rows;
    assert.equal(profits.find(row => row.source_line_key === 'ticket').cost_amount, '6');
    assert.equal(profits.find(row => row.source_line_key === 'workshop:1').gross_profit, '240');

    const issue = await db.query(`SELECT issue_type,priority FROM data_governance_issues_v2
      WHERE source_id='costsnap-zero' AND issue_type='missing_product_cost'`);
    assert.equal(issue.rowCount, 1);
    assert.equal(issue.rows[0].priority, 'P1');

    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM revenue')).rows[0].count), rawBefore);
    await db.query(rollback);
    applied = false;
    const objects = (await db.query(`SELECT
      to_regclass('business_cost_facts_v2') IS NOT NULL AS canonical,
      to_regclass('business_cost_facts_base_v2') IS NULL AS no_base,
      to_regclass('configured_sale_cost_facts_v2') IS NULL AS no_extension`)).rows[0];
    assert.deepEqual(objects, { canonical: true, no_base: true, no_extension: true });
    console.log('PASS configured-sale cost integration: facts, gross profit, zero-cost governance, idempotence and rollback.');
  } finally {
    await db.query('DELETE FROM revenue WHERE id = ANY($1)', [ids]).catch(() => {});
    if (applied) await db.query(rollback).catch(() => {});
    await db.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
