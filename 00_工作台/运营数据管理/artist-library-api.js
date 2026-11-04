'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const RELATIONS = ['收藏', '合作', '招募投稿', '日常发现'];
const STATUSES = [
  '待了解',
  '待联系',
  '沟通中',
  '待补材料',
  '待评估',
  '已合作',
  '暂缓',
];
const TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function text(value, max = 2000) {
  const s = String(value || '').trim();
  if (s.length > max) fail('输入内容过长');
  return s;
}
function urls(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，\n]/);
  if (parts.length > 100) fail('外部链接最多100条');
  return [
    ...new Set(
      parts
        .map((s) => text(s, 4096))
        .filter(Boolean)
        .map((s) => {
          try {
            const u = new URL(s);
            if (
              !['http:', 'https:'].includes(u.protocol) ||
              u.username ||
              u.password
            )
              throw 0;
          } catch {
            fail('无效外部链接：' + s.slice(0, 80));
          }
          return s;
        }),
    ),
  ];
}
function clean(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('资料格式不正确');
  const out = {};
  for (const k of [
    'name',
    'alias',
    'location',
    'medium',
    'source',
    'referrer',
    'owner',
    'status',
    'phone',
    'email',
    'avatarId',
  ])
    out[k] = text(input[k], 300);
  for (const k of [
    'bio',
    'education',
    'exhibitions',
    'notes',
    'collectionEvidence',
    'agency',
    'otherContact',
  ])
    out[k] = text(input[k], 12000);
  if (!out.name || !out.source) fail('请填写姓名/艺名和资料来源');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    fail('联系邮箱格式不正确');
  out.status = out.status || '待了解';
  if (!STATUSES.includes(out.status)) fail('跟进状态不正确');
  out.relations = [
    ...new Set(Array.isArray(input.relations) ? input.relations : []),
  ];
  if (out.relations.some((s) => !RELATIONS.includes(s))) fail('关系标签不正确');
  out.tags = [
    ...new Set(
      String(input.tags || '')
        .split(/[,，]/)
        .map((s) => text(s, 60))
        .filter(Boolean),
    ),
  ];
  if (out.tags.length > 30) fail('标签最多30个');
  out.urls = urls(input.urls);
  return out;
}
async function json(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) fail('请求过大', 413);
    chunks.push(c);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('请求内容不是有效JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    fail('请求内容须为对象');
  return data;
}
function signature(ext, b) {
  if (ext === '.pdf') return b.subarray(0, 5).toString() === '%PDF-';
  if (ext === '.doc')
    return b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (['.zip', '.docx'].includes(ext))
    return b.subarray(0, 2).toString() === 'PK';
  if (ext === '.png')
    return b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (['.jpg', '.jpeg'].includes(ext))
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (ext === '.gif') return /^GIF8[79]a$/.test(b.subarray(0, 6).toString());
  return (
    ext === '.webp' &&
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP'
  );
}
module.exports = function ({
  pool,
  getRequester,
  ensureRole,
  sendJSON,
  sendError,
}) {
  const dir = path.resolve(
    process.env.ARTIST_FILE_DIR || path.join(__dirname, 'artist-private-files'),
  );
  const publicDir = path.resolve(
    process.env.UPLOAD_DIR || '/tmp/aiwei-uploads',
  );
  const staticDir = path.resolve(
    process.env.STATIC_DIR || path.join(__dirname, 'app'),
  );
  if (
    dir === publicDir ||
    dir.startsWith(publicDir + path.sep) ||
    dir === staticDir ||
    dir.startsWith(staticDir + path.sep)
  )
    throw new Error('Artist files must be outside public uploads and app');
  fs.mkdirSync(dir, { recursive: true });
  const max = Number(process.env.ARTIST_MAX_FILE_BYTES || 200 * 1024 * 1024);
  const filePath = (id) => path.join(dir, id);
  const audit = (db, user, action, id, details = {}) =>
    db.query(
      'INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',
      [
        crypto.randomUUID(),
        user.id,
        action,
        'artist_profiles',
        id,
        JSON.stringify(details),
      ],
    );
  async function transaction(fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function profile(db, id, lock = false) {
    const r = await db.query(
      'SELECT * FROM artist_profiles WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [id],
    );
    if (!r.rows[0]) fail('艺术家档案不存在', 404);
    return r.rows[0];
  }
  async function upload(req, user, q) {
    const name = text(q.get('name'), 255);
    const ext = path.extname(name).toLowerCase();
    if (!name || /[\\/\x00-\x1f]/.test(name) || !TYPES[ext])
      fail('文件名或格式不支持');
    if (Number(req.headers['content-length']) > max)
      fail('文件超过上传限额', 413);
    const id = crypto.randomUUID(),
      temp = filePath(id) + '.part',
      dest = filePath(id);
    let size = 0,
      head = Buffer.alloc(0);
    const hash = crypto.createHash('sha256');
    try {
      await pipeline(
        req,
        new Transform({
          transform(c, enc, cb) {
            size += c.length;
            if (size > max)
              return cb(
                Object.assign(new Error('文件超过上传限额'), { status: 413 }),
              );
            hash.update(c);
            if (head.length < 16)
              head = Buffer.concat([head, c.subarray(0, 16 - head.length)]);
            cb(null, c);
          },
        }),
        fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      );
      if (!size || !signature(ext, head)) fail('文件内容与格式不符或文件为空');
      await fs.promises.rename(temp, dest);
      const row = await transaction(async (c) => {
        const r = await c.query(
          'INSERT INTO artist_files(id,original_name,size,mime,sha256,owner_id,state,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,original_name,size,mime,sha256,state,category',
          [
            id,
            name,
            size,
            TYPES[ext],
            hash.digest('hex'),
            user.id,
            'staged',
            text(q.get('category') || '其他资料', 60),
          ],
        );
        await audit(c, user, 'upload-stage', id, { size });
        return r.rows[0];
      });
      return row;
    } catch (e) {
      await fs.promises.unlink(temp).catch(() => {});
      await fs.promises.unlink(dest).catch(() => {});
      throw e;
    }
  }
  async function save(req, user, id, method) {
    const b = await json(req),
      data = clean(b.data),
      ids = b.fileIds || [];
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((s) => typeof s !== 'string')
    )
      fail('附件列表不正确');
    const selected = [...new Set(ids)];
    const artworkIds = b.artworkIds;
    if (
      artworkIds !== undefined &&
      (!Array.isArray(artworkIds) ||
        artworkIds.length > 300 ||
        artworkIds.some((v) => typeof v !== 'string'))
    )
      fail('作品关联列表不正确');
    return transaction(async (c) => {
      let existing;
      if (method === 'PATCH') {
        existing = await profile(c, id, true);
        if (existing.archived) fail('请先恢复档案', 409);
        if (existing.version !== b.version)
          fail('档案已更新，请重新打开后编辑', 409);
      } else {
        id = text(b.id, 100);
        if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) fail('档案编号不正确');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
        const r = await c.query('SELECT * FROM artist_profiles WHERE id=$1', [
          id,
        ]);
        if (r.rows.length) {
          if (r.rows[0].created_by !== user.id) fail('档案编号已存在', 409);
          return r.rows[0];
        }
      }
      const files = (
        await c.query(
          'SELECT * FROM artist_files WHERE id=ANY($1::text[]) FOR UPDATE',
          [selected],
        )
      ).rows;
      if (files.length !== selected.length) fail('附件不存在');
      for (const f of files) {
        if (
          f.state === 'removed' ||
          (f.state === 'staged' && f.owner_id !== user.id) ||
          (f.state === 'active' && f.artist_id !== id)
        )
          fail('附件无权关联', 403);
        if (!fs.existsSync(filePath(f.id)))
          fail('附件文件不可读取，请重新上传', 409);
      }
      if (
        data.avatarId &&
        !files.some(
          (f) => f.id === data.avatarId && f.mime.startsWith('image/'),
        )
      )
        fail('头像须选择已上传的图片');
      const row =
        method === 'PATCH'
          ? (
              await c.query(
                'UPDATE artist_profiles SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
                [id, JSON.stringify(data)],
              )
            ).rows[0]
          : (
              await c.query(
                'INSERT INTO artist_profiles(id,data,created_by) VALUES($1,$2,$3) RETURNING *',
                [id, JSON.stringify(data), user.id],
              )
            ).rows[0];
      await c.query(
        "UPDATE artist_files SET state='removed' WHERE artist_id=$1 AND state='active' AND NOT(id=ANY($2::text[]))",
        [id, selected],
      );
      await c.query(
        "UPDATE artist_files SET artist_id=$1,state='active' WHERE id=ANY($2::text[])",
        [id, selected],
      );
      if (artworkIds !== undefined) {
        const workIds = [...new Set(artworkIds)];
        const found = await c.query(
          'SELECT id FROM artworks WHERE id=ANY($1::text[]) FOR KEY SHARE',
          [workIds],
        );
        if (found.rows.length !== workIds.length)
          fail('部分画廊作品已不存在，请重新选择', 409);
        await c.query(
          'DELETE FROM artist_artwork_links WHERE artist_id=$1 AND NOT(artwork_id=ANY($2::text[]))',
          [id, workIds],
        );
        for (const workId of workIds)
          await c.query(
            'INSERT INTO artist_artwork_links(artist_id,artwork_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [id, workId, user.id],
          );
      }
      await audit(c, user, method === 'PATCH' ? 'update' : 'create', id, {
        fileCount: selected.length,
      });
      return row;
    });
  }
  return async function (req, res) {
    try {
      const u = new URL(req.url, 'http://localhost'),
        q = u.searchParams,
        parts = u.pathname.split('/').filter(Boolean).slice(3),
        [id, sub] = parts;
      const user = await getRequester(req);
      if (
        !ensureRole(
          res,
          user,
          req.method === 'GET'
            ? ['admin', 'editor', 'viewer']
            : ['admin', 'editor'],
        )
      )
        return;
      if (process.env.ARTIST_LIBRARY_ENABLED === 'false')
        return sendError(res, 503, '艺术家资料库暂未启用');
      if (id === 'files') {
        if (!sub && req.method === 'POST')
          return sendJSON(res, 201, await upload(req, user, q));
        if (sub && req.method === 'GET') {
          const r = await pool.query(
            'SELECT f.*,p.archived FROM artist_files f LEFT JOIN artist_profiles p ON p.id=f.artist_id WHERE f.id=$1',
            [sub],
          );
          const f = r.rows[0];
          if (
            !f ||
            f.state === 'removed' ||
            (f.state === 'staged' && f.owner_id !== user.id) ||
            (f.archived && user.role !== 'admin')
          )
            fail('文件不存在或不可访问', 404);
          const stat = await fs.promises.stat(filePath(f.id)).catch(() => null);
          if (!stat || stat.size !== Number(f.size))
            fail('文件不可读取，请联系管理员', 409);
          const inline =
            q.get('preview') === '1' &&
            (f.mime === 'application/pdf' || f.mime.startsWith('image/'));
          await audit(
            pool,
            user,
            inline ? 'preview-file' : 'download-file',
            f.artist_id || f.id,
            { fileId: f.id },
          );
          res.writeHead(200, {
            'Content-Type': f.mime,
            'Content-Length': stat.size,
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          });
          fs.createReadStream(filePath(f.id))
            .on('error', () => res.destroy())
            .pipe(res);
          return;
        }
        if (sub && req.method === 'DELETE') {
          await transaction(async (c) => {
            const r = await c.query(
              "UPDATE artist_files SET state='removed' WHERE id=$1 AND state='staged' AND owner_id=$2 RETURNING id",
              [sub, user.id],
            );
            if (!r.rows.length) fail('暂存附件不存在', 404);
            await audit(c, user, 'discard-stage', sub);
          });
          return sendJSON(res, 200, { ok: true });
        }
        fail('操作不支持', 405);
      }
      if (id === 'options' && req.method === 'GET') {
        const staff = (
          await pool.query(
            "SELECT id,display_name,username FROM users WHERE is_active=true AND role IN ('admin','editor') ORDER BY display_name",
          )
        ).rows;
        return sendJSON(res, 200, {
          staff,
          relations: RELATIONS,
          statuses: STATUSES,
          maxFileBytes: max,
        });
      }
      if (id === 'artworks' && req.method === 'GET') {
        if (sub) {
          const work = (
            await pool.query(
              'SELECT id,artwork_no,title,artist,medium,dimensions,status FROM artworks WHERE id=$1',
              [sub],
            )
          ).rows[0];
          if (!work) fail('画廊作品不存在', 404);
          const linkedArtists = (
            await pool.query(
              "SELECT p.id,p.data->>'name' name,p.archived FROM artist_artwork_links l JOIN artist_profiles p ON p.id=l.artist_id WHERE l.artwork_id=$1 ORDER BY p.data->>'name'",
              [sub],
            )
          ).rows;
          return sendJSON(res, 200, { ...work, linkedArtists });
        }
        const query = '%' + text(q.get('q'), 200) + '%';
        if (q.get('paged') === '1') {
          const page = Math.max(
            1,
            Math.min(100000, parseInt(q.get('page'), 10) || 1),
          );
          const where =
            'title ILIKE $1 OR artist ILIKE $1 OR artwork_no ILIKE $1';
          const total = Number(
            (
              await pool.query('SELECT count(*) FROM artworks WHERE ' + where, [
                query,
              ])
            ).rows[0].count,
          );
          const rows = (
            await pool.query(
              'SELECT id,artwork_no,title,artist,medium,dimensions,status FROM artworks WHERE ' +
                where +
                ' ORDER BY artwork_no,title,id LIMIT 20 OFFSET $2',
              [query, (page - 1) * 20],
            )
          ).rows;
          return sendJSON(res, 200, { rows, total, page, pageSize: 20 });
        }
        return sendJSON(
          res,
          200,
          (
            await pool.query(
              'SELECT id,artwork_no,title,artist,medium,dimensions,image_url,retail_price,status FROM artworks WHERE title ILIKE $1 OR artist ILIKE $1 OR artwork_no ILIKE $1 ORDER BY title LIMIT 50',
              [query],
            )
          ).rows,
        );
      }
      if (!id && req.method === 'GET') {
        const query = '%' + text(q.get('q'), 200) + '%',
          relation = text(q.get('relation'), 40),
          status = text(q.get('status'), 40),
          archived = q.get('archived') === 'true';
        if (archived && user.role !== 'admin')
          fail('仅管理员可查看归档档案', 403);
        const page = Math.max(
          1,
          Math.min(100000, parseInt(q.get('page'), 10) || 1),
        );
        const where = `p.archived=$1 AND (p.data::text ILIKE $2 OR EXISTS(SELECT 1 FROM artist_files f WHERE f.artist_id=p.id AND f.state='active' AND f.original_name ILIKE $2) OR EXISTS(SELECT 1 FROM artist_artwork_links l JOIN artworks a ON a.id=l.artwork_id WHERE l.artist_id=p.id AND a.title ILIKE $2) OR EXISTS(SELECT 1 FROM artist_records r WHERE r.artist_id=p.id AND r.kind='work' AND r.data::text ILIKE $2)) AND ($3='' OR p.data->'relations' ? $3) AND ($4='' OR p.data->>'status'=$4)`;
        const values = [archived, query, relation, status];
        const total = Number(
          (
            await pool.query(
              'SELECT count(*) FROM artist_profiles p WHERE ' + where,
              values,
            )
          ).rows[0].count,
        );
        const rows = (
          await pool.query(
            "SELECT p.*, (SELECT count(*)::int FROM artist_files f WHERE f.artist_id=p.id AND f.state='active') file_count FROM artist_profiles p WHERE " +
              where +
              ' ORDER BY p.updated_at DESC,p.id LIMIT 30 OFFSET $5',
            [...values, (page - 1) * 30],
          )
        ).rows;
        return sendJSON(res, 200, { rows, total, page, pageSize: 30 });
      }
      if (!id && req.method === 'POST')
        return sendJSON(res, 201, await save(req, user, null, 'POST'));
      if (id && !sub && req.method === 'PATCH')
        return sendJSON(res, 200, await save(req, user, id, 'PATCH'));
      if (id && !sub && req.method === 'GET') {
        const p = await profile(pool, id);
        if (p.archived && user.role !== 'admin') fail('档案已归档', 404);
        const files = (
          await pool.query(
            "SELECT id,original_name,size,mime,sha256,category,state,created_at FROM artist_files WHERE artist_id=$1 AND state='active' ORDER BY created_at",
            [id],
          )
        ).rows;
        const works = (
          await pool.query(
            'SELECT a.id,a.artwork_no,a.title,a.artist,a.medium,a.dimensions,a.retail_price,a.status FROM artist_artwork_links l JOIN artworks a ON a.id=l.artwork_id WHERE l.artist_id=$1 ORDER BY a.title',
            [id],
          )
        ).rows;
        const records = (
          await pool.query(
            'SELECT * FROM artist_records WHERE artist_id=$1 ORDER BY created_at DESC,id',
            [id],
          )
        ).rows;
        return sendJSON(res, 200, { ...p, files, works, records });
      }
      if (sub === 'archive' && req.method === 'POST') {
        if (!ensureRole(res, user, ['admin'])) return;
        const b = await json(req);
        if (typeof b.archived !== 'boolean') fail('归档状态不正确');
        await transaction(async (c) => {
          const p = await profile(c, id, true);
          if (p.version !== b.version) fail('档案已更新，请重新打开', 409);
          await c.query(
            'UPDATE artist_profiles SET archived=$2,version=version+1,updated_at=now() WHERE id=$1',
            [id, b.archived],
          );
          await audit(c, user, b.archived ? 'archive' : 'restore', id);
        });
        return sendJSON(res, 200, { ok: true });
      }
      if (sub === 'works' && ['POST', 'DELETE'].includes(req.method)) {
        const b = await json(req);
        const workId = text(b.artworkId, 100);
        await transaction(async (c) => {
          const p = await profile(c, id, true);
          if (p.archived) fail('档案已归档', 409);
          if (req.method === 'POST') {
            if (
              !(await c.query('SELECT id FROM artworks WHERE id=$1', [workId]))
                .rows.length
            )
              fail('作品不存在', 404);
            const changed = await c.query(
              'INSERT INTO artist_artwork_links(artist_id,artwork_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
              [id, workId, user.id],
            );
            if (changed.rowCount)
              await c.query(
                'UPDATE artist_profiles SET version=version+1,updated_at=now() WHERE id=$1',
                [id],
              );
          } else {
            const changed = await c.query(
              'DELETE FROM artist_artwork_links WHERE artist_id=$1 AND artwork_id=$2',
              [id, workId],
            );
            if (changed.rowCount)
              await c.query(
                'UPDATE artist_profiles SET version=version+1,updated_at=now() WHERE id=$1',
                [id],
              );
          }
          await audit(
            c,
            user,
            req.method === 'POST' ? 'link-work' : 'unlink-work',
            id,
            { artworkId: workId },
          );
        });
        return sendJSON(res, 200, { ok: true });
      }
      if (sub === 'records' && req.method === 'POST') {
        const b = await json(req);
        if (!['followup', 'submission', 'work'].includes(b.kind))
          fail('记录类型不正确');
        const data = {};
        for (const key of [
          'title',
          'date',
          'content',
          'nextAction',
          'nextDate',
          'sender',
          'emailSubject',
          'mailId',
          'threadId',
          'mailbox',
          'medium',
          'dimensions',
          'year',
          'price',
          'currency',
          'sourceType',
        ])
          data[key] = text(b.data?.[key], key === 'content' ? 20000 : 1000);
        if (!data.title) fail('请填写记录标题');
        if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date))
          fail('日期格式不正确');
        if (data.nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.nextDate))
          fail('计划日期格式不正确');
        data.fileIds = Array.isArray(b.data?.fileIds)
          ? [...new Set(b.data.fileIds)]
          : [];
        if (data.fileIds.length > 100) fail('关联附件过多');
        const rid = text(b.id, 100);
        if (!/^[a-zA-Z0-9-]{8,100}$/.test(rid)) fail('记录编号不正确');
        await transaction(async (c) => {
          const p = await profile(c, id, true);
          if (p.archived) fail('档案已归档', 409);
          if (data.fileIds.length) {
            const r = await c.query(
              "SELECT id FROM artist_files WHERE artist_id=$1 AND state='active' AND id=ANY($2::text[])",
              [id, data.fileIds],
            );
            if (r.rows.length !== data.fileIds.length)
              fail('关联附件不属于当前艺术家');
          }
          const prev = (
            await c.query('SELECT artist_id FROM artist_records WHERE id=$1', [
              rid,
            ])
          ).rows[0];
          if (prev && prev.artist_id !== id) fail('记录编号冲突', 409);
          const r = await c.query(
            'INSERT INTO artist_records(id,artist_id,kind,data,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id',
            [rid, id, b.kind, JSON.stringify(data), user.id],
          );
          if (r.rows.length)
            await audit(c, user, 'append-' + b.kind, id, { recordId: rid });
        });
        return sendJSON(res, 201, { id: rid });
      }
      fail('操作不支持', 405);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const status =
        e.status || (['23503', '22P02', '23505'].includes(e.code) ? 400 : 500);
      if (status === 500)
        console.error('[artist-library]', e.code || e.message);
      sendError(
        res,
        status,
        status === 500 ? '资料库暂时无法处理，请重试' : e.message,
      );
    }
  };
};
module.exports.normalizeUrls = urls;
