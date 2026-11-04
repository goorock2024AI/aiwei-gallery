'use strict';
// Browser plugin not available: local Playwright/Edge with an isolated PostgreSQL clone.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process'),
  { Client } = require('pg');
const root = path.resolve(__dirname, '..'),
  cfg = JSON.parse(fs.readFileSync(path.join(root, 'tmp/m3-05-test.json')));
assert.equal(cfg.host, '127.0.0.1');
assert.equal(cfg.port, 55435);
const name = 'aiwei_artist_' + Date.now(),
  base = 'http://127.0.0.1:3159',
  tokens = {},
  results = [];
const evidence = path.join(root, 'tmp/artist-library');
fs.mkdirSync(evidence, { recursive: true });
const dir = path.join(evidence, 'private-files');
let db,
  child,
  browser,
  created = false,
  restored = false;
const authSecret = crypto.randomBytes(32).toString('hex');
const adminDb = new Client({ ...cfg, user: 'postgres', database: 'postgres' });
async function api(role, method, route = '', body, code = 200) {
  const res = await fetch(base + '/rest/v1/artist-library' + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Authorization: 'Bearer ' + tokens[role] } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const out = await res.json();
  assert.equal(res.status, code, JSON.stringify(out));
  results.push({ method, route, status: res.status });
  return out;
}
async function upload(role, name, data, code = 201) {
  const r = await fetch(
    base +
      '/rest/v1/artist-library/files?' +
      new URLSearchParams({ name, category: '作品集' }),
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tokens[role],
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    },
  );
  const out = await r.json();
  assert.equal(r.status, code, JSON.stringify(out));
  results.push({ method: 'UPLOAD', route: name, status: code });
  return out;
}
async function start(database = name, fileDir = dir) {
  const fd = fs.openSync(path.join(evidence, 'server.log'), 'a');
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_NAME: database,
      DB_PASS: cfg.password,
      AUTH_SECRET: authSecret,
      HOST: '127.0.0.1',
      PORT: '3159',
      STATIC_DIR: path.join(root, 'app'),
      UPLOAD_DIR: path.join(evidence, 'public'),
      ARTIST_FILE_DIR: fileDir,
    },
  });
  fs.closeSync(fd);
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/healthz')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Local API did not start; inspect ignored log');
}
async function stop() {
  if (child) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    child = null;
  }
}
async function digest() {
  return (
    await db.query(
      'SELECT md5(jsonb_agg(r ORDER BY id)::text) hash FROM artworks r',
    )
  ).rows[0].hash;
}
async function run() {
  await adminDb.connect();
  try {
    await adminDb.query(`CREATE DATABASE ${name} TEMPLATE aiwei_m3_05_test`);
    created = true;
    db = new Client({ ...cfg, user: 'postgres', database: name });
    await db.connect();
    await require('./artist-library-migrate')(db);
    await require('./artist-library-migrate')(db);
    const businessFingerprint = async () => {
      const values = {};
      for (const table of [
        'revenue',
        'expense',
        'gallery_sales',
        'space_usage',
        'daily_closings',
      ])
        values[table] = (
          await db.query(
            `SELECT md5(coalesce(jsonb_agg(r ORDER BY id)::text,'[]')) fingerprint FROM ${table} r`,
          )
        ).rows[0].fingerprint;
      return values;
    };
    const businessBefore = await businessFingerprint();
    await db.query(
      "INSERT INTO artworks(id,title,artist,medium,dimensions) VALUES('artist-work-fixture','地方记忆·01','林知远','摄影','60 × 90 cm') ON CONFLICT DO NOTHING",
    );
    await db.query("UPDATE artworks SET artwork_no='AT-LINK-001' WHERE id='artist-work-fixture'");
    const worksBefore = await digest();
    for (const role of ['admin', 'editor', 'viewer', 'other']) {
      const id = 'artist-test-' + role,
        username = id,
        payload = Buffer.from(
          JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 }),
        ).toString('base64url');
      await db.query(
        'INSERT INTO users(id,username,display_name,password_hash,role,is_active) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO UPDATE SET is_active=true',
        [
          id,
          username,
          '测试' + role,
          'unused',
          role === 'other' ? 'editor' : role,
        ],
      );
      tokens[role] =
        payload +
        '.' +
        crypto
          .createHmac('sha256', authSecret)
          .update(payload)
          .digest('base64url');
    }
    await start();
    await api('none', 'GET', '', undefined, 401);
    await api('viewer', 'POST', '', {}, 403);
    await api('editor', 'GET', '/options');
    await api('editor', 'POST', '', null, 400);
    const pdf = await new Promise((resolve) => {
      const doc = new (require('pdfkit'))(),
        chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.text('Artist portfolio - local fixture');
      doc.end();
    });
    await upload('editor', '坏文件.pdf', Buffer.from('not pdf'), 400);
    await upload('editor', '脚本.html', Buffer.from('<script>'), 400);
    const formats = [
      [
        '样本.doc',
        Buffer.concat([
          Buffer.from('d0cf11e0a1b11ae1', 'hex'),
          Buffer.alloc(504),
        ]),
      ],
      ['样本.docx', Buffer.from('PK\x03\x04sample')],
      [
        '样本.png',
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI1sAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
    ];
    for (const [filename, bytes] of formats) {
      const item = await upload('editor', filename, bytes);
      const r = await fetch(base + '/rest/v1/artist-library/files/' + item.id, {
        headers: { Authorization: 'Bearer ' + tokens.editor },
      });
      assert.equal(r.status, 200);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
    }
    const limitCode = await new Promise((resolve, reject) => {
      const r = require('node:http').request(
        base + '/rest/v1/artist-library/files?name=large.pdf',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + tokens.editor,
            'Content-Length': 201 * 1024 * 1024,
          },
        },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      );
      r.on('error', reject);
      r.end();
    });
    assert.equal(limitCode, 413);
    const f = await upload('editor', '作品集.pdf', pdf),
      f2 = await upload(
        'editor',
        '作品集.pdf',
        Buffer.concat([pdf, Buffer.from('\nnew')]),
      );
    assert.notEqual(f.id, f2.id);
    await api('other', 'GET', '/files/' + f.id, undefined, 404);
    const id = crypto.randomUUID(),
      data = {
        name: '林知远',
        source: '投稿邮件',
        relations: ['收藏', '合作', '招募投稿'],
        tags: '地方记忆，摄影',
        urls: 'https://example.org/a?x=1%2C2#作品，https://example.org/b,https://example.org/b,',
        bio: '<script>window.bad=true</script>',
        status: '待评估',
        location: '云南 · 昆明',
        medium: '摄影',
      };
    await api(
      'editor',
      'POST',
      '',
      { id: crypto.randomUUID(), data: { ...data, name: '' } },
      400,
    );
    await api(
      'editor',
      'POST',
      '',
      {
        id: crypto.randomUUID(),
        data: { ...data, urls: 'javascript:alert(1)' },
      },
      400,
    );
    await api(
      'other',
      'POST',
      '',
      { id: crypto.randomUUID(), data, fileIds: [f.id] },
      403,
    );
    const createdArtist = await api(
      'editor',
      'POST',
      '',
      { id, data, fileIds: [f.id] },
      201,
    );
    assert.equal(createdArtist.data.urls.length, 2);
    await api('editor', 'POST', '', { id, data, fileIds: [f.id] }, 201);
    assert.equal((await api('viewer', 'GET', '?q=林知远')).total, 1);
    await api(
      'editor',
      'POST',
      '',
      {
        id: crypto.randomUUID(),
        data: { ...data, source: '日常发现' },
        fileIds: [],
      },
      201,
    );
    assert.equal((await api('viewer', 'GET', '?q=林知远')).total, 2);
    const res = await fetch(base + '/rest/v1/artist-library/files/' + f.id, {
      headers: { Authorization: 'Bearer ' + tokens.viewer },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), pdf);
    assert.equal(
      (await fetch(base + '/rest/v1/artist-library/files/' + f.id)).status,
      401,
    );
    assert.ok(
      !(await fetch(base + '/uploads/' + f.id)).headers
        .get('content-type')
        ?.includes('pdf'),
    );
    let p = await api('editor', 'GET', '/' + id);
    await api('editor', 'PATCH', '/' + id, {
      data: { ...data, tags: '摄影' },
      fileIds: [f.id, f2.id],
      version: p.version,
    });
    await api(
      'editor',
      'PATCH',
      '/' + id,
      { data, fileIds: [f.id], version: p.version },
      409,
    );
    p = await api('editor', 'GET', '/' + id);
    assert.equal(p.files.length, 2);
    await api('editor', 'POST', '/' + id + '/works', {
      artworkId: 'artist-work-fixture',
    });
    await api('editor', 'POST', '/' + id + '/works', {
      artworkId: 'artist-work-fixture',
    });
    assert.equal((await api('editor', 'GET', '/' + id)).works.length, 1);
    const rid = crypto.randomUUID();
    await api(
      'editor',
      'POST',
      '/' + id + '/records',
      {
        id: rid,
        kind: 'submission',
        data: {
          title: '首次投稿',
          date: '2026-11-02',
          sender: '艺术家本人',
          emailSubject: '招募投稿',
          mailId: 'sample-mail-01',
          content: '投稿自述，未经独立核验',
          fileIds: [f.id],
        },
      },
      201,
    );
    await api(
      'editor',
      'POST',
      '/' + id + '/records',
      { id: rid, kind: 'submission', data: { title: '首次投稿' } },
      201,
    );
    await api(
      'editor',
      'POST',
      '/' + id + '/records',
      {
        id: crypto.randomUUID(),
        kind: 'submission',
        data: {
          title: '补充投稿',
          mailId: 'sample-mail-02',
          threadId: 'same-thread',
          fileIds: [f2.id],
        },
      },
      201,
    );
    await api(
      'editor',
      'POST',
      '/' + id + '/records',
      {
        id: crypto.randomUUID(),
        kind: 'followup',
        data: {
          title: '待看完整作品',
          nextAction: '核实作品信息',
          nextDate: '2026-11-05',
        },
      },
      201,
    );
    await api(
      'editor',
      'POST',
      '/' + id + '/records',
      {
        id: crypto.randomUUID(),
        kind: 'work',
        data: {
          title: '未入库作品',
          medium: '摄影',
          price: '',
          currency: 'CNY',
        },
      },
      201,
    );
    assert.equal((await api('editor', 'GET', '/' + id)).records.length, 4);
    assert.equal(await digest(), worksBefore);
    await api(
      'viewer',
      'POST',
      '/' + id + '/works',
      { artworkId: 'artist-work-fixture' },
      403,
    );
    p = await api('admin', 'GET', '/' + id);
    await api(
      'editor',
      'POST',
      '/' + id + '/archive',
      { archived: true, version: p.version },
      403,
    );
    await api('admin', 'POST', '/' + id + '/archive', {
      archived: true,
      version: p.version,
    });
    await api('viewer', 'GET', '/' + id, undefined, 404);
    await api('viewer', 'GET', '/files/' + f.id, undefined, 404);
    p = await api('admin', 'GET', '/' + id);
    await api('admin', 'POST', '/' + id + '/archive', {
      archived: false,
      version: p.version,
    });
    const zip = Buffer.alloc(150 * 1024 * 1024);
    zip.write('PK\x03\x04');
    const big = await upload('editor', '大型作品集.zip', zip);
    assert.equal(Number(big.size), zip.length);
    assert.equal(
      big.sha256,
      crypto.createHash('sha256').update(zip).digest('hex'),
    );
    await api('editor', 'DELETE', '/files/' + big.id);
    const expiredPart = path.join(dir, crypto.randomUUID() + '.part'),
      recentPart = path.join(dir, crypto.randomUUID() + '.part');
    fs.writeFileSync(expiredPart, 'interrupted');
    fs.writeFileSync(recentPart, 'active');
    fs.utimesSync(expiredPart, new Date(0), new Date(0));
    const expired = await upload('editor', '过期待存.pdf', pdf);
    await db.query(
      "UPDATE artist_files SET created_at=now()-interval '8 days' WHERE id=ANY($1::text[])",
      [[expired.id, f.id, big.id]],
    );
    await require('./artist-library-cleanup')(db, dir, 7);
    assert.ok(!fs.existsSync(path.join(dir, expired.id)));
    assert.ok(fs.existsSync(path.join(dir, f.id)));
    assert.ok(!fs.existsSync(path.join(dir, big.id)));
    assert.ok(!fs.existsSync(expiredPart));
    assert.ok(fs.existsSync(recentPart));
    await stop();
    await start();
    const afterRestart = await fetch(
      base + '/rest/v1/artist-library/files/' + f.id,
      { headers: { Authorization: 'Bearer ' + tokens.viewer } },
    );
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()), pdf);
    // Extract a profile and its file as a sample backup before the full restore test below.
    const backed = await db.query('SELECT * FROM artist_profiles WHERE id=$1', [
      id,
    ]);
    const backup = path.join(evidence, 'backup-sample');
    fs.mkdirSync(backup, { recursive: true });
    fs.copyFileSync(path.join(dir, f.id), path.join(backup, f.id));
    fs.writeFileSync(
      path.join(backup, 'profile.json'),
      JSON.stringify(backed.rows[0]),
    );
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(backup, f.id)))
        .digest('hex'),
      f.sha256,
    );
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      }),
      errors = [],
      consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    await page.addInitScript(
      (token) =>
        sessionStorage.setItem(
          'aiwei_user',
          JSON.stringify({
            token,
            role: 'editor',
            displayName: '资料管理员',
            needPasswordChange: false,
          }),
        ),
      tokens.editor,
    );
    await page.goto(base + '/index.html#artists');
    await page.locator('.al-person').first().waitFor();
    await page
      .locator('.al-person')
      .filter({ hasText: '林知远' })
      .first()
      .click();
    await page.locator('.al-tabs').waitFor();
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await page.route('**/rest/v1/artist-library/' + id, async (route) => {
      await new Promise((r) => setTimeout(r, 350));
      await route.continue();
    });
    await page.locator('.al-person[data-id="' + id + '"]').click();
    await page
      .getByRole('button', { name: '＋ 新建艺术家', exact: true })
      .click();
    await page.locator('#al-artist-form').waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.locator('[name=name]').inputValue(), '');
    await page.unroute('**/rest/v1/artist-library/' + id);
    assert.equal(await page.locator('[name=urls]').count(), 1);
    await page.locator('[name=name]').fill('周予安');
    await page.locator('[name=source]').fill('日常发现');
    await page.locator('[name=location]').fill('云南 · 昆明');
    await page.locator('[name=medium]').fill('油画');
    await page
      .locator('[name=bio]')
      .fill('从地方风景与日常生活出发，探索人与自然的关系。');
    await page
      .locator('[name=urls]')
      .fill('https://example.org/artist，https://example.org/works');
    await page.getByLabel('合作', { exact: true }).check();
    await page.getByRole('button',{name:'关联画廊作品',exact:true}).click();
    await page.locator('dialog [name=q]').fill('AT-LINK-001');
    await page.locator('dialog').getByRole('button',{name:'搜索',exact:true}).click();
    await page.locator('dialog input[type=checkbox][value="artist-work-fixture"]').check();
    await page.getByRole('button',{name:'确认关联',exact:true}).click();
    await page.locator('#al-form-works').getByText(/地方记忆/).waitFor();
    await page
      .locator('#al-files-upload')
      .setInputFiles({
        name: '新作品集.pdf',
        mimeType: 'application/pdf',
        buffer: pdf,
      });
    await page.getByText('上传完成，请保存档案', { exact: true }).waitFor();
    await page.locator('#al-work-images').setInputFiles({name:'代表作品.png',mimeType:'image/png',buffer:formats[2][1]});
    await page.waitForFunction(()=>document.querySelector('#al-work-image-cards img')?.naturalWidth>0);
    await page.getByText('上传完成，请保存档案',{exact:true}).waitFor();
    await page
      .locator('#al-avatar-upload')
      .setInputFiles({
        name: '头像.png',
        mimeType: 'image/png',
        buffer: formats[2][1],
      });
    await page.waitForFunction(
      () => document.querySelector('.al-portrait img')?.naturalWidth > 0,
    );
    await page.getByText('上传完成，请保存档案', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(evidence, 'entry-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.getElementById('sidebar').getBoundingClientRect().right <= 0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      '390px form overflow',
    );
    await page.screenshot({
      path: path.join(evidence, 'entry-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: '保存档案', exact: true }).click();
    await page.getByRole('heading', { name: '周予安', exact: true }).waitFor();
    await page.getByRole('button',{name:'作品',exact:true}).click();
    await page.locator('.al-table').getByText('地方记忆·01',{exact:true}).waitFor();
    await page.locator('.al-work-images img[alt="代表作品.png"]').waitFor();
    await page.getByRole('button',{name:'查看大图',exact:true}).click();
    await page.locator('dialog').waitFor();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button', { name: '文档附件', exact: true }).click();
    await page.getByText('新作品集.pdf', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(evidence, 'detail-desktop.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: '预览', exact: true })
      .first()
      .click();
    await page.locator('dialog').waitFor();
    await page.waitForTimeout(1800);
    await page.screenshot({
      path: path.join(evidence, 'pdf-preview.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const dlPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '下载', exact: true })
      .first()
      .click();
    const dl = await dlPromise;
    assert.equal(dl.suggestedFilename(), '新作品集.pdf');
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.locator('[name=alias]').fill('予安');
    await page.getByRole('button', { name: '保存档案', exact: true }).click();
    await page.getByRole('button', { name: '投稿与跟进', exact: true }).click();
    await page.getByRole('button', { name: '添加跟进', exact: true }).click();
    await page.locator('.al-record-form [name=title]').fill('准备看原作');
    await page
      .locator('.al-record-form [name=content]')
      .fill('联系艺术家，了解作品可用性。');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await page.getByRole('heading', { name: /准备看原作/ }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.getElementById('sidebar').getBoundingClientRect().right <= 0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      '390px detail overflow',
    );
    await page.screenshot({
      path: path.join(evidence, 'detail-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      '320px overflow',
    );
    const viewer = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    viewer.on('pageerror', (e) => errors.push(e.message));
    await viewer.addInitScript(
      (token) =>
        sessionStorage.setItem(
          'aiwei_user',
          JSON.stringify({
            token,
            role: 'viewer',
            displayName: '查看者',
            needPasswordChange: false,
          }),
        ),
      tokens.viewer,
    );
    await viewer.goto(base + '/index.html');
    await viewer.locator('[data-tab=artists]').click();
    await viewer.locator('.al-person').first().waitFor();
    await viewer.locator('.al-person').first().click();
    await viewer.locator('.al-tabs').waitFor();
    assert.equal(
      await viewer
        .getByRole('button', { name: '编辑资料', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await viewer
        .getByRole('button', { name: '＋ 新建艺术家', exact: true })
        .count(),
      0,
    );
    const reverseId=crypto.randomUUID();
    await api('editor','POST','',{id:reverseId,data:{name:'反向关联测试',source:'测试',urls:[],tags:[]},fileIds:[]},201);
    await page.setViewportSize({width:1440,height:1100});
    await page.evaluate(()=>UI._showArtworkModal({id:'artist-work-fixture',title:'地方记忆·01',artist:'林知远'},true));
    await page.getByRole('button',{name:'关联艺术家档案',exact:true}).click();
    await page.locator('dialog [name=q]').fill('反向关联测试');
    await page.getByRole('button',{name:'搜索艺术家',exact:true}).click();
    await page.locator('dialog [data-link="'+reverseId+'"]').click();
    await page.locator('dialog [data-unlink="'+reverseId+'"]').waitFor();
    assert.equal((await api('editor','GET','/'+reverseId)).works.length,1);
    await page.locator('dialog [data-unlink="'+reverseId+'"]').click();
    await page.locator('dialog [data-link="'+reverseId+'"]').waitFor();
    assert.equal((await api('editor','GET','/'+reverseId)).works.length,0);
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await page.locator('.modal-overlay #aw-save-btn').evaluate(el=>el.closest('.modal-overlay').remove());
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    assert.equal(await digest(), worksBefore);
    assert.deepEqual(await businessFingerprint(), businessBefore);
    assert.equal((await api('editor', 'GET', '/' + id)).data.name, '林知远');
    // Real PostgreSQL dump/restore of all library entities, plus private file restore.
    const dump = path.join(evidence, 'artist-backup.dump'),
      pgbin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
    const pgargs = ['-h', cfg.host, '-p', String(cfg.port), '-U', 'postgres'];
    const runPg = (exe, args) => {
      const r = spawnSync(path.join(pgbin, exe), args, {
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: cfg.password },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
    };
    runPg('pg_dump.exe', [
      ...pgargs,
      '-d',
      name,
      '-Fc',
      '-f',
      dump,
      ...[
        'artist_profiles',
        'artist_files',
        'artist_artwork_links',
        'artist_records',
      ].map((t) => '--table=' + t),
    ]);
    await stop();
    await adminDb.query(
      `CREATE DATABASE ${name}_restore TEMPLATE aiwei_m3_05_test`,
    );
    restored = true;
    const restoreDb = new Client({
      ...cfg,
      user: 'postgres',
      database: name + '_restore',
    });
    await restoreDb.connect();
    try {
      await restoreDb.query(
        "INSERT INTO artworks(id,title,artist) VALUES('artist-work-fixture','地方记忆·01','林知远') ON CONFLICT DO NOTHING",
      );
      runPg('pg_restore.exe', [
        ...pgargs,
        '-d',
        name + '_restore',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        dump,
      ]);
      const user = (
        await db.query("SELECT * FROM users WHERE id='artist-test-viewer'")
      ).rows[0];
      await restoreDb.query(
        'INSERT INTO users(id,username,display_name,password_hash,role,is_active) VALUES($1,$2,$3,$4,$5,true)',
        [
          user.id,
          user.username,
          user.display_name,
          user.password_hash,
          user.role,
        ],
      );
      assert.equal(
        (await restoreDb.query('SELECT count(*) FROM artist_records')).rows[0]
          .count,
        (await db.query('SELECT count(*) FROM artist_records')).rows[0].count,
      );
    } finally {
      await restoreDb.end();
    }
    const restoredDir = path.join(evidence, 'restored-files');
    fs.mkdirSync(restoredDir, { recursive: true });
    for (const f of (
      await db.query("SELECT id FROM artist_files WHERE state='active'")
    ).rows)
      fs.copyFileSync(path.join(dir, f.id), path.join(restoredDir, f.id));
    await start(name + '_restore', restoredDir);
    const restoredFile = await fetch(
      base + '/rest/v1/artist-library/files/' + f.id,
      { headers: { Authorization: 'Bearer ' + tokens.viewer } },
    );
    assert.equal(restoredFile.status, 200);
    assert.deepEqual(Buffer.from(await restoredFile.arrayBuffer()), pdf);
    fs.writeFileSync(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          httpChecks: results.length,
          checks: results,
          pageErrors: errors,
          scenarios: [
            'create/edit/search',
            'private files',
            '150MB upload',
            'restart durability',
            'staged cleanup',
            'role permissions',
            'optimistic concurrency',
            'idempotence',
            'same-name profiles',
            'work links preserve old facts',
            'submission provenance',
            'followups',
            'archive restore',
            'browser form/save/preview/download/edit/record',
            '390/320 responsive',
            'XSS escape',
            'sample backup restore',
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        status: 'passed',
        httpChecks: results.length,
        pageErrors: errors,
        screenshots: [
          'entry-desktop.png',
          'detail-desktop.png',
          'entry-mobile.png',
          'detail-mobile.png',
        ],
      }),
    );
  } finally {
    if (browser) await browser.close();
    await stop();
    if (db) await db.end();
    if (restored) {
      await adminDb.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',
        [name + '_restore'],
      );
      await adminDb.query(`DROP DATABASE ${name}_restore`);
    }
    if (created) {
      await adminDb.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',
        [name],
      );
      await adminDb.query(`DROP DATABASE ${name}`);
    }
    await adminDb.end();
  }
}
run().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
