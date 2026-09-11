const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') throw new Error('Requires the dedicated local M6 database');
const base = process.env.M6_API_BASE || 'http://127.0.0.1:3132/rest/v1';
const expectedVersion = fs.readFileSync('VERSION', 'utf8').trim();
const tokens = {};
let checks = 0;

async function request(path, { method = 'GET', body, role = 'admin', expected = 200 } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  checks++;
  return data;
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  const sourceBefore = (await db.query(`SELECT
    (SELECT COUNT(*)::INTEGER FROM revenue) revenue_count,
    (SELECT COUNT(*)::INTEGER FROM expense) expense_count,
    (SELECT COUNT(*)::INTEGER FROM gallery_sales) gallery_count,
    (SELECT COUNT(*)::INTEGER FROM space_usage) space_count`)).rows[0];
  try {
    await db.query("DELETE FROM trial_run_issue_events WHERE issue_id IN (SELECT id FROM trial_run_issues WHERE title LIKE 'M606 %'); DELETE FROM trial_run_issues WHERE title LIKE 'M606 %'");
    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', { method: 'POST', role: 'none', body: { username: `m305-${role}`, password: cfg.password } })).token;
    }

    await request('runtime-observability', { role: 'none', expected: 401 });
    await request('runtime-observability', { role: 'viewer', expected: 403 });
    const baseline = await request('runtime-observability', { role: 'editor' });
    assert.equal(baseline.application.version, expectedVersion);
    assert.equal(baseline.database.ok, true);
    assert.equal(baseline.migration.forwardFiles, 20);
    assert.equal(baseline.migration.rollbackFiles, 16);
    assert.deepEqual(baseline.migration.missingRelations, []);
    assert.equal(baseline.requests.slowThresholdMs > 0, true);
    const initialCritical = baseline.issues.openCritical;

    await request('trial-run-issues', { role: 'viewer', expected: 403 });
    await request('trial-run-issues', { method: 'POST', role: 'editor', expected: 400, body: { severity: 'P5', title: '无效问题', evidence: '无效证据', impact: '无效影响', owner: '测试' } });
    const created = await request('trial-run-issues', { method: 'POST', role: 'editor', expected: 201, body: {
      severity: 'P1', title: 'M606 核心接口观测异常', evidence: '本地自动化构造的可复验证据',
      impact: '用于验证 P1 会阻断 G0', owner: 'M606负责人', dueDate: '2026-09-12', reportedBy: 'm305-viewer'
    } });
    assert.match(created.id, /^tri_/);
    const reported = (await db.query('SELECT reported_by FROM trial_run_issues WHERE id=$1', [created.id])).rows[0];
    assert.equal(reported.reported_by, 'm305-editor', 'Reporter must come from the authenticated session');

    const blocked = await request('runtime-observability');
    assert.equal(blocked.issues.openCritical, initialCritical + 1);
    assert.equal(blocked.gate.ready, false);
    assert.match(blocked.gate.blockers.join(' '), /P0\/P1/);

    await request(`trial-run-issues?id=${created.id}&action=assign`, { method: 'POST', role: 'editor', body: { owner: '修正负责人', dueDate: '2026-09-13' } });
    await request(`trial-run-issues?id=${created.id}&action=verify`, { method: 'POST', role: 'editor', expected: 403, body: { verificationResult: '编辑越权复验' } });
    await request(`trial-run-issues?id=${created.id}&action=fix`, { method: 'POST', role: 'editor', body: { fixVersion: '2.0.0-dev.m6-06.test1', fixNotes: '完成本地修正并附专项测试' } });
    const stillBlocked = await request('runtime-observability');
    assert.equal(stillBlocked.issues.openCritical, initialCritical + 1, 'Fixed remains blocking until verification');
    await request(`trial-run-issues?id=${created.id}&action=verify`, { method: 'POST', role: 'admin', body: { verificationResult: '管理员复验接口、权限和状态均通过' } });
    assert.equal((await request('runtime-observability')).issues.openCritical, initialCritical);

    await request(`trial-run-issues?id=${created.id}&action=reopen`, { method: 'POST', role: 'editor', body: { reason: '复验后模拟再次出现同类问题' } });
    assert.equal((await request('runtime-observability')).issues.openCritical, initialCritical + 1);
    await request(`trial-run-issues?id=${created.id}&action=fix`, { method: 'POST', role: 'editor', body: { fixVersion: '2.0.0-dev.m6-06.test2', fixNotes: '补充修正并重新运行专项检查' } });
    await request(`trial-run-issues?id=${created.id}&action=verify`, { method: 'POST', role: 'admin', body: { verificationResult: '重新复验通过，问题关闭' } });

    const issues = await request('trial-run-issues', { role: 'editor' });
    const issue = issues.find(row => row.id === created.id);
    assert.equal(issue.status, 'verified');
    assert.equal(issue.eventCount, 7);
    assert.deepEqual(issue.events.map(event => event.action), ['create', 'assign', 'fix', 'verify', 'reopen', 'fix', 'verify']);
    assert.equal(issue.events[0].actorId, 'm305-editor');
    assert.equal(issue.events.at(-1).actorId, 'm305-admin');

    await request('revenue?m606_missing_column=eq.test', { role: 'editor', expected: 500 });
    const observed = await request('runtime-observability');
    assert.ok(observed.requests.serverErrors >= 1);
    assert.ok(observed.requests.recentErrors.some(row => row.path === '/rest/v1/revenue' && row.status === 500));
    assert.ok(Number.isFinite(observed.requests.p50Ms) && Number.isFinite(observed.requests.p95Ms));
    assert.equal(observed.gate.ready, initialCritical === 0);

    await db.query('DELETE FROM trial_run_issue_events WHERE issue_id=$1', [created.id]);
    await db.query('DELETE FROM trial_run_issues WHERE id=$1', [created.id]);
    const sourceAfter = (await db.query(`SELECT
      (SELECT COUNT(*)::INTEGER FROM revenue) revenue_count,
      (SELECT COUNT(*)::INTEGER FROM expense) expense_count,
      (SELECT COUNT(*)::INTEGER FROM gallery_sales) gallery_count,
      (SELECT COUNT(*)::INTEGER FROM space_usage) space_count`)).rows[0];
    assert.deepEqual(sourceAfter, sourceBefore);

    const result = { passed: true, checks, runtimeHealth: true, migrationState: true, requestMetrics: true, issueLifecycleEvents: 7, trustedActors: true, g0CriticalGate: true, sourceFactsUnchanged: true };
    fs.writeFileSync('tmp/m6-06-observability-result.json', JSON.stringify(result, null, 2));
    console.log(`PASS ${checks} HTTP checks: runtime health, migration state, request metrics, P1 gate and issue fix/reverify lifecycle`);
    console.log(JSON.stringify(result));
  } finally {
    await db.query("DELETE FROM trial_run_issue_events WHERE issue_id IN (SELECT id FROM trial_run_issues WHERE title LIKE 'M606 %'); DELETE FROM trial_run_issues WHERE title LIKE 'M606 %'").catch(() => {});
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
