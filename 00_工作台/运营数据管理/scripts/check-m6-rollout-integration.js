const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Requires the dedicated local M6 regression database');
}

const base = process.env.M6_API_BASE || 'http://127.0.0.1:3131/rest/v1';
const tokens = {};
let checks = 0;

async function request(path, { method = 'GET', body, role = 'admin', expected = 200 } = {}) {
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

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  const original = (await db.query("SELECT value,updated_at FROM app_config WHERE key='operations_rollout'")).rows[0] || null;
  try {
    await db.query("DELETE FROM operation_logs WHERE action='operations_rollout_change' AND record_id='operations_rollout'");
    await db.query(`INSERT INTO app_config(key,value,updated_at) VALUES('operations_rollout','{"mode":"off"}'::jsonb,NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`);

    for (const role of ['admin', 'editor', 'viewer']) {
      tokens[role] = (await request('login', {
        method: 'POST', role: 'none', body: { username: `m305-${role}`, password: cfg.password }
      })).token;
    }

    await request('operations-rollout', { role: 'none', expected: 401 });
    for (const role of ['admin', 'editor', 'viewer']) {
      const rollout = await request('operations-rollout', { role });
      assert.equal(rollout.mode, 'off');
      assert.equal(rollout.enabled, false);
      assert.equal(rollout.role, role);
    }
    await request('operations-rollout', { method: 'POST', role: 'editor', expected: 403, body: { mode: 'staff', reason: '编辑越权测试' } });
    await request('operations-rollout', { method: 'POST', role: 'viewer', expected: 403, body: { mode: 'staff', reason: '只读越权测试' } });
    await request('operations-rollout', { method: 'POST', expected: 400, body: { mode: 'public', reason: '非法范围测试' } });
    await request('operations-rollout', { method: 'POST', expected: 400, body: { mode: 'admin', reason: '短' } });

    await request('app_config', { method: 'POST', expected: 405, body: { key: 'operations_rollout', value: { mode: 'staff' } } });
    await request('app_config?key=eq.operations_rollout', { method: 'PATCH', expected: 405, body: { value: { mode: 'staff' } } });
    await request('app_config?key=eq.ticket_products', { method: 'PATCH', expected: 405, body: { key: 'operations_rollout' } });
    await request('app_config?key=eq.operations_rollout', { method: 'DELETE', expected: 405 });

    const adminMode = await request('operations-rollout', { method: 'POST', body: { mode: 'admin', reason: '启动管理员试运行' } });
    assert.equal(adminMode.previousMode, 'off');
    assert.equal(adminMode.enabled, true);
    assert.equal((await request('operations-rollout', { role: 'editor' })).enabled, false);
    assert.equal((await request('operations-rollout', { role: 'viewer' })).enabled, false);
    await request('operations-rollout', { method: 'POST', expected: 409, body: { mode: 'admin', reason: '重复模式测试' } });

    const staffMode = await request('operations-rollout', { method: 'POST', body: { mode: 'staff', reason: '扩大至内部员工试运行' } });
    assert.equal(staffMode.previousMode, 'admin');
    assert.equal((await request('operations-rollout', { role: 'editor' })).enabled, true);
    assert.equal((await request('operations-rollout', { role: 'viewer' })).enabled, false);

    await request('operations-rollout', { method: 'POST', body: { mode: 'off', reason: '完成验证后关闭入口' } });
    await request('business_layer_summary_v2?limit=1&count=none', { role: 'editor' });
    await request('business_layer_summary_v2?limit=1&count=none', { role: 'viewer', expected: 403 });
    await request('revenue?limit=1&count=none', { role: 'viewer' });

    const logs = (await db.query(`SELECT user_id,details FROM operation_logs
      WHERE action='operations_rollout_change' AND record_id='operations_rollout' ORDER BY created_at,id`)).rows;
    assert.equal(logs.length, 3, 'Exactly three real transitions must be audited');
    assert.ok(logs.every(row => row.user_id === 'm305-admin'), 'Audit actor must come from the authenticated session');
    assert.deepEqual(logs.map(row => [row.details.oldMode, row.details.newMode]), [
      ['off', 'admin'], ['admin', 'staff'], ['staff', 'off']
    ]);
    assert.ok(logs.every(row => String(row.details.reason || '').length >= 4));

    const result = {
      passed: true,
      checks,
      modes: ['off', 'admin', 'staff'],
      roleMatrix: true,
      genericWriteBypassBlocked: true,
      trustedAuditTransitions: logs.length,
      sensitiveApiRoleBoundaryPreserved: true,
      legacyModuleUnaffected: true
    };
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync('tmp/m6-05-rollout-result.json', JSON.stringify(result, null, 2));
    console.log(`PASS ${checks} HTTP checks: rollout modes, role matrix, bypass protection, audit and 1.0 isolation`);
    console.log(JSON.stringify(result));
  } finally {
    await db.query("DELETE FROM operation_logs WHERE action='operations_rollout_change' AND record_id='operations_rollout'").catch(() => {});
    if (original) {
      await db.query(`INSERT INTO app_config(key,value,updated_at) VALUES('operations_rollout',$1,$2)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, [original.value, original.updated_at]);
    } else {
      await db.query("DELETE FROM app_config WHERE key='operations_rollout'").catch(() => {});
    }
    await db.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
