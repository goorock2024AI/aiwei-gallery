#!/usr/bin/env node
// Requires the isolated local M3 test database and API on port 3106. Never use production data.
const fs = require('fs');
const assert = require('assert/strict');
const { Client } = require('pg');
const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') throw new Error('Requires the dedicated local M3 test database');
const tokens = {};
let checks = 0;
async function request(path, method = 'GET', body, role = 'editor', status = 200) {
  const response = await fetch('http://127.0.0.1:3106/rest/v1/' + path, { method, headers: { 'Content-Type': 'application/json', ...(tokens[role] ? { Authorization: 'Bearer ' + tokens[role] } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(json));
  checks++;
  return json;
}
(async () => {
  const db = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: 'postgres' });
  await db.connect();
  try {
    for (const role of ['admin', 'editor', 'viewer']) tokens[role] = (await request('login', 'POST', { username: 'm305-' + role, password: cfg.password }, 'none')).token;
    await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm306-%'; DELETE FROM record_business_links WHERE source_id LIKE 'm306-%'; DELETE FROM expense WHERE id LIKE 'm306-%'; DELETE FROM revenue WHERE id LIKE 'm306-%'");
    await request('workshop_project_performance_v2', 'GET', undefined, 'none', 401);
    await request('workshop_project_performance_v2', 'GET', undefined, 'viewer', 403);
    await request('workshop_project_performance_v2', 'POST', {}, 'editor', 403);
    await request('workshop_project_performance_v2', 'POST', {}, 'admin', 405);
    const line = { productName: '果壳风铃', projectName: 'M306亲子木刻', activityTypeCode: 'workshop', participantCount: 3, qty: 3, unitPrice: 128, discount: 30, amount: 354, snapshotVersion: 1 };
    await request('revenue', 'POST', { id: 'm306-revenue', date: '2026-09-06', workshopItems: [line], workshopAmount: 354, projectName: line.projectName, paymentMethod: '扫码支付', accountAmount: 354, status: '正常' }, 'editor', 201);
    const revenueFact = (await request('business_revenue_facts_v2?source_id=eq.m306-revenue'))[0];
    assert.equal(revenueFact.businessLayerCode, 'experience_activity');
    assert.equal(revenueFact.businessTypeCode, 'workshop');
    assert.equal(revenueFact.projectName, 'M306亲子木刻');
    assert.equal(revenueFact.quantity, 3);
    await request('expense-entry', 'POST', { expense: { id: 'm306-cost', date: '2026-09-06', project: 'M306亲子木刻', category: '物料耗材', amount: 100, description: '木刻材料' }, classification: { mode: 'manual', costTypeCode: 'activity_execution', businessLayerCode: 'experience_activity', businessTypeCode: 'workshop', capabilityAxisCode: 'content_ip', overrideReason: '项目直接材料' } }, 'editor', 201);
    await request('revenue', 'POST', { id: 'm306-revenue-aug', date: '2026-08-31', workshopItems: [{ ...line, participantCount: 1, qty: 1, discount: 0, amount: 128 }], workshopAmount: 128, projectName: line.projectName, status: '正常' }, 'editor', 201);
    await request('expense-entry', 'POST', { expense: { id: 'm306-cost-aug', date: '2026-08-31', project: 'M306亲子木刻', category: '物料耗材', amount: 50, description: '八月材料' }, classification: { mode: 'manual', costTypeCode: 'activity_execution', businessLayerCode: 'experience_activity', businessTypeCode: 'workshop', capabilityAxisCode: 'content_ip' } }, 'editor', 201);
    let project = (await request('workshop_project_performance_v2?activity_month=eq.2026-09&project_key=eq.' + encodeURIComponent('m306亲子木刻')))[0];
    assert.equal(project.participantCount, 3);
    assert.equal(project.revenueAmount, 354);
    assert.equal(project.directCostAmount, 100);
    assert.equal(project.contributionAmount, 254);
    assert.equal(project.missingDirectCost, false);
    const august = (await request('workshop_project_performance_v2?activity_month=eq.2026-08&project_key=eq.' + encodeURIComponent('m306亲子木刻')))[0];
    assert.equal(august.participantCount, 1);
    assert.equal(august.revenueAmount, 128);
    assert.equal(august.directCostAmount, 50);
    await request('revenue', 'POST', { id: 'm306-no-cost', date: '2026-09-06', workshopItems: [{ ...line, projectName: 'M306待补成本', participantCount: 2, qty: 2, amount: 256 }], workshopAmount: 256, projectName: 'M306待补成本', status: '正常' }, 'admin', 201);
    project = (await request('workshop_project_performance_v2?activity_month=eq.2026-09&project_key=eq.' + encodeURIComponent('m306待补成本')))[0];
    assert.equal(project.missingDirectCost, true);
    assert.equal(project.directCostAmount, 0);
    await request('revenue', 'POST', { id: 'm306-legacy', date: '2026-09-06', workshopItems: [{ name: '旧工坊', qty: 1, price: 50, amount: 50 }], workshopAmount: 50, status: '正常' }, 'editor', 201);
    const legacy = (await request('business_revenue_facts_v2?source_id=eq.m306-legacy'))[0];
    assert.equal(legacy.qualityFlags.missing_project, true);
    const projects = await request('workshop_project_performance_v2?project_key=eq.');
    assert.equal(projects.length, 0);
    console.log('PASS ' + checks + ' HTTP checks: permissions, workshop snapshots, project revenue, direct costs, missing-cost and legacy governance.');
  } finally { await db.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
