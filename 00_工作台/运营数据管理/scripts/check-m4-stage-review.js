const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Requires the dedicated local M4 test database');
}

const base = process.env.M4_API_BASE || 'http://127.0.0.1:3120/rest/v1';
const tokens = {};
let checks = 0;

async function request(path, method = 'GET', body, role = 'editor', expected = 200) {
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
  return data;
}

async function sourceSnapshot(db) {
  const result = await db.query(`SELECT
    (SELECT COUNT(*) FROM revenue)::INTEGER revenue_count,
    (SELECT COALESCE(SUM(ticket_amount+combo_amount+coffee_amount+workshop_amount+retail_amount+creative_amount+venue_amount+other_amount),0) FROM revenue)::NUMERIC(16,2) revenue_amount,
    (SELECT COUNT(*) FROM expense)::INTEGER expense_count,
    (SELECT COALESCE(SUM(amount),0) FROM expense)::NUMERIC(16,2) expense_amount,
    (SELECT COUNT(*) FROM gallery_sales)::INTEGER gallery_count,
    (SELECT COALESCE(SUM(price-refund_amount),0) FROM gallery_sales)::NUMERIC(16,2) gallery_amount,
    (SELECT COUNT(*) FROM space_usage)::INTEGER space_count,
    (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage)::NUMERIC(16,2) space_receivable,
    (SELECT COUNT(*) FROM space_payments)::INTEGER space_payment_count,
    (SELECT COALESCE(SUM(amount),0) FROM space_payments)::NUMERIC(16,2) space_received,
    (SELECT COUNT(*) FROM daily_closings)::INTEGER closing_count,
    (SELECT COALESCE(SUM(system_net_amount),0) FROM daily_closings)::NUMERIC(16,2) closing_amount`);
  return result.rows[0];
}

async function cleanReviewBatch(db) {
  const ids = (await db.query("SELECT id FROM governance_batches WHERE name LIKE 'M410%'")).rows.map(row => row.id);
  if (ids.length) {
    await db.query('DELETE FROM operation_logs WHERE record_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM governance_batch_events WHERE batch_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM governance_batch_items WHERE batch_id=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM governance_batches WHERE id=ANY($1::text[])', [ids]);
  }
  await db.query(`DELETE FROM record_business_links
    WHERE id LIKE 'govlink_%' AND source_id IN ('m405-unique','m406-unique')`);
}

async function countCoverage(db, view, viewWhere, source, sourceWhere) {
  const candidates = Number((await db.query(`SELECT COUNT(*) FROM ${view} WHERE ${viewWhere}`)).rows[0].count);
  const sources = Number((await db.query(`SELECT COUNT(*) FROM ${source} WHERE ${sourceWhere}`)).rows[0].count);
  assert.ok(sources > 0, `${source} fixtures are missing`);
  assert.equal(candidates, sources, `${view} must cover every fixture source`);
  return { candidates, sources, rate: 100 };
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  try {
    await cleanReviewBatch(db);

    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', 'POST', {
        username: `m305-${role}`,
        password: cfg.password
      }, 'none')).token;
    }

    const baseline = (await db.query(`SELECT period_month,issue_type,source_table,issue_count,affected_amount
      FROM data_governance_baseline_v2 ORDER BY 1,2,3`)).rows;
    const detail = (await db.query(`SELECT LEFT(business_date,7) period_month,issue_type,source_table,
      COUNT(*)::INTEGER issue_count,COALESCE(SUM(ABS(amount)),0)::NUMERIC(14,2) affected_amount
      FROM data_governance_issues_v2 GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows;
    assert.deepEqual(baseline, detail, 'governance baseline must reconcile to issue details');
    assert.ok(detail.length > 0, 'governance issue fixtures are missing');

    const coverage = {
      productAliases: await countCoverage(db, 'product_alias_candidates_v2', "normalized_alias LIKE 'm403%'", 'revenue', "id LIKE 'm403-revenue-%'"),
      productMaster: await countCoverage(db, 'product_master_governance_v2', "product_id LIKE 'm404-%'", 'creative_products', "id LIKE 'm404-%'"),
      revenueAttribution: await countCoverage(db, 'revenue_attribution_candidates_v2', "source_id LIKE 'm405-%'", 'revenue', "id LIKE 'm405-%'"),
      costAttribution: await countCoverage(db, 'cost_attribution_candidates_v2', "source_id LIKE 'm406-%'", 'expense', "id LIKE 'm406-%'"),
      galleryLinks: await countCoverage(db, 'gallery_link_candidates_v2', "source_id LIKE 'm407-gallery-%'", 'gallery_sales', "id LIKE 'm407-gallery-%'"),
      workshopLinks: await countCoverage(db, 'workshop_link_candidates_v2', "source_id LIKE 'm407-workshop-%'", 'revenue', "id LIKE 'm407-workshop-%'"),
      spaceClassification: await countCoverage(db, 'space_classification_candidates_v2', "source_id LIKE 'm408-%'", 'space_usage', "id LIKE 'm408-%'")
    };

    const aliases = (await db.query("SELECT candidate_status,suggested_product_id FROM product_alias_candidates_v2 WHERE normalized_alias LIKE 'm403%' ORDER BY candidate_status")).rows;
    assert.ok(aliases.some(row => row.candidate_status === 'ambiguous' && !row.suggested_product_id));
    assert.ok(aliases.some(row => row.candidate_status === 'no_candidate' && !row.suggested_product_id));
    const productBoundary = (await db.query("SELECT suggested_historical_unit_cost FROM product_master_governance_v2 WHERE product_id='m404-current-only'")).rows[0];
    assert.equal(productBoundary.suggested_historical_unit_cost, null, 'current cost must not be backdated');
    const mixedSpace = (await db.query("SELECT business_type_requires_review FROM space_classification_candidates_v2 WHERE source_id='m408-exhibition'")).rows[0];
    assert.equal(mixedSpace.business_type_requires_review, true, 'mixed-use space history must stay in human review');

    const views = [
      'data_governance_issues_v2', 'data_governance_baseline_v2', 'product_alias_candidates_v2',
      'product_master_governance_v2', 'product_cost_evidence_v2', 'revenue_attribution_candidates_v2',
      'cost_attribution_candidates_v2', 'gallery_link_candidates_v2', 'workshop_link_candidates_v2',
      'space_classification_candidates_v2', 'governance_batch_summary_v2'
    ];
    for (const view of views) {
      await request(`${view}?limit=1`, 'GET', undefined, 'editor');
      await request(`${view}?limit=1`, 'GET', undefined, 'viewer', 403);
      await request(view, 'POST', { id: 'm410-forbidden' }, 'admin', 405);
    }

    const riskyCandidates = (await db.query(`SELECT candidate_id FROM revenue_attribution_candidates_v2
      WHERE source_id='m405-ambiguous' UNION ALL SELECT candidate_id FROM cost_attribution_candidates_v2
      WHERE source_id IN ('m406-ambiguous','m406-partial') ORDER BY candidate_id`)).rows;
    assert.equal(riskyCandidates.length, 3);
    for (const row of riskyCandidates) {
      await request('governance-batches?action=create', 'POST', {
        name: 'M410人工决定边界', candidateIds: [row.candidate_id]
      }, 'editor', 409);
    }

    const revenueCandidate = (await db.query("SELECT candidate_id FROM revenue_attribution_candidates_v2 WHERE source_id='m405-unique'")).rows[0].candidate_id;
    const costCandidate = (await db.query("SELECT candidate_id FROM cost_attribution_candidates_v2 WHERE source_id='m406-unique'")).rows[0].candidate_id;
    const before = await sourceSnapshot(db);
    const created = await request('governance-batches?action=create', 'POST', {
      name: 'M410阶段评审批次',
      description: '验证 M4 候选准入、审批、应用、审计和撤销',
      candidateIds: [revenueCandidate, costCandidate]
    }, 'editor', 201);
    const batchId = created.id;
    const preview = await request(`governance-batches?id=${batchId}&action=dry-run`, 'POST', {}, 'editor');
    assert.deepEqual({
      itemCount: preview.summary.itemCount,
      validItemCount: preview.summary.validItemCount,
      invalidItemCount: preview.summary.invalidItemCount,
      sourceFactsChanged: preview.summary.sourceFactsChanged
    }, { itemCount: 2, validItemCount: 2, invalidItemCount: 0, sourceFactsChanged: 0 });
    await request(`governance-batches?id=${batchId}&action=submit`, 'POST', {}, 'editor');
    await request(`governance-batches?id=${batchId}&action=approve`, 'POST', { note: '编辑者不能自批' }, 'editor', 403);
    await request(`governance-batches?id=${batchId}&action=approve`, 'POST', { note: 'M4-10 阶段评审批准' }, 'admin');
    const applied = await request(`governance-batches?id=${batchId}&action=apply`, 'POST', {}, 'admin');
    assert.equal(applied.status, 'applied');
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM record_business_links WHERE source_id IN ('m405-unique','m406-unique')")).rows[0].count), 2);
    assert.deepEqual(await sourceSnapshot(db), before, 'governance apply must not alter original facts or amounts');

    const actions = (await db.query('SELECT action,actor_id FROM governance_batch_events WHERE batch_id=$1 ORDER BY created_at,id', [batchId])).rows;
    assert.deepEqual(actions.map(row => row.action), ['create', 'dry_run', 'submit', 'approve', 'apply']);
    assert.deepEqual(new Set(actions.map(row => row.actor_id)), new Set(['m305-editor', 'm305-admin']));
    const logs = (await db.query('SELECT action,user_id FROM operation_logs WHERE record_id=$1 ORDER BY created_at,id', [batchId])).rows;
    assert.deepEqual(logs.map(row => row.action), ['governance_create', 'governance_dry_run', 'governance_submit', 'governance_approve', 'governance_apply']);
    assert.deepEqual(new Set(logs.map(row => row.user_id)), new Set(['m305-editor', 'm305-admin']));

    const reverted = await request(`governance-batches?id=${batchId}&action=revert`, 'POST', {}, 'admin');
    assert.equal(reverted.status, 'reverted');
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM record_business_links WHERE source_id IN ('m405-unique','m406-unique')")).rows[0].count), 0);
    assert.deepEqual(await sourceSnapshot(db), before, 'governance revert must preserve original facts and amounts');
    const finalEvent = (await db.query('SELECT action,actor_id FROM governance_batch_events WHERE batch_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [batchId])).rows[0];
    const finalLog = (await db.query('SELECT action,user_id FROM operation_logs WHERE record_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [batchId])).rows[0];
    assert.deepEqual(finalEvent, { action: 'revert', actor_id: 'm305-admin' });
    assert.deepEqual(finalLog, { action: 'governance_revert', user_id: 'm305-admin' });
    await request('governance-batches', 'GET', undefined, 'viewer', 403);

    const result = {
      passed: true,
      checks,
      governanceIssueGroups: detail.length,
      governanceIssueCount: detail.reduce((sum, row) => sum + Number(row.issue_count), 0),
      governanceAffectedAmount: detail.reduce((sum, row) => sum + Number(row.affected_amount), 0),
      coverage,
      workflow: ['create', 'dry_run', 'submit', 'approve', 'apply', 'revert'],
      sourceFactsUnchanged: true
    };
    fs.writeFileSync('tmp/m4-10-stage-review-result.json', JSON.stringify(result, null, 2));
    console.log(`PASS ${checks} HTTP checks: M4 coverage, human-decision boundaries, read-only permissions, trusted audit, reversible batch and unchanged source amounts`);
    console.log(JSON.stringify(result));
  } finally {
    await cleanReviewBatch(db).catch(() => {});
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
