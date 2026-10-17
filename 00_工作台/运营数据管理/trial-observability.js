const fs = require('fs');
const crypto = require('crypto');

const REQUIRED_RELATIONS = [
  'business_dimensions', 'business_mapping_rules', 'product_aliases', 'record_business_links',
  'governance_batches', 'governance_batch_items', 'governance_batch_events',
  'trial_run_issues', 'trial_run_issue_events',
  'business_revenue_facts_v2', 'business_cost_facts_v2', 'business_profit_facts_v2',
  'workshop_project_performance_v2', 'gallery_transaction_performance_v2', 'space_project_performance_v2',
  'business_layer_summary_v2', 'data_governance_issues_v2', 'data_governance_baseline_v2',
  'product_alias_candidates_v2', 'product_cost_evidence_v2', 'product_master_governance_v2',
  'revenue_attribution_candidates_v2', 'cost_attribution_candidates_v2',
  'gallery_link_candidates_v2', 'workshop_link_candidates_v2',
  'space_classification_candidates_v2', 'governance_batch_summary_v2',
  'trial_run_issue_register_v2'
];

module.exports = function createTrialObservability({
  pool, getRequester, ensureRole, sendJSON, sendError, versionPath, manifestPath
}) {
  const startedAt = new Date();
  const recent = [];
  const routes = new Map();
  const slowThresholdMs = Math.max(1, Number(process.env.OBSERVABILITY_SLOW_MS || 1000));

  function appVersion() {
    if (process.env.APP_VERSION) return process.env.APP_VERSION;
    try { return fs.readFileSync(versionPath, 'utf8').trim(); } catch { return 'unknown'; }
  }

  function manifestState() {
    try {
      const bytes = fs.readFileSync(manifestPath);
      const manifest = JSON.parse(bytes.toString('utf8'));
      return {
        available: true,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        forwardFiles: manifest.forward?.length || 0,
        rollbackFiles: manifest.rollback?.length || 0,
        latestForward: manifest.forward?.at(-1)?.path || ''
      };
    } catch {
      return { available: false, sha256: '', forwardFiles: 0, rollbackFiles: 0, latestForward: '' };
    }
  }

  function observeRequest(req, res) {
    if (!String(req.url || '').startsWith('/rest/v1/')) return;
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const pathname = (() => { try { return new URL(req.url, 'http://localhost').pathname; } catch { return '/rest/v1/unknown'; } })();
      const status = Number(res.statusCode || 0);
      const key = `${req.method} ${pathname}`;
      const route = routes.get(key) || { method: req.method, path: pathname, count: 0, errorCount: 0, totalMs: 0, maxMs: 0 };
      route.count++;
      route.totalMs += durationMs;
      route.maxMs = Math.max(route.maxMs, durationMs);
      if (status >= 400) route.errorCount++;
      routes.set(key, route);
      recent.push({ at: new Date().toISOString(), method: req.method, path: pathname, status, durationMs });
      if (recent.length > 500) recent.shift();
      if (status >= 500 || durationMs >= slowThresholdMs) {
        console.warn('[trial-observability]', JSON.stringify({ method: req.method, path: pathname, status, durationMs: Math.round(durationMs) }));
      }
    });
  }

  function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  }

  function requestSnapshot() {
    const durations = recent.map(row => row.durationMs);
    const errorRows = recent.filter(row => row.status >= 400);
    const serverErrors = errorRows.filter(row => row.status >= 500);
    const slowRows = recent.filter(row => row.durationMs >= slowThresholdMs);
    return {
      windowSize: recent.length,
      totalSinceStart: [...routes.values()].reduce((sum, row) => sum + row.count, 0),
      clientErrors: errorRows.length - serverErrors.length,
      serverErrors: serverErrors.length,
      slowRequests: slowRows.length,
      slowThresholdMs,
      p50Ms: Math.round(percentile(durations, 0.5) * 10) / 10,
      p95Ms: Math.round(percentile(durations, 0.95) * 10) / 10,
      maxMs: Math.round((durations.length ? Math.max(...durations) : 0) * 10) / 10,
      recentErrors: errorRows.slice(-10).reverse().map(row => ({ ...row, durationMs: Math.round(row.durationMs * 10) / 10 })),
      recentSlow: slowRows.slice(-10).reverse().map(row => ({ ...row, durationMs: Math.round(row.durationMs * 10) / 10 })),
      routes: [...routes.values()].map(row => ({
        method: row.method, path: row.path, count: row.count, errorCount: row.errorCount,
        averageMs: Math.round(row.totalMs / row.count * 10) / 10,
        maxMs: Math.round(row.maxMs * 10) / 10
      })).sort((a, b) => b.count - a.count).slice(0, 20)
    };
  }

  async function handleRuntimeObservability(req, res) {
    const requester = await getRequester(req);
    if (!ensureRole(res, requester, ['admin', 'editor'])) return;
    if (req.method !== 'GET') return sendError(res, 405, '仅支持 GET');
    const checkedAt = new Date().toISOString();
    const dbStarted = process.hrtime.bigint();
    try {
      await pool.query('SELECT 1');
      const dbLatencyMs = Number(process.hrtime.bigint() - dbStarted) / 1e6;
      const relations = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1)`, [REQUIRED_RELATIONS])).rows.map(row => row.relname);
      const missingRelations = REQUIRED_RELATIONS.filter(name => !relations.includes(name));
      const rolloutRow = (await pool.query("SELECT value,updated_at FROM app_config WHERE key='operations_rollout'")).rows[0];
      const rolloutMode = ['off', 'admin', 'staff'].includes(rolloutRow?.value?.mode) ? rolloutRow.value.mode : 'off';
      const issueRows = (await pool.query(`SELECT severity,status,COUNT(*)::INTEGER count FROM trial_run_issues
        GROUP BY severity,status ORDER BY severity,status`)).rows;
      const openCritical = issueRows
        .filter(row => ['P0', 'P1'].includes(row.severity) && row.status !== 'verified')
        .reduce((sum, row) => sum + row.count, 0);
      const migration = { ...manifestState(), requiredRelations: REQUIRED_RELATIONS.length, presentRelations: relations.length, missingRelations };
      const g0Ready = missingRelations.length === 0 && openCritical === 0;
      return sendJSON(res, 200, {
        status: g0Ready ? 'ok' : 'degraded', checkedAt,
        application: { version: appVersion(), startedAt: startedAt.toISOString(), uptimeSeconds: Math.floor(process.uptime()) },
        database: { ok: true, latencyMs: Math.round(dbLatencyMs * 10) / 10 },
        migration,
        rollout: { mode: rolloutMode, updatedAt: rolloutRow?.updated_at || null },
        issues: { openCritical, bySeverityAndStatus: issueRows },
        requests: requestSnapshot(),
        gate: { name: 'G0', ready: g0Ready, blockers: [...missingRelations.map(name => `缺少结构 ${name}`), ...(openCritical ? [`${openCritical} 个 P0/P1 问题尚未复验`] : [])] }
      });
    } catch (error) {
      return sendJSON(res, 503, {
        status: 'down', checkedAt,
        application: { version: appVersion(), startedAt: startedAt.toISOString(), uptimeSeconds: Math.floor(process.uptime()) },
        database: { ok: false, latencyMs: 0, message: error.message },
        migration: { ...manifestState(), requiredRelations: REQUIRED_RELATIONS.length, presentRelations: 0, missingRelations: REQUIRED_RELATIONS },
        requests: requestSnapshot(),
        gate: { name: 'G0', ready: false, blockers: ['数据库或观测结构不可用'] }
      });
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString('utf8'));
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
      req.on('error', reject);
    });
  }

  function text(value, max = 2000) { return String(value || '').trim().slice(0, max); }
  function newId(prefix) { return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`; }

  async function event(client, issueId, action, fromStatus, toStatus, requester, details) {
    await client.query(`INSERT INTO trial_run_issue_events
      (id,issue_id,action,from_status,to_status,actor_id,actor_name,details,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())`, [
      newId('trie'), issueId, action, fromStatus, toStatus, requester.id,
      requester.displayName || requester.username || requester.id, JSON.stringify(details || {})
    ]);
  }

  async function handleTrialRunIssues(req, res, query) {
    const requester = await getRequester(req);
    if (!ensureRole(res, requester, ['admin', 'editor'])) return;
    if (req.method === 'GET') {
      try {
        const result = await pool.query(`SELECT * FROM trial_run_issue_register_v2
          ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          CASE status WHEN 'open' THEN 0 WHEN 'fixing' THEN 1 WHEN 'fixed' THEN 2 ELSE 3 END,reported_at DESC LIMIT 200`);
        return sendJSON(res, 200, result.rows.map(row => {
          const output = {};
          for (const [key, value] of Object.entries(row)) output[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
          return output;
        }));
      } catch (error) {
        return sendError(res, 500, '读取试运行问题台账失败：' + error.message);
      }
    }
    if (req.method !== 'POST') return sendError(res, 405, '仅支持 GET 和 POST');

    let input;
    try { input = await readBody(req); } catch { return sendError(res, 400, 'JSON 格式不正确'); }
    const action = text(query.action || 'create', 20);
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      if (action === 'create') {
        const severity = text(input.severity, 2);
        const title = text(input.title, 160);
        const evidence = text(input.evidence);
        const impact = text(input.impact, 1000);
        const owner = text(input.owner, 120);
        if (!['P0', 'P1', 'P2', 'P3'].includes(severity)) throw new Error('问题级别必须为 P0、P1、P2 或 P3');
        if (title.length < 4 || evidence.length < 4 || impact.length < 4 || !owner) throw new Error('标题、证据、影响和负责人必须完整填写');
        const id = newId('tri');
        await client.query(`INSERT INTO trial_run_issues
          (id,severity,title,evidence,impact,owner,due_date,status,reported_by,reported_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8,NOW(),NOW())`,
        [id, severity, title, evidence, impact, owner, input.dueDate || null, requester.id]);
        await event(client, id, 'create', '', 'open', requester, { severity, title, evidence, impact, owner, dueDate: input.dueDate || null });
        await client.query('COMMIT');
        return sendJSON(res, 201, { id, status: 'open' });
      }

      const id = text(query.id, 100);
      if (!id) throw new Error('缺少问题 ID');
      const found = await client.query('SELECT * FROM trial_run_issues WHERE id=$1 FOR UPDATE', [id]);
      if (!found.rows.length) { await client.query('ROLLBACK'); return sendError(res, 404, '问题不存在'); }
      const issue = found.rows[0];
      let nextStatus = issue.status;
      let details = {};
      if (action === 'assign') {
        if (!['open', 'fixing'].includes(issue.status)) throw new Error('只有待处理问题可以重新指派');
        const owner = text(input.owner, 120);
        if (!owner) throw new Error('负责人不能为空');
        nextStatus = issue.status === 'open' ? 'fixing' : issue.status;
        details = { owner, dueDate: input.dueDate || null };
        await client.query('UPDATE trial_run_issues SET owner=$2,due_date=$3,status=$4,updated_at=NOW() WHERE id=$1', [id, owner, input.dueDate || null, nextStatus]);
      } else if (action === 'fix') {
        if (!['open', 'fixing'].includes(issue.status)) throw new Error('只有待处理问题可以提交修正');
        const fixVersion = text(input.fixVersion, 80);
        const fixNotes = text(input.fixNotes);
        if (!fixVersion || fixNotes.length < 4) throw new Error('修正版本和修正说明必须完整填写');
        nextStatus = 'fixed'; details = { fixVersion, fixNotes };
        await client.query(`UPDATE trial_run_issues SET status='fixed',fix_version=$2,fix_notes=$3,fixed_by=$4,fixed_at=NOW(),verification_result='',verified_by='',verified_at=NULL,updated_at=NOW() WHERE id=$1`, [id, fixVersion, fixNotes, requester.id]);
      } else if (action === 'verify') {
        if (requester.role !== 'admin') { await client.query('ROLLBACK'); return sendError(res, 403, '仅管理员可完成复验'); }
        if (issue.status !== 'fixed') throw new Error('只有已修正问题可以复验');
        const result = text(input.verificationResult);
        if (result.length < 4) throw new Error('复验结果至少填写 4 个字符');
        nextStatus = 'verified'; details = { verificationResult: result };
        await client.query(`UPDATE trial_run_issues SET status='verified',verification_result=$2,verified_by=$3,verified_at=NOW(),updated_at=NOW() WHERE id=$1`, [id, result, requester.id]);
      } else if (action === 'reopen') {
        const reason = text(input.reason, 1000);
        if (!['fixed', 'verified'].includes(issue.status) || reason.length < 4) throw new Error('只有已修正/已复验问题可重开，且须填写原因');
        nextStatus = 'open'; details = { reason };
        await client.query(`UPDATE trial_run_issues SET status='open',verification_result='',verified_by='',verified_at=NULL,updated_at=NOW() WHERE id=$1`, [id]);
      } else {
        throw new Error('不支持的问题动作');
      }
      await event(client, id, action, issue.status, nextStatus, requester, details);
      await client.query('COMMIT');
      return sendJSON(res, 200, { id, previousStatus: issue.status, status: nextStatus });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return sendError(res, 400, error.message);
    } finally {
      client?.release();
    }
  }

  return { observeRequest, handleRuntimeObservability, handleTrialRunIssues, requestSnapshot, requiredRelations: REQUIRED_RELATIONS };
};
