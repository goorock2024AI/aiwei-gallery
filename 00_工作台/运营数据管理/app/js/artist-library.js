/* Artist Library: manual intake, private attachments and source history. */
'use strict';
const ArtistLibrary = (() => {
  const s = {
    rows: [],
    total: 0,
    page: 1,
    q: '',
    relation: '',
    status: '',
    archived: false,
    selected: null,
    detail: null,
    tab: 'overview',
    mode: 'list',
    options: null,
    files: [],
    formWorks: [],
    recordKind: null,
    works: [],
    busy: false,
    dirty: false,
    urls: new Map(),
  };
  let root,
    timer,
    seq = 0,
    detailSeq = 0;
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const write = () => ['admin', 'editor'].includes(Auth.currentUser?.role);
  const admin = () => Auth.currentUser?.role === 'admin';
  const date = (v) =>
    v
      ? new Date(v).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : '—';
  const size = (v) =>
    Number(v) < 1024
      ? Number(v) + ' B'
      : Number(v) < 1024 * 1024
        ? (Number(v) / 1024).toFixed(0) + ' KB'
        : (Number(v) / 1024 / 1024).toFixed(1) + ' MB';
  const owner = (id) =>
    s.options?.staff.find((u) => u.id === id)?.display_name ||
    s.options?.staff.find((u) => u.id === id)?.username ||
    id ||
    '未分配';
  const api = (path = '', method = 'GET', body) =>
    Auth._fetch(method, '/rest/v1/artist-library' + path, body);
  function toast(message, error = false) {
    UI.toast(message, error ? 'error' : 'success');
  }
  function status(error) {
    const el = root?.querySelector('[data-error]');
    if (el) {
      el.textContent = error?.message || '';
      el.hidden = !error;
    }
    if (error) toast(error.message, true);
  }
  async function bytes(id, preview = false) {
    const base = await Store._ensureClient();
    const res = await fetch(
      base +
        '/rest/v1/artist-library/files/' +
        encodeURIComponent(id) +
        (preview ? '?preview=1' : ''),
      { headers: Auth.authHeaders() },
    );
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error || e.message || '文件读取失败');
    }
    return res.blob();
  }
  async function images() {
    for (const img of root.querySelectorAll('img[data-artist-file]')) {
      const id = img.dataset.artistFile;
      try {
        if (!s.urls.has(id))
          s.urls.set(id, URL.createObjectURL(await bytes(id, true)));
        if (img.isConnected) img.src = s.urls.get(id);
      } catch {
        img.hidden = true;
      }
    }
  }
  function button(action, label, extra = '', cls = '') {
    return `<button type="button" class="al-button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
  }
  function pills(items) {
    return (items || [])
      .map((t) => `<span class="al-tag">${esc(t)}</span>`)
      .join('');
  }
  function top(title, sub, actions = '') {
    return `<header class="al-top"><div><div class="al-breadcrumb">资源管理 / 艺术家资料库${s.mode === 'form' ? ' / ' + (s.detail ? '编辑艺术家' : '新建艺术家') : ''}</div><h1>${title}</h1><p>${sub}</p></div><div class="al-actions">${actions}</div></header><div class="al-error" data-error role="alert" hidden></div>`;
  }
  async function list() {
    const my = ++seq;
    const r = await api(
      '?' +
        new URLSearchParams({
          q: s.q,
          relation: s.relation,
          status: s.status,
          archived: s.archived,
          page: s.page,
        }),
    );
    if (my !== seq) return;
    s.rows = r.rows;
    s.total = r.total;
    s.page = r.page;
    paintList();
  }
  function paintList() {
    const el = root.querySelector('.al-list-rows');
    if (!el) return;
    el.innerHTML = s.rows.length
      ? s.rows
          .map(
            (p) =>
              `<button type="button" class="al-person ${s.selected === p.id ? 'selected' : ''}" data-action="select" data-id="${esc(p.id)}"><span class="al-list-avatar">${p.data.avatarId ? `<img data-artist-file="${esc(p.data.avatarId)}" alt="${esc(p.data.name)}头像">` : esc(p.data.name.slice(0, 1))}</span><span><strong>${esc(p.data.name)}</strong><small>${esc(p.data.medium || '创作方向待补充')}</small><small>${esc(p.data.location || '所在地待补充')}</small></span><span class="al-person-end">${pills(p.data.relations)}<small>${esc(p.data.status)}</small><small>${p.file_count} 份附件</small></span></button>`,
          )
          .join('')
      : '<div class="al-empty">' +
        (s.q || s.relation || s.status
          ? '没有匹配的艺术家，请调整筛选'
          : '还没有艺术家档案，从“新建艺术家”开始') +
        '</div>';
    root.querySelector('.al-list-footer').innerHTML =
      `<span>共 ${s.total} 位艺术家</span><span>${button('prev', '上一页', s.page === 1 ? 'disabled' : '')}${s.page}${button('next', '下一页', s.page * 30 >= s.total ? 'disabled' : '')}</span>`;
    images();
  }
  function shell() {
    detailSeq++;
    s.mode = 'list';
    root.innerHTML =
      top(
        '艺术家资料库',
        '沉淀艺术家资料，为策展与合作做好准备',
        `${admin() ? button('archived', s.archived ? '查看在用档案' : '已归档档案') : ''}${write() ? button('mail-list', '邮件投稿') + button('new', '＋ 新建艺术家', '', 'primary') : ''}`,
      ) +
      `<div class="al-workspace"><section class="al-list" aria-label="艺术家列表"><div class="al-search"><input id="al-search" aria-label="搜索艺术家" placeholder="搜索艺术家、方向、附件" value="${esc(s.q)}"><div class="al-filter-row"><select id="al-relation" aria-label="关系筛选"><option value="">全部关系</option>${s.options.relations.map((t) => `<option ${t === s.relation ? 'selected' : ''}>${t}</option>`).join('')}</select><select id="al-status" aria-label="跟进状态筛选"><option value="">全部状态</option>${s.options.statuses.map((t) => `<option ${t === s.status ? 'selected' : ''}>${t}</option>`).join('')}</select></div>${s.archived ? '<p class="al-muted">正在查看已归档档案</p>' : ''}</div><div class="al-list-rows"></div><div class="al-list-footer"></div></section><section class="al-detail" aria-label="艺术家详情"><div class="al-empty">选择一位艺术家查看资料</div></section></div>`;
    paintList();
    if (s.detail) detail();
  }
  async function select(id) {
    if (s.mode !== 'list') return;
    const request = ++detailSeq;
    s.selected = id;
    const data = await api('/' + encodeURIComponent(id));
    if (request !== detailSeq || s.mode !== 'list' || s.selected !== id) return;
    s.detail = data;
    s.recordKind = null;
    paintList();
    detail();
  }
  async function mailList(page = 1, filter = s.mailFilter || 'pending') {
    s.mode = 'mail';
    s.mailFilter = filter;
    s.mailPage = page;
    const request = ++detailSeq;
    root.innerHTML = top('邮件投稿', '原始邮件和附件直接保存到资料库，确认后再关联艺术家', button('mail-exit', '返回艺术家资料库')) +
      '<div class="al-mail-panel al-empty">正在读取邮件投稿…</div>';
    const data = await api('/mail?' + new URLSearchParams({ page, filter }));
    if (request !== detailSeq || s.mode !== 'mail') return;
    root.querySelector('.al-mail-panel').outerHTML = `<section class="al-mail-panel">
      <div class="al-actions">${[['pending','待处理'],['assigned','已关联'],['all','全部']].map(([value,label]) =>
        button('mail-filter', label, `data-filter="${value}" aria-pressed="${filter === value}"`, filter === value ? 'primary' : '')).join('')}</div>
      ${data.rows.length ? `<div class="al-table-wrap"><table class="al-table"><thead><tr><th>投稿邮件</th><th>档案</th><th>材料</th><th></th></tr></thead><tbody>
      ${data.rows.map(m => `<tr><td><strong>${esc(m.subject || '无主题')}</strong><small>${esc(m.sender)} · ${date(m.received_at)}</small></td>
        <td>${esc(m.artist_name || '待关联')}</td><td>${m.saved} 份已保存${m.pending ? ` · ${m.pending} 份待补` : ''}${m.source_complete ? '' : ' · 正文待取'}</td>
        <td>${button('mail-detail', '查看投稿', `data-id="${esc(m.id)}"`)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="al-empty">当前没有投稿</div>'}
      <div class="al-actions">${button('mail-prev', '上一页', page <= 1 ? 'disabled' : '')}<span>第 ${page} 页</span>${button('mail-next', '下一页', data.more ? '' : 'disabled')}</div>
    </section>`;
  }
  async function mailDetail(id) {
    s.mode = 'mail-detail';
    const request = ++detailSeq;
    const m = await api('/mail/' + encodeURIComponent(id));
    if (request !== detailSeq || s.mode !== 'mail-detail') return;
    root.innerHTML = top('邮件投稿详情', '核对原邮件、附件与艺术家身份', button('mail-back', '返回投稿列表')) +
      `<section class="al-mail-panel"><h2>${esc(m.subject || '无主题')}</h2>
      <p class="al-muted">${esc(m.sender)} · ${date(m.received_at)}</p>
      <p><a target="_blank" rel="noopener noreferrer" href="https://mail.google.com/mail/u/?authuser=${encodeURIComponent(m.mailbox)}#all/${encodeURIComponent(m.message_id)}">在 Gmail 打开原邮件 ↗</a></p>
      ${m.source_complete ? '' : '<p class="al-muted">目前仅取得邮件摘要，正文待补。</p>'}
      <details class="al-mail-body"><summary>邮件正文</summary><p class="al-prose">${esc(m.body || '无正文')}</p></details>
      <h3>投稿材料</h3>
      ${m.items.length ? `<div class="al-table-wrap"><table class="al-table"><thead><tr><th>名称</th><th>状态</th><th>操作</th></tr></thead><tbody>${m.items.map(i =>
        `<tr><td>${esc(i.original_name || i.name)}${i.url ? ` <a target="_blank" rel="noopener noreferrer" href="${esc(i.url)}">打开原链接 ↗</a>` : ''}</td>
          <td>${i.state === 'active' ? '原件已保存' : i.file_id ? '已从档案移除，来源保留' : esc(i.reason)}</td>
          <td>${i.state === 'active' ? button('download', '下载原件', `data-id="${esc(i.file_id)}"`) : i.file_id ? '' :
            `<form class="al-mail-supplement" data-import="${esc(m.id)}" data-item="${esc(i.item_key)}"><input aria-label="选择待补原件" name="file" type="file" required accept=".pdf,.doc,.docx,.zip,.rar,.7z,.png,.jpg,.jpeg,.gif,.webp"><button type="submit" class="al-button">补传原件</button></form>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="al-muted">未发现附件或下载链接</p>'}
      <h3>关联艺术家</h3>${m.artist_id ? button('mail-profile', '查看已关联艺术家', `data-id="${esc(m.artist_id)}"`) :
        `<form class="al-mail-search"><label class="al-field"><span>查找已有艺术家</span><input required name="q" maxlength="200" placeholder="输入姓名或艺名"></label><button class="al-button" type="submit">搜索</button></form>
        <div id="al-mail-matches" aria-live="polite"></div>
        <details><summary>确认资料库里没有该艺术家，再新建档案</summary>
        <form class="al-mail-assign" data-import="${esc(m.id)}">${field('name','姓名 / 艺名','','text',true)}
        <button class="al-button primary" type="submit">新建并关联</button></form></details>`}
      </section>`;
    root.querySelector('#al-mail-matches')?.setAttribute('data-import', m.id);
  }
  async function mailProfile(id) {
    s.archived = false;
    s.detail = null;
    s.tab = 'records';
    shell();
    await Promise.all([list(), select(id)]);
  }
  function detail() {
    const el = root.querySelector('.al-detail');
    if (!el || !s.detail) return;
    const p = s.detail,
      d = p.data;
    el.innerHTML = `<div class="al-profile-head"><div class="al-avatar">${d.avatarId ? `<img data-artist-file="${esc(d.avatarId)}" alt="${esc(d.name)}头像">` : '<span>暂无头像</span>'}</div><div class="al-profile-title"><h2>${esc(d.name)}${p.archived ? ' <small>已归档</small>' : ''}</h2><p>${esc(d.medium || '创作方向待补充')} · ${esc(d.location || '所在地待补充')}</p><div>${pills(d.relations)}<span class="al-tag warm">${esc(d.status)}</span></div><p class="al-bio">${esc(d.bio || '个人简介待补充')}</p><small>负责人 ${esc(owner(d.owner))} · 最近更新 ${date(p.updated_at)}</small></div><div class="al-profile-tools">${write() && !p.archived ? button('edit', '编辑资料') : ''}${admin() ? button('archive', p.archived ? '恢复档案' : '归档') : ''}</div></div><nav class="al-tabs" aria-label="档案栏目">${[
      ['overview', '资料总览'],
      ['works', '作品'],
      ['urls', '外部链接'],
      ['files', '文档附件'],
      ['records', '投稿与跟进'],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" data-action="tab" data-tab="${key}" class="${s.tab === key ? 'active' : ''}" aria-current="${s.tab === key ? 'page' : 'false'}">${label}</button>`,
      )
      .join('')}</nav><div class="al-tab-body">${tabContent()}</div>`;
    images();
  }
  function tabContent() {
    const p = s.detail,
      d = p.data,
      editable = write() && !p.archived;
    if (s.tab === 'overview')
      return `<div class="al-section-title"><h3>已关联画廊作品 ${p.works.length} 件</h3>${editable ? button('find-works', '关联画廊作品') : ''}</div>${p.works.map((w) => `<p>${esc(w.artwork_no || '')} ${esc(w.title)}</p>`).join('')}<h3>基本资料</h3><dl class="al-facts">${[
        ['别名', d.alias],
        ['联系邮箱', d.email],
        ['联系电话', d.phone],
        ['其他联系方式', d.otherContact],
        ['资料来源', d.source],
        ['推荐人', d.referrer],
        ['工作室 / 代理', d.agency],
        ['主题标签', (d.tags || []).join('、')],
      ]
        .map(
          ([label, val]) =>
            `<div><dt>${label}</dt><dd>${esc(val || '待补充')}</dd></div>`,
        )
        .join('')}</dl>${[
        ['教育经历', d.education],
        ['展览履历', d.exhibitions],
        ['收藏依据', d.collectionEvidence],
        ['内部备注', d.notes],
      ]
        .map(
          ([title, val]) =>
            `<h3>${title}</h3><p class="al-prose">${esc(val || '待补充')}</p>`,
        )
        .join('')}`;
    if (s.tab === 'urls')
      return `<div class="al-section-title"><h3>外部链接 <small>${d.urls.length}</small></h3>${editable ? button('edit', '编辑链接') : ''}</div><p class="al-muted">报道、个人网站、线上作品集</p>${d.urls.length ? `<ul class="al-urls">${d.urls.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul>` : '<div class="al-empty">尚未添加外部链接</div>'}`;
    if (s.tab === 'files')
      return `<div class="al-section-title"><h3>文档附件 <small>${p.files.length}</small></h3>${editable ? button('edit', '上传 / 管理文件', '', 'primary') : ''}</div><p class="al-muted">实际文件已保存至资料库，可追溯关联投稿</p>${filesTable(p.files)}<h3>来源投稿</h3>${records('submission')}`;
    if (s.tab === 'works')
      return `<h3>艺术家作品图片</h3>${workImageCards(p.files, false)}<div class="al-section-title"><h3>关联画廊作品</h3><div class="al-actions">${editable ? button('add-work', '记录投稿作品') + button('find-works', '关联画廊作品', '', 'primary') : ''}</div></div><p class="al-muted">关联现有作品档案；投稿作品记录不会自动成为可售库存</p><div id="al-work-search"></div>${p.works.length ? `<div class="al-table-wrap"><table class="al-table"><thead><tr><th>作品</th><th>媒介 / 尺寸</th><th>状态</th>${editable ? '<th>操作</th>' : ''}</tr></thead><tbody>${p.works.map((w) => `<tr><td>${galleryThumbnail(w)}<strong>${esc(w.title)}</strong><small>${esc(w.artwork_no || '')} ${esc(w.artist)}</small></td><td>${esc(w.medium || '待补充')}<small>${esc(w.dimensions)}</small></td><td>${esc(w.status)}</td>${editable ? `<td>${button('unlink', '解除关联', `data-id="${esc(w.id)}"`)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="al-empty">尚未关联现有作品</div>'}<h3>投稿作品线索</h3>${records('work')}${s.recordKind === 'work' ? recordForm('work') : ''}`;
    return `<div class="al-section-title"><h3>投稿与跟进</h3><div class="al-actions">${editable ? button('add-submission', '登记投稿') + button('add-followup', '添加跟进', '', 'primary') : ''}</div></div>${s.recordKind ? recordForm(s.recordKind) : ''}<h3>投稿记录</h3>${records('submission')}<h3>跟进记录</h3>${records('followup')}`;
  }
  function filesTable(files) {
    return files.length
      ? `<div class="al-table-wrap"><table class="al-table"><thead><tr><th>文件名称</th><th>分类 / 状态</th><th>操作</th></tr></thead><tbody>${files.map((f) => `<tr><td><strong>${esc(f.original_name)}</strong><small>${esc(f.mime.split('/').pop())} · ${size(f.size)}</small></td><td>${esc(f.category)}<small class="al-success">已归档</small></td><td><div class="al-actions">${f.mime === 'application/pdf' || f.mime.startsWith('image/') ? button('preview', '预览', `data-id="${esc(f.id)}"`) : ''}${button('download', '下载', `data-id="${esc(f.id)}"`)}</div></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="al-empty">尚未归档附件</div>';
  }
  function records(kind) {
    const rows = s.detail.records.filter((r) => r.kind === kind);
    return rows.length
      ? rows
          .map(
            (r) =>
              `<article class="al-record"><h4>${esc(r.data.title)} <small>${esc(r.data.date || date(r.created_at))}</small></h4>${kind === 'submission' ? `<p class="al-muted">${esc(r.data.sender || '发件人待补充')} · ${esc(r.data.emailSubject || '主题待补充')}</p><small>邮箱 ${esc(r.data.mailbox || '待补充')} · 邮件标识 ${esc(r.data.mailId || '待补充')} · 线程 ${esc(r.data.threadId || '待补充')}</small>${r.data.mailImportId && write() ? ` <div>${button('mail-detail', '查看邮件与待补材料', `data-id="${esc(r.data.mailImportId)}"`)}</div>` : ''}` : ''}${kind === 'work' ? `<p class="al-muted">${esc([r.data.medium, r.data.dimensions, r.data.year].filter(Boolean).join(' · '))}</p><small>报价 ${esc(r.data.price ? `${r.data.price} ${r.data.currency || ''}` : '未知')}</small>` : ''}<p class="al-prose">${esc(r.data.content || '未填写正文')}</p>${r.data.nextAction ? `<p>下一步：${esc(r.data.nextAction)} ${esc(r.data.nextDate || '')}</p>` : ''}${
                r.data.fileIds?.length
                  ? `<div class="al-actions">${r.data.fileIds
                      .map((id) => {
                        const f = s.detail.files.find((f) => f.id === id);
                        return f
                          ? button(
                              'download',
                              esc(f.original_name),
                              `data-id="${esc(id)}"`,
                            )
                          : '<span class="al-muted">附件已从当前档案移除，来源记录保留</span>';
                      })
                      .join('')}</div>`
                  : ''
              }</article>`,
          )
          .join('')
      : '<p class="al-muted al-empty-small">暂无记录</p>';
  }
  function field(name, label, value = '', type = 'text', required = false) {
    return `<label class="al-field"><span>${required ? '<em>*</em> ' : ''}${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} maxlength="${type === 'email' ? 300 : 1000}"></label>`;
  }
  function area(name, label, value = '', rows = 3) {
    return `<label class="al-field"><span>${label}</span><textarea name="${name}" rows="${rows}" maxlength="12000">${esc(value)}</textarea></label>`;
  }
  function recordForm(kind) {
    const data = s.recordDraft || { id: crypto.randomUUID() };
    s.recordDraft = data;
    return `<form class="al-record-form" data-record-kind="${kind}"><h4>${{ work: '记录投稿作品', submission: '登记投稿', followup: '添加跟进' }[kind]}</h4><div class="al-grid">${field('title', kind === 'work' ? '作品名称' : '记录标题', '', 'text', true)}${field('date', kind === 'submission' ? '收到日期' : '日期', '', 'date')}${kind === 'submission' ? field('sender', '发件人') + field('emailSubject', '邮件主题') + field('mailbox', '来源邮箱') + field('mailId', '邮件标识') + field('threadId', '线程标识') : ''}${kind === 'work' ? field('medium', '媒介') + field('dimensions', '尺寸') + field('year', '年代') + field('price', '报价（未知可留空）') + field('currency', '币种') : ''}</div>${area('content', kind === 'submission' ? '邮件正文 / 投稿内容' : '内容说明')}${kind === 'followup' ? `<div class="al-grid">${field('nextAction', '下一步动作')}${field('nextDate', '计划跟进日期', '', 'date')}</div>` : ''}${s.detail.files.length ? `<fieldset class="al-record-files"><legend>关联已归档附件</legend>${s.detail.files.map((f) => `<label><input type="checkbox" name="fileIds" value="${esc(f.id)}"> ${esc(f.original_name)}</label>`).join('')}</fieldset>` : ''}<div class="al-actions">${button('cancel-record', '取消')}<button class="al-button primary" type="submit">保存记录</button></div><p class="al-muted">保留来源和判断依据，不自动改变录用、库存或销售状态</p></form>`;
  }
  function form(p = null) {
    detailSeq++;
    s.mode = 'form';
    s.detail = p;
    s.files = p ? [...p.files] : [];
    s.formWorks = p ? [...p.works] : [];
    s.formId = p?.id || crypto.randomUUID();
    s.dirty = false;
    const d = p?.data || {},
      opts = (items, current) =>
        items
          .map(
            (t) =>
              `<option value="${esc(t)}" ${t === current ? 'selected' : ''}>${esc(t)}</option>`,
          )
          .join('');
    root.innerHTML =
      top(
        p ? '编辑艺术家' : '新建艺术家',
        '先建立档案，再逐步补充作品与合作资料',
        button('cancel-form', '返回资料库'),
      ) +
      `<form id="al-artist-form"><div class="al-form-columns"><div><section><h2>基本资料</h2><div class="al-intake-head"><div class="al-grow"><div class="al-grid">${field('name', '姓名 / 艺名', d.name, 'text', true)}${field('alias', '别名', d.alias)}</div><div class="al-grid">${field('location', '所在地', d.location)}${field('medium', '创作媒介', d.medium)}</div></div><div class="al-portrait"><div class="al-avatar">${d.avatarId ? `<img data-artist-file="${esc(d.avatarId)}" alt="艺术家头像">` : '<span>头像选填</span>'}</div><label class="al-button">上传头像<input type="file" id="al-avatar-upload" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${d.avatarId ? button('remove-avatar', '移除头像') : ''}<input type="hidden" name="avatarId" value="${esc(d.avatarId || '')}"></div></div>${field('tags', '主题标签（用逗号分隔）', (d.tags || []).join('，'))}${area('bio', '个人简介', d.bio, 4)}<details><summary>教育、展览与其他资料</summary>${area('education', '教育经历', d.education)}${area('exhibitions', '展览履历', d.exhibitions)}${field('agency', '工作室 / 代理', d.agency)}${field('otherContact', '其他联系方式', d.otherContact)}${area('collectionEvidence', '收藏依据', d.collectionEvidence)}</details></section><section><h2>联系与来源</h2><div class="al-grid">${field('email', '联系邮箱', d.email, 'email')}${field('phone', '联系电话', d.phone)}${field('source', '资料来源', d.source, 'text', true)}${field('referrer', '推荐人', d.referrer)}</div><p class="al-muted">可填写“投稿邮件”“日常发现”等；原始邮件及附件在保存后于“投稿与跟进”中登记关联。</p></section></div><div><section><h2>美术馆关系 <small>可多选</small></h2><div class="al-checks">${s.options.relations.map((t) => `<label><input name="relations" type="checkbox" value="${t}" ${d.relations?.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div><div class="al-grid"><label class="al-field"><span>跟进状态</span><select name="status">${opts(s.options.statuses, d.status || '待了解')}</select></label><label class="al-field"><span>负责人</span><select name="owner"><option value="">未分配</option>${s.options.staff.map((u) => `<option value="${esc(u.id)}" ${u.id === d.owner ? 'selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')}</select></label></div></section><section><h2>外部链接</h2><label class="al-field"><span class="al-sr-only">外部链接</span><textarea name="urls" rows="3" maxlength="400000" placeholder="粘贴链接，多个 URL 用逗号分隔">${esc((d.urls || []).join('，\n'))}</textarea></label><p class="al-muted">报道、个人网站、线上作品集等均可填写</p></section><section><h2>文档附件</h2><p class="al-muted">直接保存至资料库，无需网盘中转</p><label class="al-field"><span>本次上传分类</span><select id="al-file-category">${opts(['作品集', '个人简历', '创作阐述', '作品清单', '报道文件', '其他资料'], '作品集')}</select></label><label class="al-drop" id="al-drop">拖放文件到此处，或点击上传<input id="al-files-upload" type="file" multiple accept=".pdf,.doc,.docx,.zip,.png,.jpg,.jpeg,.gif,.webp"><small>PDF、Word、图片、ZIP · 单文件不超过 ${size(s.options.maxFileBytes)}</small></label><div id="al-upload-status" aria-live="polite"></div><div id="al-staged-files"></div><p class="al-muted">保存档案后，新增文件将关联至该艺术家</p></section><section><h2>艺术家作品图片</h2><p class="al-muted">可直接上传作品图片，或选择关联美术馆已有画廊作品。</p><label class="al-button">上传作品图片<input id="al-work-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label><div id="al-work-image-cards"></div><h3>关联美术馆画廊作品</h3>${button('find-works', '关联画廊作品')}<div id="al-form-works"></div></section>${area('notes', '内部备注', d.notes, 3)}</div></div><footer class="al-form-footer"><span><em>*</em> 为必填项，其他资料可后续补充</span><div class="al-actions">${button('cancel-form', '取消')}<button class="al-button primary" type="submit" id="al-save">保存档案</button></div></footer></form>`;
    staged();
    paintFormWorks();
    paintWorkImages();
    images();
    const drop = root.querySelector('#al-drop');
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('dragging');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragging');
      upload(e.dataTransfer.files);
    });
    root.querySelector('[name=name]').focus();
  }
  function staged() {
    const el = root.querySelector('#al-staged-files');
    if (!el) return;
    el.innerHTML = s.files
      .map(
        (f) =>
          `<div class="al-stage"><div><strong>${esc(f.original_name)}</strong><small>${size(f.size)} · ${esc(f.category)} · <span class="al-success">${f.state === 'active' ? '已归档' : '上传完成，待保存'}</span></small></div>${button('remove-file', '移除', `data-id="${esc(f.id)}"`)}</div>`,
      )
      .join('');
  }
  async function upload(files, avatar = false, artwork = false) {
    if (s.busy) {
      toast('请等待当前操作完成', true);
      return;
    }
    s.busy = true;
    s.dirty = true;
    const save = root.querySelector('#al-save'),
      progress = root.querySelector('#al-upload-status');
    save.disabled = true;
    const errors = [];
    try {
      for (const file of files) {
        try {
          if (file.size > s.options.maxFileBytes)
            throw new Error('超过单文件限额');
          progress.textContent = '正在上传：' + file.name;
          const base = await Store._ensureClient();
          const q = new URLSearchParams({
            name: file.name,
            category: avatar
              ? '头像'
              : artwork
                ? '作品图片'
                : root.querySelector('#al-file-category').value,
          });
          const res = await fetch(base + '/rest/v1/artist-library/files?' + q, {
            method: 'POST',
            headers: {
              ...Auth.authHeaders(),
              'Content-Type': 'application/octet-stream',
            },
            body: file,
          });
          const f = await res.json();
          if (!res.ok) throw new Error(f.error || f.message || '上传失败');
          s.files.push(f);
          if (avatar) {
            root.querySelector('[name=avatarId]').value = f.id;
            root.querySelector('.al-portrait .al-avatar').innerHTML =
              `<img data-artist-file="${esc(f.id)}" alt="艺术家头像">`;
            images();
          }
          staged();
          paintWorkImages();
          images();
        } catch (e) {
          errors.push(file.name + '：' + e.message);
        }
      }
      progress.textContent = errors.length
        ? errors.join('；')
        : '上传完成，请保存档案';
      if (errors.length) toast(errors.join('；'), true);
    } finally {
      s.busy = false;
      save.disabled = false;
    }
  }
  async function saveForm(formEl) {
    if (s.busy) return;
    s.busy = true;
    const btn = root.querySelector('#al-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const f = new FormData(formEl),
        data = Object.fromEntries(f.entries());
      data.relations = f.getAll('relations');
      const body = {
        id: s.formId,
        data,
        fileIds: s.files.map((f) => f.id),
        version: s.detail?.version,
        artworkIds: s.formWorks.map((w) => w.id),
      };
      const p = await api(
        s.detail ? '/' + s.detail.id : '',
        s.detail ? 'PATCH' : 'POST',
        body,
      );
      s.dirty = false;
      s.selected = p.id;
      s.detail = await api('/' + p.id);
      shell();
      await list();
      toast('艺术家档案已保存');
    } catch (e) {
      status(e);
    } finally {
      s.busy = false;
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = '保存档案';
      }
    }
  }
  async function cancel() {
    if (s.busy) return;
    if (s.dirty && !confirm('放弃本次未保存的资料？')) return;
    for (const f of s.files.filter((f) => f.state === 'staged')) {
      await api('/files/' + f.id, 'DELETE').catch(() => {});
    }
    s.dirty = false;
    s.detail = s.selected ? await api('/' + s.selected) : null;
    shell();
    await list();
  }
  async function download(id, preview) {
    const f = s.detail.files.find((f) => f.id === id);
    if (!f) throw new Error('附件已移除');
    const blob = await bytes(id, preview),
      url = URL.createObjectURL(blob);
    if (preview) {
      const dialog = document.createElement('dialog');
      dialog.className = 'al-preview';
      dialog.innerHTML = `<header><strong>${esc(f.original_name)}</strong><button type="button" class="al-button">关闭</button></header><iframe title="${esc(f.original_name)}文件预览"></iframe>`;
      document.body.append(dialog);
      dialog.querySelector('iframe').src = url;
      const close = () => {
        URL.revokeObjectURL(url);
        dialog.remove();
      };
      dialog.querySelector('button').onclick = close;
      dialog.addEventListener('cancel', close);
      dialog.showModal();
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = f.original_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function galleryThumbnail(w) {
    const url = w.image_url || '';
    return /^https?:\/\//i.test(url) || url.startsWith('/uploads/')
      ? '<img class="al-work-thumb" src="' +
          esc(url) +
          '" alt="' +
          esc(w.title) +
          '">'
      : '';
  }
  function workImageCards(files, edit) {
    const items = files.filter(
      (f) => f.category === '作品图片' && f.mime.startsWith('image/'),
    );
    return items.length
      ? '<div class="al-work-images">' +
          items
            .map(
              (f) =>
                '<figure><img data-artist-file="' +
                esc(f.id) +
                '" alt="' +
                esc(f.original_name) +
                '"><figcaption>' +
                esc(f.original_name) +
                '</figcaption>' +
                button(
                  edit ? 'remove-file' : 'preview',
                  edit ? '移除' : '查看大图',
                  'data-id="' + esc(f.id) + '"',
                ) +
                '</figure>',
            )
            .join('') +
          '</div>'
      : '<p class="al-muted">尚未上传作品图片</p>';
  }
  function paintWorkImages() {
    const el = root.querySelector('#al-work-image-cards');
    if (el) el.innerHTML = workImageCards(s.files, true);
  }
  function paintFormWorks() {
    const el = root.querySelector('#al-form-works');
    if (el)
      el.innerHTML = s.formWorks.length
        ? s.formWorks
            .map(
              (w) =>
                '<p class="al-stage">' +
                galleryThumbnail(w) + esc(w.artwork_no || '') +
                ' ' +
                esc(w.title) +
                '</p>',
            )
            .join('')
        : '<p class="al-muted">尚未选择作品</p>';
  }
  async function findWorks() {
    const isForm = s.mode === 'form',
      profile = s.detail;
    const chosen = new Map(
      (isForm ? s.formWorks : profile.works).map((w) => [w.id, w]),
    );
    const dialog = document.createElement('dialog');
    dialog.className = 'al-link-dialog';
    dialog.innerHTML =
      '<h2>关联画廊作品</h2><p>按作品编号、作品名称或艺术家搜索，可选择多件。</p><form><input name="q" aria-label="搜索画廊作品" placeholder="作品编号、名称或艺术家"><button class="al-button" type="submit">搜索</button></form><p data-count></p><div data-results></div><div class="al-actions"><button type="button" class="al-button" data-prev>上一页</button><button type="button" class="al-button" data-next>下一页</button></div><p data-error role="alert"></p><footer><button type="button" class="al-button" data-close>取消</button><button type="button" class="al-button primary" data-save>确认关联</button></footer>';
    document.body.append(dialog);
    dialog.showModal();
    let page = 1,
      query = '',
      request = 0;
    const close = () => dialog.remove();
    dialog.querySelector('[data-close]').onclick = close;
    dialog.oncancel = close;
    const load = async () => {
      const current = ++request;
      try {
        const r = await api(
          '/artworks?' + new URLSearchParams({ paged: '1', page, q: query }),
        );
        if (current !== request || !dialog.isConnected) return;
        dialog.querySelector('[data-count]').textContent =
          '共 ' + r.total + ' 件作品 · 已选 ' + chosen.size + ' 件';
        dialog.querySelector('[data-results]').innerHTML = r.rows.length
          ? r.rows
              .map(
                (w) =>
                  '<label class="al-work-option"><input type="checkbox" value="' +
                  esc(w.id) +
                  '" ' +
                  (chosen.has(w.id) ? 'checked' : '') +
                  '><span><strong>' +
                  esc(w.artwork_no || '未编号') +
                  ' · ' +
                  esc(w.title) +
                  '</strong><small>' +
                  esc(w.artist || '艺术家待补充') +
                  ' · ' +
                  esc(w.medium || '') +
                  ' · ' +
                  esc(w.status || '') +
                  '</small></span></label>',
              )
              .join('')
          : '<p>没有找到作品，请调整搜索；未登记的作品请先在产品管理的画廊中建立档案。</p>';
        dialog.querySelector('[data-prev]').disabled = page <= 1;
        dialog.querySelector('[data-next]').disabled = page * 20 >= r.total;
        for (const input of dialog.querySelectorAll('[data-results] input'))
          input.onchange = () => {
            if (input.checked)
              chosen.set(
                input.value,
                r.rows.find((w) => w.id === input.value),
              );
            else chosen.delete(input.value);
            dialog.querySelector('[data-count]').textContent =
              '共 ' + r.total + ' 件作品 · 已选 ' + chosen.size + ' 件';
          };
      } catch (e) {
        dialog.querySelector('[data-error]').textContent = e.message;
      }
    };
    dialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      query = dialog.querySelector('[name=q]').value;
      page = 1;
      load();
    };
    dialog.querySelector('[data-prev]').onclick = () => {
      page--;
      load();
    };
    dialog.querySelector('[data-next]').onclick = () => {
      page++;
      load();
    };
    dialog.querySelector('[data-save]').onclick = async (e) => {
      e.target.disabled = true;
      try {
        if (isForm) {
          s.formWorks = [...chosen.values()];
          s.dirty = true;
          paintFormWorks();
        } else {
          await api('/' + profile.id, 'PATCH', {
            data: profile.data,
            fileIds: profile.files.map((f) => f.id),
            artworkIds: [...chosen.keys()],
            version: profile.version,
          });
          await select(profile.id);
          toast('画廊作品关联已保存');
        }
        close();
      } catch (err) {
        dialog.querySelector('[data-error]').textContent = err.message;
        e.target.disabled = false;
      }
    };
    await load();
  }
  async function linkFromGallery(artworkId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'al-link-dialog';
    dialog.innerHTML =
      '<h2>关联艺术家档案</h2><p data-work></p><p>此处的关联单独保存，可为一件作品关联多位艺术家。</p><div data-linked></div><form><input name="q" aria-label="搜索艺术家档案" placeholder="输入艺术家姓名"><button class="al-button" type="submit">搜索艺术家</button></form><div data-results></div><div class="al-actions"><button type="button" class="al-button" data-prev>上一页</button><button type="button" class="al-button" data-next>下一页</button></div><p data-error role="alert"></p><footer><button type="button" class="al-button" data-close>完成</button></footer>';
    document.body.append(dialog);
    dialog.showModal();
    let page = 1,
      query = '',
      current;
    const close = () => dialog.remove();
    dialog.querySelector('[data-close]').onclick = close;
    dialog.oncancel = close;
    const load = async () => {
      try {
        current = await api('/artworks/' + encodeURIComponent(artworkId));
        dialog.querySelector('[data-work]').textContent =
          (current.artwork_no || '') + ' ' + current.title;
        dialog.querySelector('[data-linked]').innerHTML =
          '<h3>已关联艺术家</h3>' +
          (current.linkedArtists.length
            ? current.linkedArtists
                .map(
                  (p) =>
                    '<div class="al-stage"><span>' +
                    esc(p.name) +
                    (p.archived ? '（已归档）' : '') +
                    '</span>' +
                    (!p.archived
                      ? '<button type="button" class="al-button" data-unlink="' +
                        esc(p.id) +
                        '">解除关联</button>'
                      : '') +
                    '</div>',
                )
                .join('')
            : '<p>暂无关联</p>');
        const r = await api('?' + new URLSearchParams({ q: query, page }));
        dialog.querySelector('[data-results]').innerHTML =
          r.rows
            .map(
              (p) =>
                '<div class="al-stage"><span>' +
                esc(p.data.name) +
                '</span>' +
                (current.linkedArtists.some((a) => a.id === p.id)
                  ? '<small>已关联</small>'
                  : '<button type="button" class="al-button" data-link="' +
                    esc(p.id) +
                    '">关联</button>') +
                '</div>',
            )
            .join('') || '<p>未找到艺术家，请先在资料库建档。</p>';
        dialog.querySelector('[data-prev]').disabled = page <= 1;
        dialog.querySelector('[data-next]').disabled =
          page * r.pageSize >= r.total;
      } catch (e) {
        dialog.querySelector('[data-error]').textContent = e.message;
      }
    };
    dialog.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-link],[data-unlink]');
      if (!b) return;
      b.disabled = true;
      try {
        await api(
          '/' + (b.dataset.link || b.dataset.unlink) + '/works',
          b.dataset.link ? 'POST' : 'DELETE',
          { artworkId },
        );
        await load();
      } catch (err) {
        dialog.querySelector('[data-error]').textContent = err.message;
        b.disabled = false;
      }
    });
    dialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      query = dialog.querySelector('[name=q]').value;
      page = 1;
      load();
    };
    dialog.querySelector('[data-prev]').onclick = () => {
      page--;
      load();
    };
    dialog.querySelector('[data-next]').onclick = () => {
      page++;
      load();
    };
    await load();
  }
  async function action(e) {
    const b = e.target.closest('[data-action]');
    if (!b || !root.contains(b)) return;
    const a = b.dataset.action;
    try {
      if (a === 'mail-list') return await mailList(1, 'pending');
      if (a === 'mail-filter') return await mailList(1, b.dataset.filter);
      if (a === 'mail-next') return await mailList(s.mailPage + 1);
      if (a === 'mail-prev') return await mailList(s.mailPage - 1);
      if (a === 'mail-back') return await mailList(s.mailPage);
      if (a === 'mail-detail') return await mailDetail(b.dataset.id);
      if (a === 'mail-profile') return await mailProfile(b.dataset.id);
      if (a === 'mail-exit') { shell(); return await list(); }
      if (a === 'mail-assign') {
        b.disabled = true;
        try {
          const result = await api('/mail/' + b.dataset.import + '/assign', 'POST', { artistId: b.dataset.id });
          toast('已关联投稿');
          await mailProfile(result.artistId);
        } finally { b.disabled = false; }
        return;
      }
      if (a === 'new') {
        if (write()) form();
      }
      if (a === 'edit' && write()) form(s.detail);
      if (a === 'select') await select(b.dataset.id);
      if (a === 'tab') {
        s.tab = b.dataset.tab;
        s.recordKind = null;
        s.recordDraft = null;
        detail();
      }
      if (a === 'prev' || a === 'next') {
        s.page += a === 'prev' ? -1 : 1;
        await list();
      }
      if (a === 'archived') {
        s.archived = !s.archived;
        s.page = 1;
        s.detail = null;
        s.selected = null;
        shell();
        await list();
      }
      if (
        a === 'archive' &&
        confirm(
          s.detail.archived
            ? '恢复该档案？'
            : '归档后将从在用列表中隐藏，资料和文件仍保留。继续？',
        )
      ) {
        await api('/' + s.detail.id + '/archive', 'POST', {
          archived: !s.detail.archived,
          version: s.detail.version,
        });
        s.detail = null;
        s.selected = null;
        shell();
        await list();
      }
      if (a === 'cancel-form') await cancel();
      if (a === 'remove-file') {
        if (s.busy) return;
        const f = s.files.find((f) => f.id === b.dataset.id);
        if (f?.state === 'staged') await api('/files/' + f.id, 'DELETE');
        s.files = s.files.filter((f) => f.id !== b.dataset.id);
        if (root.querySelector('[name=avatarId]').value === b.dataset.id) {
          root.querySelector('[name=avatarId]').value = '';
          root.querySelector('.al-avatar').textContent = '头像选填';
        }
        s.dirty = true;
        staged();
        paintWorkImages();
        images();
      }
      if (a === 'remove-avatar') {
        root.querySelector('[name=avatarId]').value = '';
        root.querySelector('.al-avatar').textContent = '头像选填';
        s.dirty = true;
      }
      if (a === 'download' || a === 'preview')
        await download(b.dataset.id, a === 'preview');
      if (a === 'find-works') await findWorks();
      if (a === 'link' || a === 'unlink') {
        if (a === 'unlink' && !confirm('解除与此作品的关联？作品原档案不变。'))
          return;
        await api(
          '/' + s.detail.id + '/works',
          a === 'link' ? 'POST' : 'DELETE',
          { artworkId: b.dataset.id },
        );
        await select(s.detail.id);
      }
      if (a.startsWith('add-')) {
        s.recordKind = a.slice(4);
        s.recordDraft = null;
        detail();
        root.querySelector('.al-record-form input')?.focus();
      }
      if (a === 'cancel-record') {
        s.recordKind = null;
        s.recordDraft = null;
        detail();
      }
    } catch (error) {
      status(error);
    }
  }
  async function submit(e) {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.id === 'al-artist-form') return await saveForm(f);
      if (f.matches('.al-mail-search, .al-mail-assign, .al-mail-supplement')) {
        const btn = f.querySelector('[type=submit],button');
        btn.disabled = true;
        const fd = new FormData(f);
        try {
          if (f.matches('.al-mail-search')) {
            const matches = root.querySelector('#al-mail-matches');
            const data = await api('?' + new URLSearchParams({ q: fd.get('q') }));
            if (!matches.isConnected) return;
            matches.innerHTML = data.rows.length ? data.rows.map(p =>
              `<div class="al-mail-match"><span><strong>${esc(p.data.name)}</strong> · ${esc(p.data.medium || p.data.location || p.data.source)}</span>
              ${button('mail-assign', '关联此档案', `data-id="${esc(p.id)}" data-import="${esc(matches.dataset.import)}"`)}</div>`).join('') +
              (data.total > data.rows.length ? '<p>结果较多，请缩小搜索范围。</p>' : '') : '<p>没有找到相符档案。</p>';
          } else if (f.matches('.al-mail-assign')) {
            const r = await api('/mail/' + f.dataset.import + '/assign', 'POST', { name: fd.get('name') });
            toast('已新建档案并关联投稿');
            await mailProfile(r.artistId);
          } else {
            const file = fd.get('file');
            if (!file?.size || file.size > s.options.maxFileBytes) throw Error('请选择限额内的文件');
            const base = await Store._ensureClient();
            const res = await fetch(base + '/rest/v1/artist-library/files?' + new URLSearchParams({ name: file.name, category: '邮件投稿附件' }),
              { method: 'POST', headers: { ...Auth.authHeaders(), 'Content-Type': 'application/octet-stream' }, body: file });
            const uploaded = await res.json();
            if (!res.ok) throw Error(uploaded.error || '上传失败');
            try {
              await api('/mail/' + f.dataset.import + '/supplement', 'POST', { itemKey: f.dataset.item, fileId: uploaded.id });
            } catch (err) {
              await api('/files/' + uploaded.id, 'DELETE').catch(() => {});
              throw err;
            }
            toast('原件已补存');
            await mailDetail(f.dataset.import);
          }
        } finally { btn.disabled = false; }
        return;
      }

      if (f.dataset.recordKind) {
        const btn = f.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const fd = new FormData(f);
          await api('/' + s.detail.id + '/records', 'POST', {
            id: s.recordDraft.id,
            kind: f.dataset.recordKind,
            data: {
              ...Object.fromEntries(fd.entries()),
              fileIds: fd.getAll('fileIds'),
            },
          });
          s.recordKind = null;
          s.recordDraft = null;
          await select(s.detail.id);
          toast('记录已保存');
        } finally {
          if (btn.isConnected) btn.disabled = false;
        }
      }
    } catch (error) {
      status(error);
    }
  }
  async function render() {
    root = document.getElementById('page-artists');
    root.classList.add('artist-library');
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', action);
      root.addEventListener('submit', submit);
      root.addEventListener('input', (e) => {
        if (e.target.id === 'al-search') {
          s.q = e.target.value;
          s.page = 1;
          clearTimeout(timer);
          timer = setTimeout(() => list().catch(status), 250);
        }
        if (e.target.closest('#al-artist-form')) s.dirty = true;
      });
      root.addEventListener('change', (e) => {
        if (e.target.id === 'al-relation' || e.target.id === 'al-status') {
          s[e.target.id === 'al-relation' ? 'relation' : 'status'] =
            e.target.value;
          s.page = 1;
          list().catch(status);
        }
        if (e.target.id === 'al-files-upload') upload(e.target.files);
        if (e.target.id === 'al-work-images')
          upload(e.target.files, false, true);
        if (e.target.id === 'al-avatar-upload') upload(e.target.files, true);
      });
    }
    if (s.mode === 'form' && root.querySelector('#al-artist-form')) return;
    root.innerHTML = '<p class="al-empty">正在加载艺术家资料库…</p>';
    try {
      s.options = await api('/options');
      shell();
      await list();
      if (s.selected) await select(s.selected);
    } catch (e) {
      root.innerHTML = '<p class="al-empty">资料库加载失败，请重新进入</p>';
      toast(e.message, true);
    }
  }
  window.addEventListener('beforeunload', (e) => {
    if (s.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  return { render, linkFromGallery };
})();
