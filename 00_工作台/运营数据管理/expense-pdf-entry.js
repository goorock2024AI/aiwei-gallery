const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// One transaction serializes package numbering and duplicate checks. Raw costs are never changed.
module.exports = function createExpensePdfHandler({ pool, collectJSON, getRequester, ensureRole,
  sendError, sendJSON, toCamel, directory, nextTitle, generateFile }) {
  async function sourceSnapshot(client, pack) {
    if (pack.snapshot?.expenses) return pack.snapshot;
    const audit = (await client.query(`SELECT details FROM operation_logs
      WHERE table_name='expense_reimbursements' AND record_id=$1 AND action='create'
      ORDER BY created_at ASC LIMIT 1`, [pack.id])).rows[0]?.details;
    if (Array.isArray(audit?.expenses)) return { expenses: audit.expenses, attachments: audit.attachments || [], materialNote: audit.materialNote || '' };
    // Without a trustworthy snapshot we cannot promise to preserve the other PDF entries.
    const e = new Error('此历史凭证缺少生成时明细，暂不能安全修改；请核对原 PDF 后联系管理员处理'); e.status = 409; throw e;
  }
  return function handleExpensePdfGenerate(req, res, query = {}) {
    if (req.method === 'GET') {
      return (async () => {
        try {
          const user = await getRequester(req);
          if (!ensureRole(res, user, ['admin', 'editor'])) return;
          const pack = (await pool.query('SELECT * FROM expense_reimbursements WHERE id=$1', [String(query.id || '')])).rows[0];
          if (!pack) return sendError(res, 404, '报销凭证包不存在');
          const snapshot = await sourceSnapshot(pool, pack);
          sendJSON(res, 200, { package: toCamel(pack), expenses: snapshot.expenses.map(toCamel), materialNote: snapshot.materialNote || '' });
        } catch (e) { sendError(res, e.status || 500, e.message); }
      })();
    }
    collectJSON(req, async (error, body) => {
      if (error || !body || typeof body !== 'object') return sendError(res, 400, 'JSON 格式不正确');
      let client, outputPath;
      try {
        const user = await getRequester(req);
        if (!ensureRole(res, user, ['admin', 'editor'])) return;
        const ids = Array.isArray(body.expenseIds) ? [...new Set(body.expenseIds)] : [];
        if (!ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) {
          return sendError(res, 400, '请选择 1 至 50 笔有效支出');
        }
        const note = String(body.materialNote || '').trim();
        if (note.length > 500) return sendError(res, 400, '材料说明最多 500 字');
        const revisionId = body.revisionOf;
        const reason = String(body.revisionReason || '').trim();
        if (revisionId !== undefined && (typeof revisionId !== 'string' || !revisionId || revisionId.length > 100 || !reason || reason.length > 500)) {
          return sendError(res, 400, '请选择原报销单并填写 1 至 500 字修改原因');
        }
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('expense-pdf-package'))");
        let original, originalSnapshot;
        if (revisionId) {
          original = (await client.query('SELECT * FROM expense_reimbursements WHERE id=$1 FOR UPDATE', [revisionId])).rows[0];
          if (!original) { const e = new Error('原报销单不存在'); e.status = 404; throw e; }
          if (original.superseded_by_id) { const e = new Error('此报销单已被替代，请刷新并修改最新版本'); e.status = 409; throw e; }
          if (ids.length >= original.expense_ids.length || ids.some(id => !original.expense_ids.includes(id))) {
            const e = new Error('本次修改仅支持移除部分支出，须至少保留一笔'); e.status = 400; throw e;
          }
          originalSnapshot = await sourceSnapshot(client, original);
        }
        const expenses = originalSnapshot ? originalSnapshot.expenses.filter(r => ids.includes(r.id)) :
          (await client.query('SELECT * FROM expense WHERE id = ANY($1::text[]) ORDER BY date ASC, id ASC FOR UPDATE', [ids])).rows;
        if (expenses.length !== ids.length || expenses.some(r => r.type === '备用金借入')) {
          const e = new Error('所选支出不存在或包含备用金借入，请刷新后重新选择'); e.status = 400; throw e;
        }
        const existing = (await client.query('SELECT id FROM expense_reimbursements WHERE superseded_by_id IS NULL AND expense_ids ?| $1::text[]', [ids])).rows;
        if (!revisionId && existing.length && body.regenerate !== true) {
          const e = new Error('所选支出已生成凭证，请下载原凭证或明确选择重新生成'); e.status = 409; throw e;
        }
        const attachments = originalSnapshot ? originalSnapshot.attachments.filter(r => ids.includes(r.expense_id)) :
          (await client.query('SELECT * FROM expense_attachments WHERE expense_id = ANY($1::text[]) ORDER BY expense_id ASC, attachment_type ASC, created_at ASC', [ids])).rows;
        const materialNote = originalSnapshot ? originalSnapshot.materialNote || note : note;
        const byExpense = {};
        for (const attachment of attachments) (byExpense[attachment.expense_id] ||= []).push(attachment);
        const missing = expenses.filter(r => {
          const rows = byExpense[r.id] || [];
          return (!rows.some(a => a.attachment_type === 'invoice') && r.invoice_status !== '不需要') ||
            (!rows.some(a => a.attachment_type === 'payment') && r.receipt_status !== '不需要');
        });
        if (missing.length && !materialNote) {
          const e = new Error('部分支出票据不齐，请补充材料或填写无法提供的说明'); e.status = 400; throw e;
        }
        const title = await nextTitle(client);
        const id = 'pdf_' + crypto.randomUUID();
        const filename = title + '.pdf';
        outputPath = path.join(directory, filename);
        const generatedBy = user.display_name || user.displayName || user.username || user.id;
        await generateFile(outputPath, expenses, byExpense, { title, materialNote, generatedBy,
          supersedesTitle: original?.title, revisionReason: reason });
        const stat = fs.statSync(outputPath);
        const total = expenses.reduce((cents, r) => cents + Math.round(Number(r.amount) * 100), 0) / 100;
        const saved = (await client.query(`INSERT INTO expense_reimbursements
          (id, expense_ids, title, total_amount, pdf_url, pdf_size, generated_by, supersedes_id, revision_reason, snapshot, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW()) RETURNING *`,
        [id, JSON.stringify(ids), title, total, '/uploads/expense-pdfs/' + encodeURIComponent(filename), stat.size, generatedBy,
          revisionId || null, revisionId ? reason : '', JSON.stringify({expenses, attachments, materialNote})])).rows[0];
        if (original) await client.query('UPDATE expense_reimbursements SET superseded_by_id=$1 WHERE id=$2', [id, original.id]);
        await client.query(`INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details)
          VALUES($1,$2,'create','expense_reimbursements',$3,$4::jsonb)`,
        [crypto.randomUUID(), user.id, id, JSON.stringify({ source: 'expense-pdf-entry', regenerate: body.regenerate === true,
          materialNote, expenses, attachments, package: saved, revisionOf: original?.id,
          revisionReason: original ? reason : undefined, removedExpenseIds: original?.expense_ids.filter(x => !ids.includes(x)) })]);
        await client.query('COMMIT');
        outputPath = null;
        sendJSON(res, 201, toCamel(saved));
      } catch (e) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (outputPath) { try { fs.unlinkSync(outputPath); } catch {} }
        sendError(res, e.status || 500, '生成 PDF 失败：' + e.message);
      } finally {
        if (client) client.release();
      }
    });
  };
};
