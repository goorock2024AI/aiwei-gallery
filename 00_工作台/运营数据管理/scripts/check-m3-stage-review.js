const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
const base = process.env.M3_API_BASE || 'http://127.0.0.1:3110/rest/v1';

async function request(path, method = 'GET', body, token, expected = 200) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  try {
    const tokens = {};
    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', 'POST', { username: `m305-${role}`, password: cfg.password })).token;
    }

    await db.query("DELETE FROM operation_logs WHERE record_id='m310-audit'; DELETE FROM daily_closings WHERE id='m310-close'");
    await request('operation-log', 'POST', { action: 'create', tableName: 'revenue', recordId: 'm310-audit', details: { source: 'stage-review' }, user_id: 'spoofed-user' }, undefined, 401);
    await request('operation-log', 'POST', { action: 'create', tableName: 'revenue', recordId: 'm310-audit', details: { source: 'stage-review' }, user_id: 'spoofed-user' }, tokens.viewer, 403);
    await request('operation-log', 'POST', { action: 'create', tableName: 'revenue', recordId: 'm310-audit', details: { source: 'stage-review' }, user_id: 'spoofed-user' }, tokens.editor, 201);
    const audit = (await db.query("SELECT user_id,details FROM operation_logs WHERE record_id='m310-audit'")).rows[0];
    assert.equal(audit.user_id, 'm305-editor');
    assert.equal(audit.details.source, 'stage-review');

    const factsBefore = await db.query("SELECT count(*)::int count,coalesce(sum(net_amount),0)::numeric total FROM revenue_facts WHERE date='2026-09-05'");
    const v2Before = await db.query("SELECT count(*)::int count FROM business_revenue_facts_v2 WHERE business_date='2026-09-05'");
    const net = Number(factsBefore.rows[0].total);
    await request('daily_closings', 'POST', {
      id: 'm310-close', date: '2026-09-05', systemNetAmount: net, confirmedAmount: net,
      differenceAmount: 0, revenueSummary: { facts: factsBefore.rows[0].count }, paymentSummary: {},
      expenseSummary: {}, adjustmentSummary: {}, cashSummary: {}, closerId: 'm305-editor',
      closerName: 'M3-10', reviewerName: '', status: '已确认', notes: 'M3-10 local verification'
    }, tokens.editor, 201);
    const saved = await request('daily_closings?id=eq.m310-close', 'GET', undefined, tokens.editor);
    assert.equal(saved[0].systemNetAmount, net);
    assert.equal(saved[0].differenceAmount, 0);
    const factsAfter = await db.query("SELECT count(*)::int count,coalesce(sum(net_amount),0)::numeric total FROM revenue_facts WHERE date='2026-09-05'");
    const v2After = await db.query("SELECT count(*)::int count FROM business_revenue_facts_v2 WHERE business_date='2026-09-05'");
    assert.deepEqual(factsAfter.rows, factsBefore.rows);
    assert.deepEqual(v2After.rows, v2Before.rows);

    for (const view of ['business_revenue_facts_v2', 'business_cost_facts_v2', 'business_profit_facts_v2', 'workshop_project_performance_v2', 'gallery_transaction_performance_v2', 'space_project_performance_v2', 'business_layer_summary_v2', 'data_governance_issues_v2']) {
      await request(`${view}?limit=1`, 'GET', undefined, tokens.editor);
      await request(view, 'POST', { id: 'm310-forbidden' }, tokens.admin, 405);
    }
    await request('business_layer_summary_v2?limit=1', 'GET', undefined, tokens.viewer, 403);
    console.log(`PASS M3 stage review: trusted audit, 1.0 daily closing (${net}), v2 facts, permissions and read-only boundaries`);
  } finally {
    await db.query("DELETE FROM operation_logs WHERE record_id='m310-audit'; DELETE FROM daily_closings WHERE id='m310-close'");
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
