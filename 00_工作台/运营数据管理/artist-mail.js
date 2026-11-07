'use strict';
const { randomUUID, createHash } = require('node:crypto');

function bad(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function string(v, max) {
  return String(v ?? '').replaceAll('\0', '').trim().slice(0, max);
}
function key(value) {
  if (!/^[a-z0-9:-]{1,120}$/i.test(value || '')) bad('无效邮件资料标识');
  return value;
}
function digest(v) {
  return createHash('sha256').update(v).digest('hex');
}
function safeLink(v) {
  try {
    const u = new URL(v);
    if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && v.length <= 8000)
      return v;
  } catch {}
  return null;
}
async function lock(db, id) {
  const { rows: [row] } = await db.query('SELECT * FROM artist_mail_imports WHERE id=$1 FOR UPDATE', [id]);
  if (!row) bad('投稿不存在', 404);
  return row;
}
async function register(db, input) {
  const mailbox = string(input.mailbox, 300).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(mailbox)) bad('无效邮箱');
  const messageId = key(input.messageId), threadId = key(input.threadId);
  const time = new Date(input.receivedAt);
  if (!input.receivedAt || !Number.isFinite(time.valueOf())) bad('无效收件时间');
  const id = digest(mailbox + '\n' + messageId);
  const incoming = Array.isArray(input.items) ? input.items : [];
  if (incoming.length > 250) bad('单封投稿材料过多');
  const created = await db.query(
    `INSERT INTO artist_mail_imports(id,mailbox,message_id,thread_id,subject,sender,received_at,body,source_complete)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [id, mailbox, messageId, threadId, string(input.subject, 1000), string(input.sender, 1000),
      time, string(input.body, 250000), input.complete === true],
  );
  const current = await lock(db, id);
  let upgraded = false;
  if (!current.source_complete && input.complete === true) {
    await db.query('UPDATE artist_mail_imports SET body=$2,source_complete=true WHERE id=$1',
      [id, string(input.body, 250000)]);
    if (current.record_id)
      await db.query(`UPDATE artist_records SET data=jsonb_set(data,'{content}',to_jsonb($2::text)) WHERE id=$1`,
        [current.record_id, string(input.body, 250000)]);
    upgraded = true;
  }
  let newItems = 0;
  for (const item of incoming) {
    const url = item.url ? safeLink(item.url) : null;
    if (item.url && !url) bad('无效材料链接');
    const result = await db.query(
      `INSERT INTO artist_mail_items(import_id,item_key,name,url,reason)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [id, key(item.key), string(item.name, 255) || '邮件材料', url,
        url ? '外链原件待下载或补传' : '附件原件待获取或补传'],
    );
    newItems += result.rowCount;
  }
  const rows = await items(db, id);
  return { id, created: Boolean(created.rowCount), upgraded, newItems,
    savedKeys: rows.filter(i => i.file_id).map(i => i.item_key),
    pending: rows.filter(i => !i.file_id).length, complete: current.source_complete || upgraded };
}
async function items(db, id) {
  return (await db.query(
    `SELECT i.*,f.original_name,f.size,f.mime,f.state FROM artist_mail_items i
      LEFT JOIN artist_files f ON f.id=i.file_id WHERE i.import_id=$1 ORDER BY i.item_key`, [id])).rows;
}
async function detail(db, id) {
  const { rows: [row] } = await db.query('SELECT * FROM artist_mail_imports WHERE id=$1', [id]);
  if (!row) bad('投稿不存在', 404);
  return { ...row, items: await items(db, id) };
}
async function list(db, q) {
  const limit = 25;
  const page = Math.max(1, Math.min(100000, parseInt(q.get('page'), 10) || 1));
  const filter = q.get('filter') || 'pending';
  const where = filter === 'all' ? '' : filter === 'assigned' ? 'WHERE m.artist_id IS NOT NULL' :
    'WHERE m.artist_id IS NULL OR NOT m.source_complete OR EXISTS(SELECT 1 FROM artist_mail_items i WHERE i.import_id=m.id AND i.file_id IS NULL)';
  const rows = (await db.query(
    `SELECT m.id,m.subject,m.sender,m.received_at,m.artist_id,m.source_complete,
       (SELECT count(*)::int FROM artist_mail_items i WHERE i.import_id=m.id AND i.file_id IS NULL) pending,
       (SELECT count(*)::int FROM artist_mail_items i WHERE i.import_id=m.id AND i.file_id IS NOT NULL) saved,
       p.data->>'name' artist_name
       FROM artist_mail_imports m LEFT JOIN artist_profiles p ON p.id=m.artist_id ${where}
       ORDER BY m.received_at DESC,m.id LIMIT $1 OFFSET $2`, [limit + 1, (page - 1) * limit])).rows;
  return { rows: rows.slice(0, limit), page, more: rows.length > limit };
}
async function linkFiles(db, row, files) {
  if (!row.artist_id || !files.length) return;
  await db.query("UPDATE artist_files SET artist_id=$1,state='active' WHERE id=ANY($2::text[])",
    [row.artist_id, files]);
  await db.query(`UPDATE artist_records SET data=jsonb_set(data,'{fileIds}',
    (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(coalesce(data->'fileIds','[]') || to_jsonb($2::text[])) t(v)))
    WHERE id=$1`, [row.record_id, files]);
  await db.query('UPDATE artist_profiles SET version=version+1,updated_at=now() WHERE id=$1', [row.artist_id]);
}
async function assign(db, id, input, user, { clean, profile, audit }) {
  const row = await lock(db, id);
  if (row.artist_id) {
    if (input.artistId && input.artistId !== row.artist_id) bad('投稿已关联其他档案', 409);
    return { artistId: row.artist_id };
  }
  if (Boolean(input.artistId) === Boolean(input.name)) bad('请选择已有艺术家或填写新艺术家姓名');
  if (input.artistId) {
    const p = await profile(db, string(input.artistId, 100), true);
    if (p.archived) bad('请先恢复艺术家档案', 409);
    row.artist_id = p.id;
    await db.query(`UPDATE artist_profiles SET data=jsonb_set(data,'{relations}',
      coalesce(data->'relations','[]') || '["招募投稿"]'::jsonb),version=version+1,updated_at=now()
      WHERE id=$1 AND NOT(coalesce(data->'relations','[]') ? '招募投稿')`, [p.id]);
  } else {
    row.artist_id = randomUUID();
    const data = clean({ name: input.name, source: '招募投稿邮件', relations: ['招募投稿'] });
    await db.query('INSERT INTO artist_profiles(id,data,created_by) VALUES($1,$2,$3)',
      [row.artist_id, JSON.stringify(data), user.id]);
  }
  row.record_id = randomUUID();
  const received = new Date(new Date(row.received_at).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  await db.query("INSERT INTO artist_records(id,artist_id,kind,data,created_by) VALUES($1,$2,'submission',$3,$4)",
    [row.record_id, row.artist_id, JSON.stringify({ title: row.subject || '招募投稿邮件', date: received,
      content: row.body, sender: row.sender, emailSubject: row.subject, mailbox: row.mailbox,
      mailId: row.message_id, threadId: row.thread_id, mailImportId: row.id, fileIds: [] }), user.id]);
  await db.query('UPDATE artist_mail_imports SET artist_id=$2,record_id=$3 WHERE id=$1',
    [id, row.artist_id, row.record_id]);
  await linkFiles(db, row, (await items(db, id)).filter(i => i.file_id).map(i => i.file_id));
  await audit(db, user, 'assign-mail-submission', row.artist_id, { importId: id, recordId: row.record_id });
  return { artistId: row.artist_id };
}
async function material(db, id, itemKey) {
  const row = await lock(db, id);
  const { rows: [item] } = await db.query('SELECT * FROM artist_mail_items WHERE import_id=$1 AND item_key=$2',
    [id, key(itemKey)]);
  if (!item) bad('该投稿材料不存在', 404);
  // Same lock order as assignment and profile editing.
  if (row.artist_id)
    await db.query('SELECT id FROM artist_profiles WHERE id=$1 FOR UPDATE', [row.artist_id]);
  return { row, item };
}
async function setFile(db, row, item, fileId) {
  await db.query('UPDATE artist_mail_items SET file_id=$3,reason=$4 WHERE import_id=$1 AND item_key=$2',
    [row.id, item.item_key, fileId, '']);
  await linkFiles(db, row, [fileId]);
}
async function supplement(db, id, input, user, { filePath, audit }) {
  const { row, item } = await material(db, id, input.itemKey);
  if (item.file_id) {
    if (item.file_id === input.fileId) return { ok: true };
    bad('该材料已保存，请刷新列表', 409);
  }
  const { rows: [file] } = await db.query(
    "UPDATE artist_files SET state='active',category='邮件投稿附件' WHERE id=$1 AND owner_id=$2 AND state='staged' RETURNING id",
    [input.fileId, user.id]);
  if (!file || !require('node:fs').existsSync(filePath(file.id))) bad('请选择刚上传的文件', 409);
  await setFile(db, row, item, file.id);
  await audit(db, user, 'supplement-mail-file', row.artist_id || id, { importId: id, fileId: file.id });
  return { ok: true };
}
module.exports = { register, detail, list, assign, material, setFile, supplement, digest, safeLink };
