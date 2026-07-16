const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/aiwei-uploads';
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
const ARTWORK_UPLOAD_DIR = path.join(UPLOAD_DIR, 'artworks');
try { fs.mkdirSync(ARTWORK_UPLOAD_DIR, { recursive: true }); } catch (e) {}
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PASS = process.env.DB_PASS || 'Aiwei2024Gallery';
const PORT = process.env.PORT || 3000;
const STATIC_DIR = process.env.STATIC_DIR || '/var/www/aiwei';

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'postgres',
  password: DB_PASS,
  database: 'postgres',
  max: 10
});

// JSONB 列名（用于序列化数组为 JSON 字符串，避免 pg 错误序列化为 PG 数组字面量）
const JSONB_COLS = new Set([
  'ticket_items','coffee_items','workshop_items','retail_items',
  'tags',         // project_registry
  'value'         // app_config（虽然 app_config 走专用路由，兜底也支持）
]);

// 各表实际存在的列（用于过滤前端传入的非法列名）
const TABLE_COLS = {
  revenue: new Set([
    'id','date','ticket_qty','ticket_amount','combo_qty','combo_amount',
    'coffee_qty','coffee_amount','ticket_items','coffee_items','workshop_items',
    'workshop_amount','retail_items','retail_amount','creative_amount',
    'venue_amount','other_amount','other_desc','cash_amount','account_amount',
    'payment_method','project_name','handler','notes','created_at'
  ]),
  // 空间使用重构 2026-07-10：去掉 received_amount（由子表聚合）
  space_usage: new Set([
    'id','date','end_date','space','project_name','type','client','status',
    'rental_type','receivable_amount','expected_payment_date','notes','created_at'
  ]),
  space_payments: new Set([
    'id','space_usage_id','payment_date','amount','payment_method','notes','created_at'
  ]),
  // 画廊作品档案（含 image_url 2026-07-10；结算价/零售价 2026-07-11；artwork_no + 库存 2026-07-12）
  artworks: new Set([
    'id','artwork_no','title','artist','year','medium','dimensions','location','status',
    'image_url','settlement_price','retail_price','total_qty','sold_qty',
    'notes','created_at','updated_at'
  ]),
  // ===== 2026-07-11 补全：以下表之前无白名单导致字段被静默丢弃 =====
  expense: new Set([
    'id','date','type','project','category','amount','description','handler',
    'invoice_status','receipt_status','related_activity','created_at'
  ]),
  gallery_sales: new Set([
    'id','date','artwork_no','artwork_name','artist','price','commission','buyer_name',
    'payment_method','related_exhibition','status','handler','notes','sale_quantity','created_at'
  ]),
  operation_logs: new Set([
    'id','user_id','action','table_name','record_id','details','created_at'
  ]),
  project_registry: new Set([
    'id','name','repository','status','tags','notes','created_at','updated_at'
  ]),
  inventory: new Set([
    'id','name','category','quantity','unit','notes','created_at','updated_at'
  ]),
  partners: new Set([
    'id','name','type','contact','phone','notes','created_at','updated_at'
  ]),
  content_posts: new Set([
    'id','title','platform','publish_date','status','url','notes','created_at','updated_at'
  ]),
  creative_products: new Set([
    'id','name','sku','supplier','cost_price','retail_price','stock','unit',
    'notes','created_at','updated_at'
  ]),
  // users / app_config 不需要白名单：
  // - users 走独立路由（handleLogin / handleChangePassword）
  // - app_config 走 Store.saveConfig / loadAppConfig（专用 key+value）
};

// 只读视图/表（POST/PATCH/DELETE 拒绝）
const READ_ONLY_TABLES = new Set(['space_usage_with_payments']);

// snake_case to camelCase（NUMERIC 类型转数字）
function toCamel(row) {
  if (!row) return row;
  const NUMERIC_COLS = new Set([
    'ticket_amount','combo_amount','coffee_amount','workshop_amount',
    'creative_amount','venue_amount','other_amount','cash_amount','account_amount',
    'retail_amount','price','commission','receivable_amount','received_amount',
    'amount'
  ]);
  const o = {};
  for (let k of Object.keys(row)) {
    let ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let v = row[k];
    if (NUMERIC_COLS.has(k) && typeof v === 'string') v = parseFloat(v) || 0;
    o[ck] = v;
  }
  return o;
}

// camelCase to snake_case (递归支持数组)
function toSnake(obj) {
  if (Array.isArray(obj)) return obj.map(v => toSnake(v));
  if (obj === null || typeof obj !== 'object') return obj;
  const o = {};
  for (let k of Object.keys(obj)) {
    let sk = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    o[sk] = toSnake(obj[k]);
  }
  return o;
}

// SHA-256 hash
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function parsePath(reqUrl) {
  let p = url.parse(reqUrl, true);
  let pathname = p.pathname.replace(/\/+$/, '');
  return { pathname, query: p.query, parts: pathname.split('/').filter(Boolean) };
}

function sendJSON(res, status, data, count) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
  if (count !== undefined) headers['Content-Range'] = `0-${data.length}/${count}`;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function sendError(res, status, msg) {
  sendJSON(res, status, { error: msg, message: msg });
}

// --- POST /rest/v1/login --- 服务端密码校验
async function handleLogin(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { username, password } = JSON.parse(body);
      if (!username || !password) return sendError(res, 400, '请输入用户名和密码');
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      const user = result.rows[0];
      if (!user) return sendError(res, 401, '用户不存在');
      if (!user.is_active) return sendError(res, 403, '账号已被禁用，请联系管理员');

      const stored = user.password_hash || '';
      let needChange = false;
      let actualHash = stored;
      if (stored.startsWith('__need_change__:')) {
        needChange = true;
        actualHash = stored.slice('__need_change__:'.length);
      }
      const inputHash = sha256(password);
      if (inputHash !== actualHash) return sendError(res, 401, '密码错误');

      // 更新 last_login_at
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
      sendJSON(res, 200, {
        id: user.id, username: user.username,
        displayName: user.display_name || user.username,
        role: user.role, needPasswordChange: needChange
      });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- POST /rest/v1/change-password --- 修改密码
async function handleChangePassword(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { userId, newPassword } = JSON.parse(body);
      if (!userId || !newPassword) return sendError(res, 400, '参数不完整');
      if (newPassword.length < 6) return sendError(res, 400, '密码长度至少 6 位');
      const hash = sha256(newPassword);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
      sendJSON(res, 200, { success: true });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- POST /rest/v1/artworks/upload --- 作品图片上传（multipart/form-data）
// 返回 { url: '/uploads/artworks/xxx.jpg' }
function handleArtworkUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const m = contentType.match(/^multipart\/form-data;\s*boundary=(.+)$/);
  if (!m) return sendError(res, 400, 'Content-Type 必须是 multipart/form-data');
  const boundary = '--' + m[1];

  const chunks = [];
  let totalLen = 0;
  let aborted = false;

  req.on('data', chunk => {
    if (aborted) return;
    totalLen += chunk.length;
    if (totalLen > MAX_IMAGE_SIZE) {
      aborted = true;
      try { req.destroy(); } catch (e) {}
      return sendError(res, 413, '文件超过 5MB 限制');
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) return;
    try {
      const buf = Buffer.concat(chunks);
      const result = parseMultipartFile(buf, boundary, 'file', MAX_IMAGE_SIZE);
      if (!result) return sendError(res, 400, '未找到名为 file 的文件字段');
      const ext = path.extname(result.filename).toLowerCase();
      if (!ALLOWED_IMAGE_EXTS.has(ext)) {
        return sendError(res, 400, '仅支持图片格式：' + [...ALLOWED_IMAGE_EXTS].join(','));
      }
      // 生成唯一文件名：时间戳 + 随机 4 字符
      const random = crypto.randomBytes(2).toString('hex');
      const newName = Date.now().toString(36) + '_' + random + ext;
      const destPath = path.join(ARTWORK_UPLOAD_DIR, newName);
      fs.writeFileSync(destPath, result.data);
      const url = '/uploads/artworks/' + newName;
      sendJSON(res, 201, { url, filename: newName, size: result.data.length });
    } catch (e) {
      sendError(res, 500, '上传失败：' + e.message);
    }
  });

  req.on('error', e => {
    if (!aborted) sendError(res, 500, '上传错误：' + e.message);
  });
}

/** 简易 multipart 解析（单文件场景，无嵌套） */
function parseMultipartFile(buf, boundary, fieldName, maxSize) {
  const boundaryBuf = Buffer.from(boundary, 'utf8');
  // 找每个 part 的头/体分隔
  let pos = 0;
  while (pos < buf.length) {
    // 找 boundary 起点的 \r\n
    const start = buf.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    // boundary 后跟 \r\n，然后是 part header
    let partStart = start + boundaryBuf.length;
    if (buf[partStart] === '-' && buf[partStart + 1] === '-') break;  // 结束 boundary
    if (buf[partStart] === 0x0d) partStart += 2;  // skip \r\n
    // 找 header 结束的 \r\n\r\n
    const headerEnd = buf.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const header = buf.slice(partStart, headerEnd).toString('utf8');
    // body 起点 = headerEnd + 4
    const bodyStart = headerEnd + 4;
    // 找下一个 boundary 起点
    const next = buf.indexOf(boundaryBuf, bodyStart);
    if (next === -1) break;
    // body 终点 = next - 2（去掉 boundary 前的 \r\n）
    let bodyEnd = next - 2;
    if (bodyEnd <= bodyStart) break;
    // 解析 Content-Disposition 拿 filename + name
    const filenameMatch = header.match(/filename="([^"]+)"/);
    const nameMatch = header.match(/name="([^"]+)"/);
    const curName = nameMatch ? nameMatch[1] : '';
    if (curName === fieldName && filenameMatch) {
      const filename = filenameMatch[1];
      const data = buf.slice(bodyStart, bodyEnd);
      if (data.length > maxSize) throw new Error('文件超过限制');
      return { filename, data };
    }
    pos = next + boundaryBuf.length;
  }
  return null;
}

// --- POST /rest/v1/space_usage/check-conflict ---
// body: { space, date, endDate, excludeId? }
// 返回 200 { ok: true } 或 409 { conflict: { id, projectName, date, endDate } }
async function handleSpaceConflict(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { space, date, endDate, excludeId } = JSON.parse(body);
      if (!space || !date) return sendError(res, 400, '缺少 space 或 date');

      const newStart = date;
      const newEnd = endDate || date;

      // 区间相交判定：新记录区间 [newStart..newEnd] ∩ 已有记录 [s.date..COALESCE(s.end_date, s.date)]
      // 等价于：newStart <= COALESCE(s.end_date, s.date) AND newEnd >= s.date
      const params = [space, newStart, newEnd];
      let excludeClause = '';
      if (excludeId) {
        params.push(excludeId);
        excludeClause = ` AND id <> $${params.length}`;
      }
      const sql = `
        SELECT id, project_name, date, end_date, status
          FROM space_usage
         WHERE space = $1
           AND status IN ('已确认','进行中')
           AND $2 <= COALESCE(NULLIF(end_date, ''), date)
           AND $3 >= date
           ${excludeClause}
         LIMIT 1`;
      const r = await pool.query(sql, params);
      if (r.rows.length > 0) {
        return sendJSON(res, 409, {
          conflict: {
            id: r.rows[0].id,
            projectName: r.rows[0].project_name,
            date: r.rows[0].date,
            endDate: r.rows[0].end_date || r.rows[0].date,
            status: r.rows[0].status
          }
        });
      }
      sendJSON(res, 200, { ok: true });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- REST API ---

async function handleREST(req, res, urlInfo) {
  const { pathname, query, parts } = urlInfo;
  // parts: ['rest', 'v1', tableName]
  if (parts.length < 3) return sendError(res, 400, 'Invalid path');
  const table = parts[2];
  const tableMap = {
    'revenue': 'revenue', 'expense': 'expense', 'space_usage': 'space_usage',
    'space_payments': 'space_payments', 'space_usage_with_payments': 'space_usage_with_payments',
    'gallery_sales': 'gallery_sales', 'app_config': 'app_config',
    'users': 'users', 'operation_logs': 'operation_logs',
    'project_registry': 'project_registry', 'inventory': 'inventory',
    'artworks': 'artworks', 'partners': 'partners', 'content_posts': 'content_posts',
    'creative_products': 'creative_products'
  };
  const dbTable = tableMap[table];
  if (!dbTable) return sendError(res, 404, 'Table not found: ' + table);

  const method = req.method.toUpperCase();

  // 只读视图/表拒绝写
  if (READ_ONLY_TABLES.has(dbTable) && method !== 'GET' && method !== 'OPTIONS') {
    return sendError(res, 405, '视图只读，不能写入');
  }

  try {
    // --- GET /rest/v1/table ---
    if (method === 'GET') {
      let sql = `SELECT * FROM "${dbTable}"`;
      let conditions = [];
      let params = [];
      let paramIdx = 1;

      // Handle id=eq.{id}
      for (let k of Object.keys(query)) {
        if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') continue;
        let vals = query[k];
        if (!Array.isArray(vals)) vals = [vals];
        for (let v of vals) {
          if (v.startsWith('eq.')) {
            conditions.push(`"${k}" = $${paramIdx++}`);
            params.push(v.slice(3));
          } else if (v.startsWith('neq.')) {
            conditions.push(`"${k}" <> $${paramIdx++}`);
            params.push(v.slice(4));
          } else if (v.startsWith('gte.')) {
            conditions.push(`"${k}" >= $${paramIdx++}`);
            params.push(v.slice(4));
          } else if (v.startsWith('lte.')) {
            conditions.push(`"${k}" <= $${paramIdx++}`);
            params.push(v.slice(4));
          } else if (v.startsWith('ilike.')) {
            conditions.push(`"${k}" ILIKE $${paramIdx++}`);
            params.push(v.slice(6));
          }
        }
      }

      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

      // order=date.desc
      if (query.order) {
        let orderParts = query.order.split('.');
        let col = orderParts[0];
        let dir = orderParts[1] === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY "${col}" ${dir}`;
      }

      if (query.limit) sql += ` LIMIT ${parseInt(query.limit)}`;
      if (query.offset) sql += ` OFFSET ${parseInt(query.offset)}`;

      // If id=eq.xxx requested single row
      let isSingle = parts.length === 4;
      if (isSingle) {
        sql = `SELECT * FROM "${dbTable}" WHERE "id" = '${parts[3]}'`;
        params = [];
      }

      const result = await pool.query(sql, params);
      if (isSingle) {
        if (result.rows.length === 0) return sendJSON(res, 406, []);
        return sendJSON(res, 200, toCamel(result.rows[0]));
      }

      // Count for Content-Range
      let countSql = `SELECT COUNT(*) FROM "${dbTable}"`;
      if (conditions.length) countSql += ' WHERE ' + conditions.join(' AND ');
      const countResult = await pool.query(countSql, params);
      const total = parseInt(countResult.rows[0].count);

      sendJSON(res, 200, result.rows.map(r => toCamel(r)), total);
    }

    // --- POST /rest/v1/table ---
    else if (method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString('utf8'));
      req.on('end', async () => {
        try {
          let data = JSON.parse(body);
          data = toSnake(data);
          if (!data.created_at) data.created_at = new Date().toISOString();
          // 过滤不存在的列（防御前端发送不存在的字段）
          const allowed = TABLE_COLS[dbTable];
          if (allowed) {
            Object.keys(data).forEach(k => { if (!allowed.has(k)) delete data[k]; });
          }

          // JSON.stringify JSONB 数组，否则 pg 会错误序列化为 PG 数组字面量
          const cols = Object.keys(data);
          const vals = cols.map(k => JSONB_COLS.has(k) && Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k]);
          const placeholders = vals.map((_, i) => `$${i + 1}`);
          const sql = `INSERT INTO "${dbTable}" (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`;
          const result = await pool.query(sql, vals);
          sendJSON(res, 201, toCamel(result.rows[0]));
        } catch (e) {
          sendError(res, 400, e.message);
        }
      });
    }

    // --- PATCH /rest/v1/table?id=eq.xxx ---
    else if (method === 'PATCH') {
      // Get id from query or path
      let idVal;
      if (query.id && query.id.startsWith('eq.')) {
        idVal = query.id.slice(3);
      } else if (parts.length === 4) {
        idVal = parts[3];
      } else {
        return sendError(res, 400, 'Missing id filter');
      }

      let body = '';
      req.on('data', chunk => body += chunk.toString('utf8'));
      req.on('end', async () => {
        try {
          let data = JSON.parse(body);
          data = toSnake(data);
          // 过滤不存在的列（防御前端发送不存在的字段）
          const allowed = TABLE_COLS[dbTable];
          if (allowed) {
            Object.keys(data).forEach(k => { if (!allowed.has(k)) delete data[k]; });
          }
          const keys = Object.keys(data);
          const vals = keys.map(k => JSONB_COLS.has(k) && Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k]);
          const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
          vals.push(idVal);
          const sql = `UPDATE "${dbTable}" SET ${setClauses.join(',')} WHERE "id" = $${vals.length} RETURNING *`;
          const result = await pool.query(sql, vals);
          sendJSON(res, 200, result.rows.length ? toCamel(result.rows[0]) : null);
        } catch (e) {
          sendError(res, 400, e.message);
        }
      });
    }

    // --- DELETE /rest/v1/table?id=eq.xxx ---
    else if (method === 'DELETE') {
      let idVal;
      if (query.id && query.id.startsWith('eq.')) {
        idVal = query.id.slice(3);
      } else if (parts.length === 4) {
        idVal = parts[3];
      } else {
        // delete all where neq
        if (query.id && query.id.startsWith('neq.')) {
          const sql = `DELETE FROM "${dbTable}" WHERE "id" <> '${query.id.slice(4)}'`;
          await pool.query(sql);
          return sendJSON(res, 200, []);
        }
        return sendError(res, 400, 'Missing id filter');
      }

      await pool.query(`DELETE FROM "${dbTable}" WHERE "id" = $1`, [idVal]);
      sendJSON(res, 200, []);
    }

    // --- OPTIONS CORS ---
    else if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      res.end();
    }
  } catch (e) {
    sendError(res, 500, e.message);
  }
}

// --- Static file server ---
function serveStatic(req, res, pathname) {
  let filePath = path.join(STATIC_DIR, pathname === '/' ? '/index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    sendJSON(res, 404, { error: 'Not found' });
  }
}

// --- Main request handler ---
const server = http.createServer((req, res) => {
  const urlInfo = parsePath(req.url);
  const { pathname, parts } = urlInfo;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (parts[0] === 'rest' && parts[1] === 'v1') {
    if (parts[2] === 'login' && req.method === 'POST') {
      handleLogin(req, res);
    } else if (parts[2] === 'change-password' && req.method === 'POST') {
      handleChangePassword(req, res);
    } else if (parts[2] === 'space_usage' && parts[3] === 'check-conflict' && req.method === 'POST') {
      handleSpaceConflict(req, res);
    } else if (parts[2] === 'artworks' && parts[3] === 'upload' && req.method === 'POST') {
      handleArtworkUpload(req, res);
    } else {
      handleREST(req, res, urlInfo);
    }
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('AIWEI API server running on port ' + PORT);
});
