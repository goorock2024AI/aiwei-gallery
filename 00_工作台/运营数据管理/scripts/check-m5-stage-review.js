const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Requires the dedicated local M5 test database');
}

const base = process.env.M5_API_BASE || 'http://127.0.0.1:3127/rest/v1';
const tokens = {};
let checks = 0;

async function request(path, { method = 'GET', body, role = 'editor', expected = 200 } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  checks++;
  return { data, headers: response.headers };
}

async function sourceSnapshot(db) {
  return (await db.query(`SELECT
    (SELECT COUNT(*) FROM revenue)::INTEGER revenue_count,
    (SELECT COALESCE(SUM(ticket_amount+combo_amount+coffee_amount+workshop_amount+retail_amount+creative_amount+venue_amount+other_amount),0) FROM revenue)::NUMERIC(16,2) revenue_amount,
    (SELECT COUNT(*) FROM expense)::INTEGER expense_count,
    (SELECT COALESCE(SUM(amount),0) FROM expense)::NUMERIC(16,2) expense_amount,
    (SELECT COUNT(*) FROM gallery_sales)::INTEGER gallery_count,
    (SELECT COALESCE(SUM(price-refund_amount),0) FROM gallery_sales)::NUMERIC(16,2) gallery_amount,
    (SELECT COUNT(*) FROM space_usage)::INTEGER space_count,
    (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage)::NUMERIC(16,2) space_receivable,
    (SELECT COUNT(*) FROM space_payments)::INTEGER payment_count,
    (SELECT COALESCE(SUM(amount),0) FROM space_payments)::NUMERIC(16,2) payment_amount,
    (SELECT COUNT(*) FROM daily_closings)::INTEGER closing_count,
    (SELECT COALESCE(SUM(system_net_amount),0) FROM daily_closings)::NUMERIC(16,2) closing_amount`)).rows[0];
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  try {
    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', {
        method: 'POST', role: 'none', body: { username: `m305-${role}`, password: cfg.password }
      })).data.token;
    }

    const before = await sourceSnapshot(db);
    const dimensions = (await request('business_dimensions?order=sort_order.asc&limit=100&count=none')).data;
    const dimensionCounts = Object.fromEntries(['business_layer', 'business_type', 'cost_type', 'capability_axis']
      .map(type => [type, dimensions.filter(row => row.dimensionType === type).length]));
    assert.equal(dimensions.length, 28);
    assert.deepEqual(dimensionCounts, { business_layer: 4, business_type: 11, cost_type: 10, capability_axis: 3 });
    assert.deepEqual(dimensions.filter(row => row.dimensionType === 'business_layer').map(row => row.code),
      ['visit', 'onsite_consumption', 'experience_activity', 'art_transaction_cooperation']);

    const summaries = (await db.query(`SELECT period_month,business_layer_code,revenue_amount,sales_cost_amount,
      period_cost_amount,total_cost_amount,gross_profit,gross_margin,operating_contribution
      FROM business_layer_summary_v2 ORDER BY period_month,business_layer_code`)).rows;
    assert.ok(summaries.length > 0, 'Expected summary fixtures');
    for (const row of summaries) {
      const revenue = Number(row.revenue_amount);
      const salesCost = Number(row.sales_cost_amount);
      const periodCost = Number(row.period_cost_amount);
      assert.equal(Number(row.total_cost_amount), salesCost + periodCost);
      assert.equal(Number(row.gross_profit), revenue - salesCost);
      assert.equal(Number(row.operating_contribution), revenue - salesCost - periodCost);
      if (revenue === 0) assert.equal(row.gross_margin, null);
      else assert.ok(Math.abs(Number(row.gross_margin) - (revenue - salesCost) / revenue) < 0.0000001);
    }

    const baseline = (await db.query(`SELECT period_month,issue_type,source_table,issue_count,affected_amount
      FROM data_governance_baseline_v2 ORDER BY 1,2,3`)).rows;
    const detail = (await db.query(`SELECT LEFT(business_date,7) period_month,issue_type,source_table,
      COUNT(*)::INTEGER issue_count,COALESCE(SUM(ABS(amount)),0)::NUMERIC(14,2) affected_amount
      FROM data_governance_issues_v2 GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows;
    assert.deepEqual(baseline, detail, 'Governance baseline must reconcile to issue details');

    const auditedViews = [
      'business_layer_summary_v2', 'business_revenue_facts_v2',
      'business_cost_facts_v2', 'business_profit_facts_v2',
      'data_governance_baseline_v2', 'data_governance_issues_v2', 'product_alias_candidates_v2',
      'product_master_governance_v2', 'product_cost_evidence_v2', 'revenue_attribution_candidates_v2',
      'cost_attribution_candidates_v2', 'gallery_link_candidates_v2', 'workshop_link_candidates_v2',
      'space_classification_candidates_v2', 'governance_batch_summary_v2'
    ];
    for (const view of auditedViews) {
      await request(`${view}?limit=1&count=none`);
      await request(`${view}?limit=1&count=none`, { role: 'viewer', expected: 403 });
      await request(`${view}?limit=1&count=none`, { role: 'none', expected: 401 });
      await request(view, { method: 'POST', role: 'admin', body: { id: 'm509-forbidden' }, expected: 405 });
    }

    const noCount = await request('business_dimensions?limit=1&count=none');
    assert.equal(noCount.headers.has('content-range'), false);
    const withCount = await request('business_dimensions?limit=1');
    assert.equal(withCount.headers.has('content-range'), true);
    assert.deepEqual(await sourceSnapshot(db), before, 'M5 stage review must not alter original facts');

    const result = {
      passed: true,
      checks,
      summaryRows: summaries.length,
      governanceIssueGroups: detail.length,
      dimensions: dimensionCounts,
      protectedViews: auditedViews.length,
      sourceFactsUnchanged: true
    };
    fs.writeFileSync('tmp/m5-09-stage-review-result.json', JSON.stringify(result, null, 2));
    console.log(`PASS ${checks} HTTP checks: M5 metric equations, governance reconciliation, 28 dimensions, read-only permissions and unchanged source facts`);
    console.log(JSON.stringify(result));
  } finally {
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
