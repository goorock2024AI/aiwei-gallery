'use strict';
// Codex connector snapshots are private input files. This command emits counts only.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { simpleParser } = require('mailparser');
const { digest, safeLink } = require('../artist-mail');
const MAX_FILE = 200 * 1024 * 1024;

function command(manifest, bytes) {
  return new Promise((resolve, reject) => {
    const local = process.env.ARTIST_MAIL_LOCAL === '1';
    const child = local
      ? spawn(process.execPath, [path.join(__dirname, 'artist-mail-ingest.js')])
      : spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
        'root@122.51.56.50', 'docker exec -i aiwei-api-1 node /app/scripts/artist-mail-ingest.js']);
    let output = '';
    child.stdout.on('data', c => { output += c; });
    child.stderr.resume();
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error('Intake command failed'));
      try { resolve(JSON.parse(output)); } catch { reject(Error('Intake did not confirm write')); }
    });
    child.stdin.write(JSON.stringify(manifest) + '\n');
    child.stdin.end(bytes);
  });
}
function flatten(part) {
  if (!part) return [];
  return [part, ...(part.parts || []).flatMap(flatten)];
}
function urls(text, html) {
  const all = [
    ...[...(html || '').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]),
    ...((text || '').match(/https?:\/\/[^\s<>"'\[\]，。；）]+/gi) || []),
  ];
  const byUrl = new Map();
  for (const raw of all) {
    const url = safeLink(raw.replaceAll('&amp;', '&').replace(/&#(\d+);/g, (_, n) =>
      Number(n) < 128 ? String.fromCharCode(Number(n)) : '').replace(/[),.;]+$/, ''));
    if (!url) continue;
    const u = new URL(url);
    // Include file sharing services and download links, without fetching arbitrary email URLs.
    const qq = /(^|\.)mail\.qq\.com$/i.test(u.hostname) && /^\/ftn\//i.test(u.pathname);
    const netease = /(^|\.)mail\.(163|126)\.com$/i.test(u.hostname) && /^\/largeattachmentdownload/i.test(u.pathname);
    if (qq || netease ||
        /(^|\.)(?:weiyun\.com|pan\.baidu\.com|aliyundrive\.com|alipan\.com|quark\.cn|wetransfer\.com|we\.tl|dropbox\.com|drive\.google\.com|onedrive\.live\.com|1drv\.ms|lanzou[a-z]?\.com|cowtransfer\.com|123pan\.com)$/i.test(u.hostname)
        || /\.(pdf|zip|rar|7z|docx?|jpe?g|png)$/i.test(u.pathname)) {
      const id = netease ? u.hostname + ':' + (u.searchParams.get('file') || url) :
        qq ? u.hostname + ':' + (u.searchParams.get('key') || url) : url;
      const name = u.searchParams.get('title') || '外部材料 · ' + u.hostname;
      if (!byUrl.has(id)) byUrl.set(id, { key: 'url:' + digest(id), url, name });
    }
  }
  return [...byUrl.values()].slice(0, 100);
}
function inputFile(dir, name) {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
async function original(ref, expected) {
  if (!ref?.download_url || !Number.isSafeInteger(expected) || expected < 1 || expected > MAX_FILE) return null;
  const u = new URL(ref.download_url);
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const response = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > expected) return null;
    chunks.push(chunk);
  }
  return size === expected ? Buffer.concat(chunks, size) : null;
}
async function runOne(dir, meta) {
  const id = meta.id;
  const raw = inputFile(dir, 'gmail-' + id + '-raw.json') ||
    inputFile(dir, 'mail-' + id + '.json');
  const full = inputFile(dir, 'gmail-' + id + '-full.json');
  const parsed = raw?.raw ? await simpleParser(Buffer.from(raw.raw, 'base64url'),
    { skipImageLinks: true, skipTextLinks: true }) : null;
  const parts = flatten(full?.payload);
  const text = parsed?.text || parts.filter(p => p.mime_type === 'text/plain' && !p.filename)
    .map(p => p.body?.content || '').join('\n');
  const html = parsed?.html || parts.filter(p => p.mime_type === 'text/html' && !p.filename)
    .map(p => p.body?.content || '').join('\n');
  const normalized = text || (html ? (await simpleParser('Content-Type: text/html; charset=utf-8\r\n\r\n' + html,
    { skipImageLinks: true, skipTextLinks: true })).text : '') || meta.snippet || '';
  const rawFiles = (parsed?.attachments || []).filter(f => f.contentDisposition !== 'inline');
  const seen = new Map();
  const attachments = [...(meta.attachments || [])];
  // Metadata normally includes every original attachment; preserve additional raw MIME attachments.
  const rawCounts = new Map();
  for (const f of rawFiles) {
    const name = f.filename || '未命名附件';
    const n = (rawCounts.get(name) || 0) + 1;
    rawCounts.set(name, n);
    if (attachments.filter(x => x.filename === name).length < n)
      attachments.push({ filename: name, size_bytes: f.size });
  }
  const files = attachments.map((v, i) => {
    const name = v.filename || '未命名附件';
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    const f = rawFiles.filter(x => x.filename === name)[n];
    const p = parts.filter(x => x.filename === name && x.content_disposition !== 'inline')[n];
    const bytes = f?.content || (p?.body?.base64_url_content
      ? Buffer.from(p.body.base64_url_content, 'base64url') : null);
    return { key: 'file:' + digest(name + '\n' + n), name, bytes, expected: v.size_bytes, slot: i };
  });
  const links = urls(normalized, html);
  const received = full?.internal_date || raw?.internal_date || meta.email_ts;
  const receivedAt = /^\d{10,13}$/.test(String(received))
    ? new Date(Number(received) * (String(received).length === 10 ? 1000 : 1)).toISOString() : received;
  const r = await command({ op: 'register', mailbox: 'goorock2000@gmail.com', messageId: id,
    threadId: meta.thread_id, sender: meta.from_, subject: meta.subject, receivedAt,
    body: normalized, complete: Boolean(parsed || full?.payload),
    items: [...files.map(({key,name}) => ({key,name})), ...links] });
  let saved = 0, failures = 0;
  for (const f of files) {
    if (r.savedKeys.includes(f.key)) continue;
    try {
      const expected = Number(f.expected);
      let bytes = f.bytes;
      if (bytes && expected > 0 && bytes.length !== expected) bytes = null;
      const cached = path.join(dir, 'gmail-' + id + '-file-' + f.slot + '.bin');
      if (!bytes && expected > 0 && expected <= MAX_FILE && fs.existsSync(cached) &&
          fs.statSync(cached).size === expected) bytes = fs.readFileSync(cached);
      bytes ||= await original(inputFile(dir, 'gmail-' + id + '-file-' + f.slot + '.json'), expected);
      if (!bytes?.length) continue;
      const result = await command({ op: 'file', id: r.id, itemKey: f.key, name: f.name,
        size: bytes.length, sha256: digest(bytes) }, bytes);
      if (result.saved || result.existing) saved++;
      if (result.rejected) failures++;
    } catch {
      failures++;
    }
  }
  return { registered: Number(r.created), duplicate: Number(!r.created), updated: Number(r.upgraded),
    filesSaved: saved, materialsPending: r.pending - saved, bodyPending: Number(!r.complete), failures };
}
async function run() {
  const dir = process.argv[2];
  if (dir === '--retry-ids') {
    console.log(JSON.stringify(await command({ op: 'retry' })));
    return;
  }
  if (!dir) throw Error('Supply a private snapshot directory');
  const metas = fs.readdirSync(dir).filter(x => /^gmail-[0-9a-f]+-meta\.json$/.test(x)).sort();
  const total = { messages: metas.length, registered: 0, duplicate: 0, updated: 0, filesSaved: 0,
    materialsPending: 0, bodyPending: 0, failures: 0 };
  for (const file of metas) {
    try {
      const row = await runOne(dir, inputFile(dir, file));
      for (const k of Object.keys(row)) total[k] += row[k];
    } catch { total.failures++; }
  }
  console.log(JSON.stringify(total));
  if (total.failures) process.exitCode = 1;
}
if (require.main === module) run().catch(() => {
  console.error('Unable to run the submission archive');
  process.exitCode = 1;
});
