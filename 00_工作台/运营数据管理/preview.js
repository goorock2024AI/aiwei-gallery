// preview.js — 本地预览服务器
// 用法：node preview.js
// 端口：3000（可改 PORT 环境变量）
//
// 解决三个问题：
// 1. `serve` 不代理 /rest/* → 这里用 Node 内置 http + fetch 反代到腾讯云 API
// 2. `app/` 与 `dist/`（Cloudflare Pages 用）属于不同部署目标，本地预览不再走 dist/
// 3. 之前 launch.json 写 `cmd serve`，但 serve 未全局安装，命令不存在 → 改成 node
//
// 为什么不直连本地 server.js：server.js 要连本地 PG（127.0.0.1:5432），本机不通。
// 所以预览时前端调 /rest/* 全部代理到云端 http://122.51.56.50/rest/。
// 数据走云端，但页面/逻辑改动走本机，scp 只在「提交版本」时用一次。

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UPSTREAM = process.env.UPSTREAM || 'http://122.51.56.50';
const STATIC_DIR = path.join(__dirname, 'app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(STATIC_DIR, urlPath);
  // 防越权（不能跳出 app/）
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// /rest/* 反代到云端；query string 自动透传
async function proxyRest(req, res) {
  const upstreamUrl = UPSTREAM + req.url;
  const headers = { ...req.headers, host: new URL(UPSTREAM).host };
  // node fetch 不接受 hop-by-hop 头
  delete headers['connection'];
  delete headers['content-length']; // fetch 自动算

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  try {
    const upstream = await fetch(upstreamUrl, { method: req.method, headers, body, redirect: 'follow' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const respHeaders = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
    // 保留分页头
    const cr = upstream.headers.get('content-range');
    if (cr) respHeaders['Content-Range'] = cr;
    res.writeHead(upstream.status, respHeaders);
    res.end(buf);
    // 调试日志：状态 + 路径
    process.stdout.write(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.url} → ${upstream.status}\n`);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('proxy error: ' + e.message);
    process.stderr.write(`[ERR] ${req.method} ${req.url} → ${e.message}\n`);
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/rest/')) {
    proxyRest(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`✅ 预览服务已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   静态目录: ${STATIC_DIR}`);
  console.log(`   API 反代: ${UPSTREAM}/rest/*`);
  console.log(`   停止: Ctrl+C`);
});