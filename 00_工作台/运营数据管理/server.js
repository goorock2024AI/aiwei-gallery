const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/aiwei-uploads';
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
const ARTWORK_UPLOAD_DIR = path.join(UPLOAD_DIR, 'artworks');
try { fs.mkdirSync(ARTWORK_UPLOAD_DIR, { recursive: true }); } catch (e) {}
const EXPENSE_UPLOAD_DIR = path.join(UPLOAD_DIR, 'expense');
try { fs.mkdirSync(EXPENSE_UPLOAD_DIR, { recursive: true }); } catch (e) {}
const EXPENSE_PDF_DIR = path.join(UPLOAD_DIR, 'expense-pdfs');
try { fs.mkdirSync(EXPENSE_PDF_DIR, { recursive: true }); } catch (e) {}
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB
const PDF_FONT_PATH = process.env.PDF_FONT_PATH || '';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PASS = process.env.DB_PASS || process.env.DB_PASSWORD;
if (!DB_PASS) {
  throw new Error('DB_PASS or DB_PASSWORD environment variable is required');
}
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
  'ticket_items','coffee_items','workshop_items','retail_items','expense_ids',
  'revenue_summary','payment_summary','expense_summary','adjustment_summary','cash_summary',
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
    'payment_method','project_name','handler','notes','status','refund_amount',
    'adjusted_at','adjusted_by','adjustment_reason','created_at'
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
    'invoice_status','receipt_status','reimbursement_status','related_activity','created_at'
  ]),
  expense_attachments: new Set([
    'id','expense_id','attachment_type','file_url','original_name','file_size',
    'mime_type','uploaded_by','created_at'
  ]),
  expense_reimbursements: new Set([
    'id','expense_ids','title','total_amount','pdf_url','pdf_size','generated_by','created_at'
  ]),
  gallery_sales: new Set([
    'id','date','artwork_no','artwork_name','artist','price','commission','buyer_name',
    'payment_method','related_exhibition','status','handler','notes','sale_quantity',
    'refund_amount','adjusted_at','adjusted_by','adjustment_reason','created_at'
  ]),
  transaction_adjustments: new Set([
    'id','target_type','target_id','action','amount','reason',
    'operator_id','operator_name','created_at'
  ]),
  cash_movements: new Set([
    'id','date','type','amount','source_type','source_id','account_channel',
    'operator_id','operator_name','reason','notes','created_at'
  ]),
  daily_closings: new Set([
    'id','date','system_net_amount','confirmed_amount','difference_amount',
    'revenue_summary','payment_summary','expense_summary','adjustment_summary','cash_summary',
    'closer_id','closer_name','reviewer_name','status','notes','created_at','updated_at'
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
const READ_ONLY_TABLES = new Set(['space_usage_with_payments', 'revenue_facts']);

// snake_case to camelCase（NUMERIC 类型转数字）
function toCamel(row) {
  if (!row) return row;
  const NUMERIC_COLS = new Set([
    'ticket_amount','combo_amount','coffee_amount','workshop_amount',
    'creative_amount','venue_amount','other_amount','cash_amount','account_amount',
    'retail_amount','price','commission','receivable_amount','received_amount',
    'amount','net_amount','refund_amount','system_net_amount','confirmed_amount','difference_amount',
    'file_size','pdf_size','total_amount'
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

function sanitizeUploadName(name) {
  return String(name || 'file').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

function getMultipartBoundary(contentType) {
  const m = String(contentType || '').match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  return m ? (m[1] || m[2] || '').trim() : '';
}

function collectJSON(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', () => {
    try { cb(null, body ? JSON.parse(body) : {}); }
    catch (e) { cb(e); }
  });
}

function getPdfFontPath() {
  const candidates = [
    PDF_FONT_PATH,
    path.join(__dirname, 'fonts', 'NotoSansSC-VF.ttf'),
    path.join(__dirname, 'fonts', 'NotoSansSC-Regular.otf'),
    path.join(__dirname, 'fonts', 'NotoSansSC-Regular.ttf'),
    path.join(__dirname, 'fonts', 'NotoSansCJKsc-Regular.otf'),
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc'
  ].filter(Boolean);
  return candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  }) || '';
}

function uploadUrlToPath(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return '';
  const rel = fileUrl.replace(/^\/uploads\/+/, '').replace(/\\/g, '/');
  const full = path.resolve(UPLOAD_DIR, rel);
  const root = path.resolve(UPLOAD_DIR);
  if (!full.startsWith(root)) return '';
  return full;
}

function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

function beijingDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}${parts.month}${parts.day}`;
}

async function nextExpensePdfTitle() {
  const dateKey = beijingDateKey();
  const prefix = `运营支出报销凭证${dateKey}`;
  const result = await pool.query(
    `SELECT title
       FROM expense_reimbursements
      WHERE title LIKE $1
      ORDER BY title DESC
      LIMIT 1`,
    [prefix + '%']
  );
  let nextNo = 1;
  const lastTitle = result.rows[0]?.title || '';
  const m = lastTitle.match(/(\d{3})$/);
  if (m) nextNo = parseInt(m[1], 10) + 1;
  if (nextNo > 999) throw new Error(`当天报销 PDF 编号已超过 999：${dateKey}`);
  return prefix + String(nextNo).padStart(3, '0');
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

function normalizeTimestamps(data) {
  const TIMESTAMPTZ_COLS = new Set(['created_at','updated_at','adjusted_at','last_login_at']);
  for (const col of TIMESTAMPTZ_COLS) {
    if (data[col] === '') data[col] = null;
  }
  return data;
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

// --- POST /rest/v1/change-password --- 修改密码（带可选 oldPassword 校验，前后端都走 Node crypto）
async function handleChangePassword(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { userId, newPassword, oldPassword } = JSON.parse(body);
      if (!userId || !newPassword) return sendError(res, 400, '参数不完整');
      if (newPassword.length < 6) return sendError(res, 400, '密码长度至少 6 位');
      if (oldPassword !== undefined && oldPassword !== null && oldPassword !== '') {
        const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (r.rows.length === 0) return sendError(res, 404, '用户不存在');
        let stored = r.rows[0].password_hash || '';
        if (stored.startsWith('__need_change__:')) stored = stored.slice('__need_change__:'.length);
        if (sha256(oldPassword) !== stored) return sendError(res, 401, '当前密码错误');
      }
      const hash = sha256(newPassword);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
      sendJSON(res, 200, { success: true });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- POST /rest/v1/users/create --- admin 新建用户（后端算 hash，避免前后端 SHA-256 不一致）
async function handleCreateUser(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { username, displayName, role, password } = JSON.parse(body);
      if (!username) return sendError(res, 400, '请输入用户名');
      const pwd = password || '88888888';
      if (pwd.length < 6) return sendError(res, 400, '密码长度至少 6 位');
      const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (exists.rows.length > 0) return sendError(res, 409, '用户名已存在');
      const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const hash = sha256(pwd);
      const stored = '__need_change__:' + hash;
      await pool.query(
        `INSERT INTO users (id, username, display_name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [id, username, displayName || username, stored, role || 'editor']
      );
      sendJSON(res, 201, { id, username, displayName: displayName || username, role: role || 'editor' });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- POST /rest/v1/users/reset-password --- admin 重置密码（后端算 hash）
async function handleResetPassword(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString('utf8'));
  req.on('end', async () => {
    try {
      const { userId, password } = JSON.parse(body);
      if (!userId) return sendError(res, 400, '缺少 userId');
      const pwd = password || '88888888';
      if (pwd.length < 6) return sendError(res, 400, '密码长度至少 6 位');
      const r = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
      if (r.rows.length === 0) return sendError(res, 404, '用户不存在');
      const hash = sha256(pwd);
      const stored = '__need_change__:' + hash;
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [stored, userId]);
      sendJSON(res, 200, { success: true });
    } catch (e) { sendError(res, 400, e.message); }
  });
}

// --- POST /rest/v1/artworks/upload --- 作品图片上传（multipart/form-data）
// 返回 { url: '/uploads/artworks/xxx.jpg' }
function handleArtworkUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryValue = getMultipartBoundary(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundaryValue) {
    return sendError(res, 400, 'Content-Type 必须是 multipart/form-data');
  }
  const boundary = '--' + boundaryValue;

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

// --- POST /rest/v1/expense_attachments/upload --- 支出票据图片上传
// 返回 { url: '/uploads/expense/invoice/xxx.jpg', filename, size, mimeType, originalName }
function handleExpenseAttachmentUpload(req, res, query) {
  const type = query.type === 'payment' ? 'payment' : 'invoice';
  const contentType = req.headers['content-type'] || '';
  const boundaryValue = getMultipartBoundary(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundaryValue) {
    return sendError(res, 400, 'Content-Type 必须是 multipart/form-data');
  }
  const boundary = '--' + boundaryValue;

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
      const targetDir = path.join(EXPENSE_UPLOAD_DIR, type);
      fs.mkdirSync(targetDir, { recursive: true });
      const random = crypto.randomBytes(2).toString('hex');
      const safeOriginal = sanitizeUploadName(path.basename(result.filename, ext));
      const newName = Date.now().toString(36) + '_' + random + '_' + safeOriginal + ext;
      const destPath = path.join(targetDir, newName);
      fs.writeFileSync(destPath, result.data);
      const mimeType = ext === '.png' ? 'image/png'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : 'image/jpeg';
      const fileUrl = `/uploads/expense/${type}/${newName}`;
      sendJSON(res, 201, {
        url: fileUrl,
        filename: newName,
        originalName: result.filename,
        size: result.data.length,
        mimeType
      });
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

async function handleExpensePdfGenerate(req, res) {
  collectJSON(req, async (err, body) => {
    if (err) return sendError(res, 400, 'JSON 格式不正确');
    try {
      const expenseIds = Array.isArray(body.expenseIds)
        ? [...new Set(body.expenseIds.map(String).filter(Boolean))]
        : [];
      if (!expenseIds.length) return sendError(res, 400, '请选择至少一笔支出');
      if (expenseIds.length > 50) return sendError(res, 400, '单个报销包最多支持 50 笔支出');

      const expenseResult = await pool.query(
        `SELECT * FROM expense WHERE id = ANY($1::text[]) ORDER BY date ASC, created_at ASC`,
        [expenseIds]
      );
      const expenses = expenseResult.rows;
      if (!expenses.length) return sendError(res, 404, '未找到支出记录');

      const attachmentResult = await pool.query(
        `SELECT * FROM expense_attachments WHERE expense_id = ANY($1::text[]) ORDER BY expense_id ASC, attachment_type ASC, created_at ASC`,
        [expenseIds]
      );
      const attachmentsByExpense = attachmentResult.rows.reduce((acc, row) => {
        if (!acc[row.expense_id]) acc[row.expense_id] = [];
        acc[row.expense_id].push(row);
        return acc;
      }, {});

      const id = 'pdf_' + Date.now().toString(36) + '_' + crypto.randomBytes(2).toString('hex');
      const title = await nextExpensePdfTitle();
      const filename = title + '.pdf';
      const outputPath = path.join(EXPENSE_PDF_DIR, filename);
      await generateExpensePdfFile(outputPath, expenses, attachmentsByExpense, { ...body, title });
      const stat = fs.statSync(outputPath);
      const pdfUrl = '/uploads/expense-pdfs/' + encodeURIComponent(filename);
      const totalAmount = expenses.reduce((s, r) => s + (+r.amount || 0), 0);
      const generatedBy = body.generatedBy || '';

      const saved = await pool.query(
        `INSERT INTO expense_reimbursements
          (id, expense_ids, title, total_amount, pdf_url, pdf_size, generated_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [id, JSON.stringify(expenses.map(r => r.id)), title, totalAmount, pdfUrl, stat.size, generatedBy]
      );
      sendJSON(res, 201, toCamel(saved.rows[0]));
    } catch (e) {
      sendError(res, 500, '生成 PDF 失败：' + e.message);
    }
  });
}

function generateExpensePdfFile(outputPath, expenses, attachmentsByExpense, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, autoFirstPage: true });
    const out = fs.createWriteStream(outputPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    const fontPath = getPdfFontPath();
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
      } catch (e) {
        return reject(new Error('中文字体加载失败：' + e.message));
      }
    } else {
      return reject(new Error('未找到中文字体，无法生成中文报销 PDF'));
    }

    drawPdfSummary(doc, expenses, options);
    expenses.forEach((expense, idx) => {
      const rows = attachmentsByExpense[expense.id] || [];
      const invoices = rows.filter(a => a.attachment_type === 'invoice');
      const payments = rows.filter(a => a.attachment_type === 'payment');

      if (invoices.length) {
        invoices.forEach((a, i) => drawInvoicePage(doc, expense, a, i + 1, invoices.length, idx + 1, expenses.length));
      } else {
        drawMissingInvoicePage(doc, expense, idx + 1, expenses.length);
      }

      if (payments.length) {
        payments.forEach((a, i) => drawPaymentInfoPage(doc, expense, a, i + 1, payments.length, idx + 1, expenses.length));
      } else {
        drawPaymentInfoPage(doc, expense, null, 0, 0, idx + 1, expenses.length);
      }
      const unsupported = rows.filter(a => !['invoice', 'payment'].includes(a.attachment_type));
      unsupported.forEach((a, i) => {
        drawAttachmentNoticePage(doc, expense, a, `其他附件 ${i + 1}`);
      });
    });

    doc.end();
  });
}

function drawPageTitle(doc, title, subtitle = '') {
  doc.fontSize(16).fillColor('#111').text(title, 42, 42, { width: 511 });
  if (subtitle) doc.fontSize(9).fillColor('#555').text(subtitle, 42, 66, { width: 511 });
  doc.moveTo(42, 86).lineTo(553, 86).strokeColor('#ddd').stroke();
}

function drawExpenseInfoBox(doc, r, x, y, w) {
  const rows = [
    ['日期', r.date || '-'],
    ['项目', r.project || '-'],
    ['类别', r.category || '-'],
    ['金额', '¥' + formatMoney(r.amount)],
    ['经手人', r.handler || '-'],
    ['发票状态', r.invoice_status || '-'],
    ['支付凭证状态', r.receipt_status || '-'],
    ['报销状态', r.reimbursement_status || '-'],
    ['关联活动', r.related_activity || '-'],
    ['支出说明', r.description || '-']
  ];
  doc.roundedRect(x, y, w, 130, 4).strokeColor('#ddd').stroke();
  doc.fontSize(9);
  rows.slice(0, 8).forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const tx = x + 12 + col * (w / 2);
    const ty = y + 12 + row * 20;
    doc.fillColor('#666').text(label + '：', tx, ty, { continued: true });
    doc.fillColor('#111').text(String(value), { width: w / 2 - 64 });
  });
  doc.fillColor('#666').text('关联活动：', x + 12, y + 92, { continued: true });
  doc.fillColor('#111').text(String(rows[8][1]), { width: w - 90 });
  doc.fillColor('#666').text('支出说明：', x + 12, y + 108, { continued: true });
  doc.fillColor('#111').text(String(rows[9][1]), { width: w - 90, height: 28 });
}

function drawImageOrNotice(doc, attachment, x, y, fitW, fitH) {
  if (!attachment) {
    doc.roundedRect(x, y, fitW, fitH, 4).strokeColor('#ddd').stroke();
    doc.fontSize(12).fillColor('#b45309').text('尚未上传对应图片。', x + 16, y + 20, { width: fitW - 32 });
    return;
  }
  const filePath = uploadUrlToPath(attachment.file_url);
  const ext = path.extname(filePath).toLowerCase();
  if (filePath && fs.existsSync(filePath) && ['.jpg', '.jpeg', '.png'].includes(ext)) {
    try {
      doc.image(filePath, x, y, { fit: [fitW, fitH], align: 'center', valign: 'center' });
      return;
    } catch (e) {
      // fall through to notice
    }
  }
  doc.roundedRect(x, y, fitW, fitH, 4).strokeColor('#ddd').stroke();
  doc.fontSize(11).fillColor('#b45309').text('该附件格式暂不能嵌入 PDF，请通过原始附件链接查看：', x + 16, y + 20, { width: fitW - 32 });
  doc.fillColor('#2563eb').text(attachment.file_url || '-', x + 16, y + 48, { width: fitW - 32, underline: true });
}

function drawPdfSummary(doc, expenses, options = {}) {
  const title = options.title || '运营支出报销凭证包';
  const generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const totalAmount = expenses.reduce((s, r) => s + (+r.amount || 0), 0);
  doc.fontSize(20).text(title, { align: 'center' });
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor('#555').text(`生成时间：${generatedAt}`);
  doc.text(`支出笔数：${expenses.length}    合计金额：¥${formatMoney(totalAmount)}`);
  doc.moveDown(1);
  doc.fillColor('#111').fontSize(12).text('汇总表');
  doc.moveDown(0.4);

  const col = { date: 42, project: 102, category: 190, amount: 252, handler: 320, desc: 380 };
  let y = doc.y;
  doc.fontSize(9).fillColor('#333');
  doc.text('日期', col.date, y);
  doc.text('项目', col.project, y);
  doc.text('类别', col.category, y);
  doc.text('金额', col.amount, y);
  doc.text('经手人', col.handler, y);
  doc.text('说明', col.desc, y);
  y += 18;
  doc.moveTo(42, y - 6).lineTo(553, y - 6).strokeColor('#ddd').stroke();

  expenses.forEach((r, i) => {
    if (y > 760) { doc.addPage(); y = 42; }
    doc.fillColor('#111').fontSize(9);
    doc.text(r.date || '', col.date, y, { width: 56 });
    doc.text(r.project || '', col.project, y, { width: 82 });
    doc.text(r.category || '', col.category, y, { width: 58 });
    doc.text('¥' + formatMoney(r.amount), col.amount, y, { width: 64 });
    doc.text(r.handler || '', col.handler, y, { width: 55 });
    doc.text(r.description || '', col.desc, y, { width: 170, height: 30 });
    y += 32;
  });
}

function drawInvoicePage(doc, expense, attachment, index, total, expenseIndex, expenseTotal) {
  doc.addPage();
  drawPageTitle(
    doc,
    `发票 ${index}/${total}`,
    `第 ${expenseIndex}/${expenseTotal} 笔｜${expense.project || '-'}｜¥${formatMoney(expense.amount)}｜${attachment.original_name || ''}`
  );
  drawImageOrNotice(doc, attachment, 42, 104, 511, 680);
}

function drawMissingInvoicePage(doc, expense, expenseIndex, expenseTotal) {
  doc.addPage();
  drawPageTitle(
    doc,
    '发票缺失',
    `第 ${expenseIndex}/${expenseTotal} 笔｜${expense.project || '-'}｜¥${formatMoney(expense.amount)}`
  );
  drawExpenseInfoBox(doc, expense, 42, 108, 511);
  drawImageOrNotice(doc, null, 42, 248, 511, 260);
}

function drawPaymentInfoPage(doc, expense, attachment, index, total, expenseIndex, expenseTotal) {
  doc.addPage();
  const paymentTitle = total ? `付款凭证 ${index}/${total} + 单据信息` : '付款凭证缺失 + 单据信息';
  drawPageTitle(
    doc,
    paymentTitle,
    `第 ${expenseIndex}/${expenseTotal} 笔｜${expense.project || '-'}｜¥${formatMoney(expense.amount)}${attachment ? '｜' + (attachment.original_name || '') : ''}`
  );
  drawExpenseInfoBox(doc, expense, 42, 104, 511);
  drawImageOrNotice(doc, attachment, 42, 246, 511, 538);
}

function drawAttachmentNoticePage(doc, expense, attachment, title) {
  doc.addPage();
  drawPageTitle(
    doc,
    title,
    `${expense.project || '-'}｜¥${formatMoney(expense.amount)}｜${attachment.original_name || ''}`
  );
  drawAttachmentNotice(doc, attachment, 42, 120, 511, 220);
}

function drawAttachmentNotice(doc, attachment, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 4).strokeColor('#ddd').stroke();
  doc.fontSize(11).fillColor('#b45309').text('该附件暂不能归类为发票或支付凭证，请通过原始附件链接查看：', x + 16, y + 20, { width: w - 32 });
  doc.fillColor('#2563eb').text(attachment.file_url || '-', x + 16, y + 48, { width: w - 32, underline: true });
}

// --- REST API ---

async function handleREST(req, res, urlInfo) {
  const { pathname, query, parts } = urlInfo;
  // parts: ['rest', 'v1', tableName]
  if (parts.length < 3) return sendError(res, 400, 'Invalid path');
  const table = parts[2];
  const tableMap = {
    'revenue': 'revenue', 'expense': 'expense', 'space_usage': 'space_usage',
    'expense_attachments': 'expense_attachments',
    'expense_reimbursements': 'expense_reimbursements',
    'space_payments': 'space_payments', 'space_usage_with_payments': 'space_usage_with_payments',
    'revenue_facts': 'revenue_facts',
    'gallery_sales': 'gallery_sales', 'transaction_adjustments': 'transaction_adjustments',
    'daily_closings': 'daily_closings', 'cash_movements': 'cash_movements',
    'app_config': 'app_config',
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
          data = normalizeTimestamps(data);
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
          data = normalizeTimestamps(data);
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
    } else if (parts[2] === 'users' && parts[3] === 'create' && req.method === 'POST') {
      handleCreateUser(req, res);
    } else if (parts[2] === 'users' && parts[3] === 'reset-password' && req.method === 'POST') {
      handleResetPassword(req, res);
    } else if (parts[2] === 'space_usage' && parts[3] === 'check-conflict' && req.method === 'POST') {
      handleSpaceConflict(req, res);
    } else if (parts[2] === 'artworks' && parts[3] === 'upload' && req.method === 'POST') {
      handleArtworkUpload(req, res);
    } else if (parts[2] === 'expense_attachments' && parts[3] === 'upload' && req.method === 'POST') {
      handleExpenseAttachmentUpload(req, res, urlInfo.query);
    } else if (parts[2] === 'expense_reimbursements' && parts[3] === 'generate' && req.method === 'POST') {
      handleExpensePdfGenerate(req, res);
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
