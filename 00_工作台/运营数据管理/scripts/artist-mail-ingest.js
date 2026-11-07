'use strict';
// Internal container command. No network listener or mail credentials.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const { fileTypes, fileSignature } = require('../artist-library-api');
const mail = require('../artist-mail');

async function readHeader(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) throw Error('Missing manifest');
    const nl = value.indexOf(10);
    bytes += nl < 0 ? value.length : nl;
    if (bytes > 2 * 1024 * 1024) throw Error('Manifest exceeds limit');
    chunks.push(nl < 0 ? value : value.subarray(0, nl));
    if (nl >= 0) {
      return { input: JSON.parse(Buffer.concat(chunks).toString('utf8')), body: (async function* () {
        yield value.subarray(nl + 1);
        for (;;) {
          const r = await iterator.next();
          if (r.done) return;
          yield r.value;
        }
      })() };
    }
  }
}
async function receive(db, dir, input, body, onMove) {
  const { row, item } = await mail.material(db, input.id, input.itemKey);
  if (item.file_id) {
    for await (const _ of body) {}
    return { saved: false, existing: true };
  }
  const name = String(input.name || item.name).replace(/[\\/\x00-\x1f]/g, '_').slice(0, 255);
  const ext = path.extname(name).toLowerCase();
  const max = Number(process.env.ARTIST_MAX_FILE_BYTES || 200 * 1024 * 1024);
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > max || !fileTypes[ext]) {
    for await (const _ of body) {}
    await db.query('UPDATE artist_mail_items SET reason=$3 WHERE import_id=$1 AND item_key=$2',
      [row.id, item.item_key, '文件格式不受支持、为空或超过限额，待补传']);
    return { saved: false, rejected: true };
  }
  const id = randomUUID();
  const temp = path.join(dir, id + '.part'), dest = path.join(dir, id);
  const file = await fs.promises.open(temp, 'wx', 0o600);
  const hash = createHash('sha256');
  let count = 0, head = Buffer.alloc(0), moved = false;
  try {
    try {
      for await (const c of body) {
        count += c.length;
        if (count > input.size) throw Error('Attachment length mismatch');
        if (head.length < 16) head = Buffer.concat([head, c.subarray(0, 16 - head.length)]);
        hash.update(c);
        await file.writeFile(c);
      }
      await file.sync();
    } finally {
      await file.close();
    }
    const sha = hash.digest('hex');
    if (count !== input.size || sha !== input.sha256) throw Error('Attachment integrity mismatch');
    if (!fileSignature(ext, head)) {
      await db.query('UPDATE artist_mail_items SET reason=$3 WHERE import_id=$1 AND item_key=$2',
        [row.id, item.item_key, '文件内容与格式不符，待核对或补传']);
      return { saved: false, rejected: true };
    }
    await fs.promises.rename(temp, dest);
    moved = true;
    onMove(dest);
    await db.query(`INSERT INTO artist_files(id,artist_id,original_name,size,mime,sha256,owner_id,state,category)
      VALUES($1,$2,$3,$4,$5,$6,'codex-mail-ingest','active','邮件投稿附件')`,
      [id, row.artist_id, name, count, fileTypes[ext], sha]);
    await mail.setFile(db, row, item, id);
    return { saved: true, sha256: sha, size: count };
  } catch (e) {
    if (moved) await fs.promises.unlink(dest).catch(() => {});
    throw e;
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}
async function run() {
  if (!process.env.ARTIST_FILE_DIR || process.env.ARTIST_LIBRARY_ENABLED === 'false')
    throw Error('Artist library unavailable');
  const dir = path.resolve(process.env.ARTIST_FILE_DIR);
  if (dir === path.parse(dir).root) throw Error('Invalid private storage');
  const { input, body } = await readHeader(process.stdin);
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres', database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASS || process.env.DB_PASSWORD });
  await db.connect();
  let writtenFile, committing = false;
  try {
    await db.query('BEGIN');
    let snapshot;
    if (input.op === 'retry') {
      const rows = (await db.query(`SELECT m.message_id, m.received_at > now()-interval '90 days' AS recent,
        (NOT m.source_complete OR EXISTS(SELECT 1 FROM artist_mail_items i
          WHERE i.import_id=m.id AND i.url IS NULL AND i.file_id IS NULL)) retry
        FROM artist_mail_imports m WHERE m.mailbox=$1 ORDER BY m.received_at DESC`,
        ['goorock2000@gmail.com'])).rows;
      snapshot = { ids: rows.filter(m => m.retry).slice(0, 100).map(m => m.message_id),
        done: rows.filter(m => m.recent && !m.retry).map(m => m.message_id) };
    }
    const result = snapshot ||
      (input.op === 'register' ? await mail.register(db, input) :
        input.op === 'file' ? await receive(db, dir, input, body, dest => { writtenFile = dest; }) : null);
    if (!result) throw Error('Invalid operation');
    if (result.created || result.upgraded || result.newItems || result.saved)
      await db.query(`INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details)
        VALUES($1,'codex-mail-ingest',$2,'artist_mail_imports',$3,$4)`,
        [randomUUID(), result.saved ? 'archive-mail-attachment' : 'register-submission-mail',
          result.id || input.id, JSON.stringify({ addedMaterials: result.newItems || 0, size: result.size || 0 })]);
    committing = true;
    await db.query('COMMIT');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    if (writtenFile && !committing) await fs.promises.unlink(writtenFile).catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
if (require.main === module) run().catch(e => {
  // Do not expose personal data or filesystem paths from database and I/O errors.
  console.error('Mail intake failed:', e.code || e.status || 'invalid request or interrupted transfer');
  process.exitCode = 1;
});
