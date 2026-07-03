const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const DB_PASS = process.env.DB_PASS || 'Aiwei2024Gallery';
const PORT = process.env.PORT || 3000;
const STATIC_DIR = '/var/www/aiwei';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: DB_PASS,
  database: 'postgres',
  max: 10
});

// snake_case to camelCase
function toCamel(row) {
  if (!row) return row;
  const o = {};
  for (let k of Object.keys(row)) {
    let ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    o[ck] = row[k];
  }
  return o;
}

// camelCase to snake_case
function toSnake(obj) {
  if (!obj) return obj;
  const o = {};
  for (let k of Object.keys(obj)) {
    let sk = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    o[sk] = obj[k];
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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  if (count !== undefined) res.setHeader('Content-Range', `0-${data.length}/${count}`);
  res.end(JSON.stringify(data));
}

function sendError(res, status, msg) {
  sendJSON(res, status, { error: msg, message: msg });
}

// --- REST API ---

async function handleREST(req, res, urlInfo) {
  const { pathname, query, parts } = urlInfo;
  // parts: ['rest', 'v1', tableName]
  if (parts.length < 3) return sendError(res, 400, 'Invalid path');
  const table = parts[2];
  const tableMap = {
    'revenue': 'revenue', 'expense': 'expense', 'space_usage': 'space_usage',
    'gallery_sales': 'gallery_sales', 'app_config': 'app_config',
    'users': 'users', 'operation_logs': 'operation_logs',
    'project_registry': 'project_registry', 'inventory': 'inventory',
    'artworks': 'artworks', 'partners': 'partners', 'content_posts': 'content_posts'
  };
  const dbTable = tableMap[table];
  if (!dbTable) return sendError(res, 404, 'Table not found: ' + table);

  const method = req.method.toUpperCase();

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
        let v = query[k];
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
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          let data = JSON.parse(body);
          data = toSnake(data);
          if (!data.created_at) data.created_at = new Date().toISOString();

          const cols = Object.keys(data);
          const vals = Object.values(data);
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
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          let data = JSON.parse(body);
          data = toSnake(data);
          const setClauses = Object.keys(data).map((k, i) => `"${k}" = $${i + 1}`);
          const vals = Object.values(data);
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
    handleREST(req, res, urlInfo);
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('AIWEI API server running on port ' + PORT);
});
