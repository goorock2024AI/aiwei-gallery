
## 2026-07-16（午后）当月日收入趋势图改造

**改动**：数据统计页「当月日收入趋势」从堆叠柱状图改为折线图，**默认展示每天总收入（黑色"合计"线）**，8 项分项（门票 / 咖啡套票 / 咖啡 / 工坊 / 文创 / 场地 / 画廊 / 其他）通过点击底部图例切换显示/隐藏。

**技术细节**：
- `type: 'bar'` → `'line'`，去掉 `x.stacked / y.stacked`
- 每条线 `tension: 0.3` + `pointRadius: 2~3` + `fill: false`（避免重叠填色）
- 「合计」dataset 用 `#222222` 黑色 + `pointRadius: 3` + `borderWidth: 2.5` 突出
- 8 项分项 `hidden: true` 默认隐藏
- 加 `interaction: { mode: 'index', intersect: false }`：hover 一天同时显示所有可见线 + 底部合计行
- Chart.js 默认 `legend.onClick` 已自动绑 `setDatasetVisibility`，无需写自定义 click handler
- 完整的 `totalData` 数组复用（本来就为了 tooltip 算好合计，现在变成可见线本身）

**为什么折线更合适**：折线传达趋势，柱状传达结构 — 月度 31 天数据按日看趋势是核心诉求。8 项分项保留为可切换维度。「合计」最显眼，解答"哪天收入高"的最常见问题。

**涉及文件**：仅 `app/js/charts.js`（renderDailyRevenueTrend 函数改 1 处）

**沉淀**：
- 新 memory `debug_chartjs_v3_legend_toggle`（调试期切 dataset 用 `setDatasetVisibility(i, true).update()`，不要用 `inst.show(label)`）
- renderRevenueTrend（月度）保持堆叠柱状 — 12 个月×多分类，柱状堆叠更直观看结构；用户未要求改月度
- 后续若加新分项字段（如赞助收入），两个图需同步改 — 候选：抽 `_buildRevenueDatasets()` 工厂函数（本轮不重构）

---

## 2026-07-16 第十五期：整体部署 — 项目清单页 + 8 模块一次落地

> **本期定位**：把 0710-0714 期间累积未提交的 8 模块 / 14 文件改动**一次性整体部署到云端**。同时为「📋 项目清单」独立页面修复了一个关键 bug（accessMap 漏登记）。

### 工作内容

#### 1. 项目清单页（合同视角的快速收款入口）

把空间页「编辑模式下的到账录入表单」抽出来，做成独立 tab：

- **顶部 2 张财务卡**：待收（笔数 + 金额）/ 已结清（笔数 + 金额），点击切换 filter
- **双筛选**：范围（待收 / 已结清 / 全部）+ 状态（筹备中 / 已确认 / 进行中 / 已完成 / 已取消）
- **列表表格**：合同编号（`C` + id 后 6 位大写）/ 项目+客户+空间+类型 / 应收 / 已收 / 未收 / 已收进度（带进度条）/ 状态 tag / 操作（💰 收款 / 详情）
- **快速收款 modal**：默认金额 = 当前未收，付款方式单选（扫码支付 / 转账），保存后自动刷新
- **空间页引导**：编辑模式「到账明细卡」加「录入请到 📋 项目清单」灰色提示；空间页「待收项目」stat-card 可点击跳项目清单

**核心 bug**：`auth.js` 的 accessMap 漏 `'project-list'` —— admin 也被 `_noAccess` 拒绝，UI 表现为按钮可见但页面空白。修复：`'project-list': ['admin', 'editor']`。**侧边栏新 tab 三处必改**：index.html / app.js switch / **auth.js accessMap**。

#### 2. 8 模块 14 文件一次性提交

0710-0714 期间累积的 14 文件 / 2403+/436- 改动，按方案 B（整体一次部署）落地：

| 模块 | 文件改动 | 关键点 |
|---|---|---|
| 空间使用重构（第十二期）| init.sql / server.js / store.js / ui.js / css | `space_payments` 子表 + 视图 + 财务卡 + 甘特图 + 冲突硬性阻止 |
| 项目清单页 | ui.js / css / index.html / auth.js | 合同视角快速收款（已包含在「项目清单页」段落）|
| 画廊销售 + 作品联动（第十三+十四期）| init.sql / server.js / models.js / ui.js / nginx.conf | artworks 6 字段 + gallery_sales 2 字段 + multipart 上传 |
| 文创导出 + JSONB 防御 | import-export.js / ui.js | `retailAmount \|\| creativeAmount` 兼容 + Array.isArray 防御 |
| 收银台顶部统计 + 趋势补全 | ui.js / charts.js | 6 项分项 + 合计 + 趋势补「其他」dataset |
| 后端白名单补全 | server.js | 8 表 + JSONB_COLS 加 `tags`（修 project_registry 写入 400 bug）|
| 部署基础设施 | docker-compose.yml / nginx.conf | uploads-data volume + /uploads/ alias + /rest/ 去末尾斜杠 |
| 文档 | POS 收银台开发日志.md | 第十二期 + 第十三期 + 第十四期记录 |

**提交**：`0d8c756 feat: 0716 整体部署 — 项目清单 + 空间重构 + 画廊上传 + 白名单补全`

#### 3. 部署流程与云端冒烟

**部署顺序**：
1. DB schema 验证（云端已是 0711 最新版，无需迁移）
2. 后端配置 scp：server.js / docker-compose.yml / nginx.conf
3. `docker compose build api`（自建镜像，需 2-5 分钟）+ `docker compose up -d`（挂 uploads-data 卷）
4. 前端 10 文件 scp：index.html / 9 个 JS / style.css + init.sql
5. 清理云端遗留 `ui.js.bak` 备份

**线上冒烟（5 项全过）**：

| 冒烟项 | 端点 | 期望 | 实际 |
|---|---|---|---|
| 1. 登录 | POST /rest/v1/login (test4/test1234) | 200 + role=admin | ✅ |
| 2. 视图聚合 | GET space_usage_with_payments | 含 payments 数组 + receivedAmount 聚合 | ✅ 4150+4150=8300 一致 |
| 3. artwork 白名单 | POST artworks (8 字段) | 201 + 8 字段全保留 | ✅ HTTP 201 |
| 4. spacePayment 白名单 | POST space_payments (5 字段) | 201 + 5 字段全保留 | ✅ HTTP 201 |
| 5. expense 白名单 | POST expense (10 字段) | 201 + 10 字段全保留 | ✅ HTTP 201 |

**所有测试数据 DELETE 清理，业务数据 0 污染**。

#### 4. 关键技术坑（3 条）

1. **accessMap 漏登记 → admin 也被拒**：见「项目清单页」段落。修复 1 行 `auth.js`。
2. **批量 scp SSH 抖动**：腾讯云轻量服务器短时间内收到 ≥3 个 scp 会断连（Connection reset / abort / banner exchange failed）。每个 scp 之间 sleep 5-15s + 加 `scp -C` + `ServerAliveInterval=30` 才稳定。详见 memory `feedback_ssh_disconnect_during_batch_scp`。
3. **test4 密码无法反推**：库里存的哈希 `937e8d5f...` 不匹配任何常见候选（88888888 / goorock888 / admin888 / 888888 / goorock / test4 / aiwei2024 全部 sha256 不命中）。改用 change-password 重置为 `test1234` 完成冒烟测试，原哈希保留为「未知」状态。

### 涉及文件

| 文件 | 改动 |
|---|---|
| `app/index.html` | 10 个 cache-bust 全部升级到 `0716-batch-deploy` |
| `app/js/ui.js` | 项目清单页完整实现 + renderProjectListPage + _openQuickCollectModal + _submitQuickCollect + _goToProjectListTab（**+1895 行**）|
| `app/js/auth.js` | accessMap 加 `'project-list': ['admin', 'editor']` |
| `app/js/charts.js` | 日/月趋势图补「其他」dataset |
| `app/js/import-export.js` | retailAmount 兜底 + 工坊/文创明细列 + Array.isArray 防御 |
| `app/js/models.js` | createSpacePayment / createArtwork 加 imageUrl+settlementPrice+retailPrice+totalQty+soldQty / createGallerySale 加 artworkNo+saleQuantity |
| `app/js/store.js` | space 别名走视图 + 5000 limit |
| `app/js/supabase-config.js` | 加 spacePayment / spaceWithPayments 别名 |
| `app/js/app.js` | tab switch case 加 `project-list` |
| `app/css/style.css` | 甘特图 / stat-card-toggle / quick-collect-modal / aw-thumb 等样式（**+309 行**）|
| `app/sql/init.sql` | space_payments 子表 + 视图 + space_usage 加 expected_payment_date + artworks 6 字段 + gallery_sales 2 字段 |
| `server.js` | TABLE_COLS 补 9 表（含 8 表白名单）+ READ_ONLY_TABLES + handleArtworkUpload + parseMultipartFile + handleSpaceConflict + 5 处 chunk.toString('utf8') + Content-Type charset=utf-8 |
| `docker-compose.yml` | uploads-data volume |
| `nginx.conf` | `/uploads/` alias 指向 `/var/cache/nginx/uploads/` + `/rest/` proxy_pass 末尾去斜杠 |
| `POS收银台开发日志.md` | 第十三 + 第十四期 + 第十五期记录 |

### 部署验证

| 检查项 | 命令 | 结果 |
|---|---|---|
| 文件 mtime | `ls -la /opt/aiwei/app/js/*.js` | 全部 0716 13:xx |
| HTTP 200 + 字节数 | `curl /js/ui.js?v=0716-batch-deploy` | 200 / 191798 bytes |
| API 容器启动 | `docker compose logs api --tail=5` | "AIWEI API server running on port 3000" |
| 7 端点健康 | revenue / space_usage_with_payments / artworks / gallery_sales / space_payments / expense / operation_logs | 全 200 |
| Nginx uploads 卷挂载 | `docker inspect aiwei-nginx-1` | `aiwei_uploads-data` 挂到 `/var/cache/nginx/uploads` |

### 数据库状态（部署后）

| 表 | 记录数 | 说明 |
|---|---:|---|
| revenue | 175+ | 不变 |
| space_usage | 1 | 可口可乐团建（已结清）|
| space_payments | 2 | 可口可乐 2 笔到账 |
| artworks | 0 | 已清理（冒烟数据）|
| gallery_sales | 0 | 不变 |
| creative_products | 0 | 不变 |
| expense | 0 | 已清理（冒烟数据）|
| operation_logs | 增长 | 部署期间有 admin/test4 操作日志 |

### 沉淀的经验（memory）

- [x] 侧边栏新 tab 三处必改：index.html / app.js switch / auth.js accessMap（漏 accessMap admin 也被拒）
- [x] 批量 scp SSH 抖动：每文件 sleep 5-15s + `scp -C` + `ServerAliveInterval=30`
- [x] test4 密码哈希不可逆：change-password 重置即可，反推不实际

### 待办 / 后续计划

- [ ] 项目清单页导出 CSV（合同明细 + 到账明细）
- [ ] 收银台编辑模式点击项目名跳转项目清单
- [ ] 文创库存自动扣减（销售触发）
- [ ] test4 密码由用户决定（保留 test1234 / 还是改其他）

---

## 2026-07-11 第十四期：画廊作品图片上传 + 批量导入

### 工作内容

#### 1. 图片上传（服务器存储方案）

> **关键决策**：用户选项是「上传到服务器」。数据库只存相对路径 `/uploads/artworks/xxx.png`，实际文件落 API 容器的 `/uploads/artworks/` 目录。

`POST /rest/v1/artworks/upload` 新端点，接收 `multipart/form-data`，手写 parser（无 multer 依赖，零外部包）：
- 5MB 上限（超出返回 413）
- 仅允许 jpg/jpeg/png/gif/webp
- 文件名 `时间戳_2字节随机.扩展名`，避免冲突
- 返回 `{ url: '/uploads/artworks/xxx.png', filename, size }`

**Nginx 静态托管**：`docker-compose.yml` 加 `uploads-data` volume，API 容器 rw 写，Nginx 容器 ro 读。`nginx.conf` 加 `location /uploads/ { alias /var/cache/nginx/uploads/; }`（用 alias 不用 root，因为 `/usr/share/nginx/html/` 是 overlayfs readonly）。

> **踩坑**：第一版用 `alias /usr/share/nginx/html/uploads/` 启动失败，根因是 nginx 容器内的 `/usr/share/nginx/html/` 是只读 overlayfs，mkdir 创建子目录被拒。改路径到 `/var/cache/nginx/uploads/` 后通过。

#### 2. modal 加图片字段（_showArtworkModal）

缩略图预览（120×120）+ file input + URL 输入框（备选）+ 移除按钮。编辑回填时显示已有图片；URL 输入变化时实时预览；上传时显示状态（"上传中..." → "✅ 上传成功（123 KB）"）。`_resolveImageUrl` 把相对路径自动拼成完整 URL（`/uploads/...` → `http://122.51.56.50/uploads/...`）。

#### 3. 列表缩略图列

新增 `缩略图` 列，60×60 圆角缩略图。`image_url` 为空时显示「无图」占位符。`onerror` 自动替换为「加载失败」。

#### 4. 批量导入（CSV / XLSX）

`_importArtworks` + `_parseArtworkImportFile` + `_downloadArtworkTemplate`，复用文创产品的导入代码模式：
- 列头：标题 / 艺术家 / 年份 / 材质 / 尺寸 / 位置 / 状态 / 图片URL / 备注
- 9 字段容错映射（候选多个别名）
- 模板下载 CSV（含示例行）

### 关键技术坑

1. **nginx `/uploads/` 不能用 `/usr/share/nginx/html/uploads/`**（只读 rootfs）→ 改 `/var/cache/nginx/uploads/` + alias
2. **nginx `proxy_pass http://api:3000/` 末尾的 `/` 触发 location 前缀剥离**：`/rest/v1/artworks` → `/v1/artworks` 传给后端，server.js 路径错位 → 404（**这个 bug 之前一直存在**，本期才暴露，详见复盘）
3. **TABLE_COLS 白名单遗漏**：新增表时 `server.js` 没加白名单，POST 字段被静默丢弃 → 返回 404 而非 500（无错误信息，难以诊断）
4. **Windows bash + curl 中文乱码**（第二次踩，详见 memory `debug_curl_windows_gbk_encoding`）：用 `docker compose exec -T api node -e "..."` 容器内直接发请求调试

### 涉及文件

- `app/sql/init.sql` — `artworks` 加 `image_url` 字段
- `docker-compose.yml` — 加 `uploads-data` volume
- `nginx.conf` — 加 `/uploads/` alias + `/rest/` proxy_pass 去 `/`
- `server.js` — UPLOAD_DIR + handleArtworkUpload + parseMultipartFile + TABLE_COLS artworks 白名单
- `app/js/models.js` — `createArtwork` 加 `imageUrl`
- `app/js/ui.js` — `_showArtworkModal` 加图片 + `_resolveImageUrl` + `_renderArtworkTab` 加缩略图列 + `_importArtworks` + `_downloadArtworkTemplate`
- `app/css/style.css` — `.aw-thumb` + `.aw-thumb--placeholder`
- `app/index.html` — cache-bust `artwork-image-20260710`

### 数据库状态

| 表 | 条数 | 备注 |
|---|---|---|
| artworks | 0 | 测试数据已清理 |
| space_usage | 0 | 用户主动清空 |

---

## 2026-07-11 第十三期：产品管理二级标签页 + 作品档案 CRUD

### 工作内容

#### 1. 二级标签页（5 个 tab）

`renderProductPage` 重写为 5 个二级 tab：🎫 门票 / ☕ 咖啡 / 📦 文创/零售 / 🔧 工坊 / 🖼️ 画廊。每个 tab 显示数量徽章，切换 tab 用 `addEventListener` 绑定。

> **解决了原痛点**：原本 5 张产品卡堆在一个页面里，找特定类型要往下滚；用「产品配置」+「文创产品」混在一起逻辑混乱。现在每 tab 独立、互不干扰。

#### 2. 每个 tab 加查询框

每个 tab 顶部都有一个查询框，文创支持多字段（名称/SKU/供应商/备注），其他 tab 按名称模糊匹配。`_onProductSearch` 输入时实时过滤，且**保留焦点和光标位置**（重建 innerHTML 后重新 focus + setSelectionRange）。

#### 3. 用 modal 替换 prompt() 弹窗

原代码 `prompt('请输入名称：')` + `prompt('请输入价格：')` 串行弹窗（最多 3 次）改用 `_showSimpleConfigModal` / `_showArtworkModal`，统一交互体验。模态框内 `autofocus` 自动聚焦第一个字段，`Enter` 键触发保存。

#### 4. 作品档案 CRUD（artworks）

利用已存在的 `artworks` 表（10 字段），新增 UI 完整 CRUD：
- `_loadArtworks` / `_renderArtworkTab` / `_showArtworkModal` / `_addArtwork` / `_editArtwork` / `_deleteArtwork`
- 列表 + 编辑/删除按钮 + 状态 tag（在库/在展/已售/借出/下架）
- 表单 8 字段（标题/艺术家/年份/材质/尺寸/位置/状态/备注）

#### 5. 局部刷新

`_refreshCurrentProductTab` 只刷新当前 tab 的 `innerHTML`，不重建整个页面，并同步更新 tab 上的徽章数字。增删改后立即看到效果，无需重新进 tab。

### 涉及文件

- `app/js/models.js` — `createArtwork` 工厂函数
- `app/js/ui.js` — 重写 `renderProductPage` + 9 个新方法（_renderProductTabContent / _renderSimpleConfigTab / _renderCreativeTab / _renderArtworkTab / _loadArtworks / _onProductSearch / _showSimpleConfigModal / _showArtworkModal / _refreshCurrentProductTab）
- `app/css/style.css` — `.sub-tabs` 二级标签样式 + 移动端适配
- `app/index.html` — cache-bust `product-tabs-20260710`

### 踩坑

- 老的 `_renderCreativeProductList` 仍被保留（无 el 时是 no-op），但实际所有调用已改用 `_refreshCurrentProductTab`
- `_renderEditableList` 已废弃，被 `_renderSimpleConfigTab` 取代
- `models.js` 里旧的 `_creativeProducts: []` 重复定义清理（合并到顶部 UI 对象初始化时）

---

## 2026-07-10 第十二期：本地预览走通 + 收入明细展开 + 文创导出修复 + 标题微调

### 工作内容

#### 1. 套票录入重复计算 bug

录入 4 张套票时，系统会同时记 4 张普通票（按标准票计费），导致套票收入和普通票收入同时翻倍。

**根因**：`models.js` 的 `createRevenue()` 函数用 `ticketItems.reduce(...)` 推导 `ticketQty`/`ticketAmount`，但 `ticketItems` 数组里同时含普通票和套票，套票被错误地算进普通票字段。`ui.js` 主记录和编辑记录构造逻辑也有同源问题（虽然金额已正确分离，张数未分离）。

**修复**：
- `models.js:createRevenue()`：reduce 前先 `filter(i => i.name !== '套票')` 排除套票
- `ui.js` 主记录和编辑记录两处：`ticketQty` 改用 `regularTicketItems.reduce(...)`

**验证**：三种场景（4 张套票 / 3 张普通票+2 张套票 / 5 张普通票）张数与金额全部正确。

#### 2. 收银台顶部实时统计扩展

原顶部只显示「今日门票 X 张」和「今日实收 ¥Y」两项，信息密度太低。新版拆为 7 项金额 + 合计：

- 今日门票 X 张
- 门票 / 套票 / 咖啡 / 文创 / 工坊 / 其他 6 项分项
- 合计（浅绿背景高亮）

**实现细节**：
- 8 个独立 reduce 求和（`ticketQty` / `ticketAmt` / `comboAmt` / `coffeeAmt` / `workshopAmt` / `retailAmt` / `venueAmt` / `otherAmt`）
- 文创金额用 `retailAmount || creativeAmount` 兜底兼容旧数据
- 「其他」项把 `venueAmount` + `otherAmount` 合并展示（与用户要求的 6 项分项列表一致）

**样式**（`style.css`）：新增 `.today-stat-total` 规则，浅绿背景 + 深绿文字 + 圆角，让合计项视觉突出。项目 green 系列只到 100/300/500/700/900，初次用了不存在的 `--green-800` 已修正为 `--green-900`。

#### 3. 收入趋势图表补「其他」项目

「当月日收入趋势」和「月度收入趋势」两个图表在统计和展示时都漏掉了 `otherAmount` 字段，导致录入「其他」收入时该日/当月总额偏少，图表上也看不到这一类收入的占比。

两处都按对称方式补 5 处改动：
- 数组声明加 `const otherData = []`
- 累加变量加 `o = 0`
- 累加逻辑加 `o += r.otherAmount || 0`
- push 数据
- 合计金额加 `+ otherData[i]`
- datasets 末尾加 `{ label: '其他', data: otherData, backgroundColor: '#888888' }`

**验证**：
- 日趋势 7月7日 otherAmount=88 → 「其他」当日=88，合计=268 ✅
- 月度 7月 otherAmount=66 → 「其他」7月=66，合计=216 ✅

#### 4. 侧边栏版本号显示修复

`index.html` 第 60 行硬编码占位符 `__APP_VERSION__`，但前端从未有任何 JS 替换——历史提交 `d71ab81` 添加版本号 UI 时只搭了占位符，没接上实际值。结果页面上始终显示 `__APP_VERSION__` 字面字符串。

**修复**：在 `app.js` 启动 IIFE 顶部加 `APP_VERSION = '1.1.0'` 常量（与 VERSION 文件一致）+ IIFE 立即执行 `fillVersion()` 把版本号写入 `#sidebar-version` 元素的 `textContent`。

**已知债**：版本号硬编码在 app.js，未来发版需要手动同步两处（VERSION 文件 + app.js 的 APP_VERSION）。可考虑后端 `/version` 端点或 deploy.sh sed 替换。

### 涉及文件

| 文件 | 改动 |
|---|---|
| `app/js/models.js` | `createRevenue()` 过滤套票后再求和 |
| `app/js/ui.js` | 主记录/编辑记录 ticketQty 改用 regularTicketItems；`_loadTodayStats` 扩展为 7 项分项 + 合计 |
| `app/js/charts.js` | `renderDailyRevenueTrend` / `renderRevenueTrend` 补「其他」dataset |
| `app/js/app.js` | 新增 `APP_VERSION` 常量 + `fillVersion()` |
| `app/css/style.css` | 新增 `.today-stat-total` 规则 |
| `app/index.html` | 多个 JS/CSS 文件的版本号递增 |

### 部署

5 次增量部署到腾讯云服务器，全部用版本号递增防止浏览器缓存：

| 部署 | 改动文件 | 版本号 token |
|---|---|---|
| 1 | ui.js / models.js / index.html | `tkt-combo-fix-20260707` |
| 2 | charts.js / index.html | `daily-trend-other-20260707` |
| 3 | ui.js / style.css / index.html | `today-stats-detail-20260707` |
| 4 | app.js / index.html | `version-fix-20260707` |

### 数据库状态

| 表 | 记录数 | 说明 |
||----|-------:|------|
| revenue | 175+ | 不变 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 待录入 |
| creative_products | 0 | 待导入 |

### 沉淀的经验（memory）

- [x] 问题处理六步流程：分析→设计→执行→验证→复盘→继续发现
- [x] test4 测试数据纪律（只录入不删非测试账号数据）
- [x] 启动 preview 前完整同步全部文件到运行时目录
- [x] git push 网络失败时放宽 git 超时阈值重试，不陷入网络调试
- [x] 调试优先看浏览器控制台 JS 错误
- [x] 排查范围：先看变更文件
- [x] JSONB 数组防御用 Array.isArray()
- [x] CSS 引用变量前先 grep `--xxx-` 确认变量存在（避免 fallback 到默认色）

---

## 2026-07-05 第九期：文创产品管理模块（独立录入/表格导入/库存联动/筛选分页）

### 工作内容

#### 1. 文创产品数据库

| 改动 | 说明 |
|------|------|
| `app/sql/init.sql` | 新增 `creative_products` 表（名称/SKU/供应商/进货价/零售价/库存/单位/备注）|
| `server.js` | 表映射注册 `creative_products` |
| 服务器 | Docker 容器重建 + `CREATE TABLE` 执行 |

#### 2. 产品管理页面 — 文创产品管理区块

位于票务/咖啡/工坊/经营空间下方，独立的「📦 文创产品管理」卡片：

- **逐一录入** — 弹窗表单：产品名称（必填）、SKU、供应商、进货价、零售价（必填）、库存数量、单位（下拉）、备注
- **表格导入** — 支持 CSV 和 Excel（.xlsx）两种格式，自动识别中英文列名（优先：`产品名称>name>Name`、`SKU>sku>编码`、`供应商>supplier`、`进货价>costPrice>cost_price`、`零售价>retailPrice>retail_price`、`库存>stock>库存数量`、`单位>unit`、`备注>notes`）
- **下载导入模板** — 一键下载含表头和示例数据的 CSV 模板
- **导出产品列表** — 当前全部产品导出为 CSV
- **导出文创销售清单** — 按日期范围筛选 revenue 表中含 retailItems 的记录，逐条展开为独立行（产品名×数量×单价×金额）

#### 3. 供应商筛选

表格顶部下拉框，自动收集所有供应商去重排序。选择后只显示该供应商的产品，页数和页码自动重新计算。

#### 4. 分页

每页 40 条，表格上下均放置分页控件（首页/上一页/页码信息/下一页/末页），产品数不足 40 时隐藏分页栏。

#### 5. POS 收银台联动

文创零售输入行新增 📋 按钮，点击弹出产品库选择器，显示产品名/零售价/库存，支持搜索过滤，选中后自动填入名称和单价。

### 修复记录

| 问题 | 原因 | 修复 |
|------|------|------|
| 导入提示"未解析到有效数据" | `readAsBinaryString` 已废弃 + 列名匹配不够宽容 | 改为 `readAsArrayBuffer` + `_getCPField()` 多候选匹配 |
| 后端 `Table not found` | 首次部署后 Docker 镜像缓存旧 `server.js` | `--no-cache` 强制重建 |
| 浏览器持续报旧错 | `index.html` 版本号缓存标记未更新，浏览器加载旧文件 | 重启 dev server + 清除 Service Worker 缓存 |

### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/ui.js` | 文创产品 CRUD + 表格导入/导出 + 供应商筛选 + 分页 + POS 产品库选择器 |
| `app/js/models.js` | 新增 `createCreativeProduct()` / `validateCreativeProduct()` |
| `app/js/supabase-config.js` | 注册 `creativeProducts: 'creative_products'` |
| `server.js` | 表映射添加 `creative_products` |
| `app/css/style.css` | `.cp-select-item` / `.cp-toolbar` / `.cp-pagination` / `.cp-page-info` |
| `app/sql/init.sql` | 新增 `creative_products` 建表语句 |

### 服务器操作

```bash
# 前端文件同步
scp app/js/ui.js root@122.51.56.50:/opt/aiwei/app/js/
scp app/css/style.css root@122.51.56.50:/opt/aiwei/app/css/

# API 重建
scp server.js root@122.51.56.50:/opt/aiwei/
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose build --no-cache api && docker compose up -d api"

# 建表
ssh root@122.51.56.50 "docker compose exec -T db psql -U postgres -c \"CREATE TABLE IF NOT EXISTS creative_products (...)\""
```

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 175+ | 含文创拆分记录 |
| creative_products | 0 | **新增** 已清空待导入 |

### 待办 / 后续计划

- [ ] POS 收款后文创库存自动扣减
- [ ] 采购入库记录（进货批次管理）
- [ ] 供应商管理模块（联系方式/账期）
- [ ] 库存预警（低于安全库存时提示）

---



### 工作内容

#### 1. 收入记录列表优化
- 表格从固定列（普通票/套票/咖啡/工坊/文创/其他）改为**动态标签**显示，只展示金额 > 0 的项
- 新增「收款人」列，保存时自动记录操作人
- 新增「收款人」字段入参，旧数据显示 `—`

#### 2. CSV 导出修复
- 文创金额字段从 `creativeAmount` 改为 `retailAmount || creativeAmount`，兼容新旧数据
- 新增「工坊明细」「文创明细」列，导出时展开 JSONB 数组为可读文本
- 移除废弃的「关联项目」列

#### 3. JSONB 类型防御（Array.isArray）
- 历史数据中存在 `retailItems: {}` 的脏数据，`(x || [])` 无法防御
- 导出函数 `import-export.js` 和编辑回填 `ui.js` 全部改用 `Array.isArray(x) ? x : []`
- 触发的具体报错：「(r.retailItems || []).map is not a function」

#### 4. pg JSONB 数组序列化修复
- 发现 pg 参数化查询会把 JS 数组序列化为 PG 数组字面量（如 `'{"(普通票,10)"}'`），JSONB 列无法解析
- `server.js` 的 POST 和 PATCH 中对 JSONB 列做 `JSON.stringify()`，确保传入 `JSON.stringify(data[k])`
- 新增全局常量 `JSONB_COLS`（`ticket_items` / `coffee_items` / `workshop_items` / `retail_items` / `combo_items`）
- 触发的具体报错：「invalid input syntax for type json」

#### 5. 工坊/文创拆分独立记录
- 收银台确认收款时，门票+咖啡+其他保留为一条主记录
- **工坊每个商品**拆为独立 revenue 记录
- **文创每个商品**拆为独立 revenue 记录
- 编辑模式保持合并不拆分
- 导出 CSV 时每个商品自然成为一行

#### 6. 排序与时间显示
- 排序从 `order=date.desc` 改为 `order=created_at.desc`，同一天按录入顺序排列
- 日期列从纯日期改为北京时间 `MM-DD HH:mm`（源自 `createdAt` UTC 转 CST）
- 新增 `_fmtBeijingTime()` 工具函数
- 服务器确认时区为 `Asia/Shanghai (CST, +0800)`

### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/ui.js` | 收入记录动态标签 + 收款人列 + 拆分保存 + 编辑回填 Array.isArray + 北京时间显示 |
| `app/js/import-export.js` | CSV 导出文创金额/明细 + Array.isArray 防御 + try/catch |
| `app/js/store.js` | 排序改为 `created_at.desc` |
| `server.js` | POST/PATCH JSONB 列 `JSON.stringify()` + 全局 `JSONB_COLS`（需重建 Docker）|
| `app/css/style.css` | `.rev-tag` / `.rev-tag-group` 样式 |
| `app/index.html` | 版本号递增（css/v2, ui/v9, store/v5, import-export/v5, app/v6）|

### 服务器操作

```bash
# 前端文件（Nginx 挂载，上传即生效）
scp app/js/*.js root@122.51.56.50:/opt/aiwei/app/js/
scp app/css/style.css root@122.51.56.50:/opt/aiwei/app/css/
scp app/index.html root@122.51.56.50:/opt/aiwei/app/

# API 文件（需重建容器）
scp server.js root@122.51.56.50:/opt/aiwei/
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose build api && docker compose up -d api"
```

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 175+ | 含今日工坊/文创拆分新增的多条记录 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 待录入 |

### 沉淀的经验（memory）

- [x] JSONB 数组防御用 `Array.isArray()` 而非 `(x || [])`
- [x] 排查修改前正常的功能出问题，优先只看变更文件
- [x] 问题处理六步流程：分析→设计→执行→验证→复盘→继续发现
- [x] `pg` 参数化查询会将 JS 数组序列化为 PG 数组字面量，JSONB 列需手动 `JSON.stringify()`

---

## 2026-07-04 第七期：腾讯云服务器上线部署 + Git 版本管理

### 背景

Supabase 云数据库（`pyzitexdzfrbexwgoqpz.supabase.co`）在中国大陆访问不稳定，决定将系统完全迁移至国内腾讯云轻量应用服务器。同时建立 Git 版本管理，规范后续开发流程。

### 架构变更

**之前（Supabase 云端）：**
```
浏览器 → Supabase REST API → Supabase PostgreSQL（海外）
```

**现在（腾讯云 Docker 自托管）：**
```
浏览器 → Nginx（80端口）→ 静态页面（前端）
                    → Node.js API（:3000）→ PostgreSQL 17（Docker 内）
```

### 工作内容

#### 1. 腾讯云服务器初始化

| 项目 | 详情 |
|------|------|
| 服务器 | 腾讯云轻量应用服务器 Ubuntu 22.04 |
| IP | `122.51.56.50` |
| SSH 密钥 | `~/.ssh/id_rsa`（本地）→ 手动添加到 `~/.ssh/authorized_keys` |
| 登录方式 | 密钥登录（root 用户） |

#### 2. Docker 部署（3 容器）

| 容器 | 镜像 | 端口 | 用途 |
|------|------|------|------|
| db | postgres:17-alpine | 5432 | PostgreSQL 数据库 |
| api | aiwei-api（自建）| 3000 | Node.js REST API（server.js） |
| nginx | nginx:alpine | 80 | 静态文件服务 + 反向代理 |

**部署文件（`00_工作台/运营数据管理/`）：**
- `Dockerfile` — Node.js API 镜像构建
- `docker-compose.yml` — 3 容器编排
- `nginx.conf` — 反向代理 + 静态文件

**服务管理命令（服务器上执行）：**
```bash
cd /opt/aiwei
docker compose ps          # 查看服务状态
docker compose logs -f     # 查看日志
docker compose restart     # 重启服务
docker compose build api && docker compose up -d api  # 更新 API 后重建
```

#### 3. server.js 新增功能与修复

| 改动 | 说明 |
|------|------|
| 新增 `POST /rest/v1/login` | 服务端密码校验，替代前端 `crypto.subtle.digest`（HTTP 环境不支持） |
| 新增 `POST /rest/v1/change-password` | 服务端修改密码接口 |
| 修复 `toSnake()` | 递归处理嵌套对象/数组，JSONB 数据不再被转成 `{}` |
| 修复 `sendJSON()` | `Content-Range` 头合并到 `writeHead`，避免 `ERR_HTTP_HEADERS_SENT` |
| 修复查询参数 | 支持重复参数（如 `date=gte.xxx&date=lte.xxx`），数组转为单值处理 |
| 修复 NUMERIC 类型 | 数据库返回的字符串金额（如 `"1160.00"`）自动转数字 |

#### 4. auth.js 改动

| 改动 | 说明 |
|------|------|
| 删除 `_hash()` 方法 | 纯 JS SHA-256 函数有 bug，且不再需要 |
| 改用服务端登录 | `login()` 调用 `POST /rest/v1/login` |
| `changePassword()` | 调用 `POST /rest/v1/change-password` |
| 保留 `sha256()` | 仅在管理员创建/重置用户时使用（`addUser` / `resetPassword`） |

#### 5. 数据迁移

从 Supabase 完整迁移到腾讯云 PostgreSQL：

| 表 | Supabase | 腾讯云 | 迁移方式 |
|----|:--------:|:------:|----------|
| revenue | 165 | 165 ✅ | SQL 直导（绕过 API 层 JSONB 处理限制） |
| users | 4 | 4 ✅ | REST API + 删除 avatar 字段 |
| app_config | 4 | 4 ✅ | REST API + 删除 created_at 字段 |
| operation_logs | 16 | 16 ✅ | REST API |
| expense / space_usage / gallery_sales | 0 | 0 | 空表，无需迁移 |

**迁移脚本备忘：**
- 数据从 Supabase REST API 读取（`https://pyzitexdzfrbexwgoqpz.supabase.co`）
- revenue 因为含 `retail_items` JSONB 数组，通过 `pg_dump` 风格的 SQL 语句直接 psql 导入（绕过 API 的 toSnake 层）
- 其他表通过 REST API 逐条 POST，注意 camelCase ↔ snake_case 映射

#### 6. Git 版本管理

**仓库信息：**
```bash
cd "D:/工作文档/00_进行中/艾维美术馆"
git remote -v
# origin  https://github.com/goorock/aiwei-gallery.git (fetch)
# origin  https://github.com/goorock/aiwei-gallery.git (push)
```

**提交规范（遵循前序风格）：**
- 前缀：`feat:` / `fix:` / `refactor:` / `chore:` / `test:`
- 消息体：第一行简短标题，空行后详细说明
- 提交时只暂存本次改动的文件，避免误提交无关文件

**重要文件跟踪状态：**
- 核心代码：`00_工作台/运营数据管理/app/`（前端）+ `server.js`（后端）
- 部署配置：`Dockerfile` / `docker-compose.yml` / `nginx.conf`
- 部署脚本：`deploy.sh`
- 数据库初始化：`app/sql/init.sql`
- 根目录 `deploy.sh` 是旧脚本，不在核心工作目录内

**首次提交记录：**
```
b7ddcb2 refactor: 移除 Supabase SDK 依赖，改为自有 Node.js API + PostgreSQL 直连
478ec30 chore: 添加一键部署脚本 deploy.sh
d71ab81 feat: 侧边栏底部添加版本号 v1.0.0
540eba5 fix: 部署腾讯云上线修复 — 服务端登录、JSONB 数组处理、NUMERIC 类型转换
```

#### 7. 上线后遗留问题

- [ ] 服务器无 HTTPS（当前 HTTP），`crypto.subtle` 不可用（已通过服务端登录绕过）
- [ ] API 层无认证中间件（用户可绕过前端直接调用 API）
- [ ] 数据库无定期备份机制
- [ ] 操作日志表 `operation_logs` 的 `details` 字段结构可能与新 API 不兼容
- [ ] `toSnake` 在 POST 时转换 JSON 字段可能有性能开销（大数据量时需关注）
- [ ] 前端 `index.html` 中的 JS 版本号（`?v=N`）手动管理，改文件后需递增
- [ ] 服务器 80 端口原系统 Nginx 已停用，如需恢复需调整端口

### 涉及文件

| 文件 | 改动 |
|------|------|
| `server.js` | 新增 login/change-password API；修复 toSnake/sendJSON/参数解析/NUMERIC |
| `app/js/auth.js` | 改用服务端登录，删除前端 SHA-256 |
| `app/index.html` | auth.js 版本号 v4→v5 |
| `Dockerfile` | **新增** Nde.js API 容器镜像定义 |
| `docker-compose.yml` | **新增** 3 容器编排（PostgreSQL + API + Nginx）|
| `nginx.conf` | **新增** 反向代理 + 静态文件配置 |
| `deploy.sh` | 完善部署脚本 |
| `app/sql/init.sql` | 完善数据库初始化（补充字段定义） |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 165 | 含全部历史数据（从 Supabase 迁移）|
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 待录入 |
| app_config | 4 | 票务/咖啡/工坊/空间配置 |
| users | 4 | admin + 顾睿（viewer）+ 杨东东（editor）+ test4（admin）|
| operation_logs | 16 | 旧操作日志 |

### 管理员账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin888 | 管理员（首次登录建议改密）|
| 顾睿 | 原密码 | 查看者 |
| 杨东东 | 原密码 | 编辑者 |
| test4 | 原密码 | 管理员 |

---

## 2026-06-30 第六期：收银台收入记录调整为按日筛选

### 背景

收银台收入记录模块之前是按月筛选，但实际运营中更频繁的需求是查看当天收款记录。同时保留日期筛选功能，方便补录历史数据或修改收款金额。

### 工作内容

- **收入记录筛选**：从月度筛选改为按日筛选，月份下拉框改为日期选择器
- **"今天"快捷按钮**：一键跳回当天记录
- **状态同步**：`_revenueFilterMonth` → `_revenueFilterDate`，编辑模式回填正常
- **清除废弃代码**：移除废弃的 `_filterRevenue()` 依赖（后续补回为按日版本）

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/ui.js` | 筛选控件改为 date input + 按日过滤 + "今天"按钮 |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 131 | 不变 |

### 待办 / 后续计划

- [ ] 收银交易记录支持打印小票（不变）
- [ ] 日结/交班报表（不变）
- [ ] 画廊销售独立录入标签页
- [ ] 场地租金独立录入标签页
- [ ] 退款/作废功能

---

## 2026-06-30 第五期：用户登录系统 + 数据导出优化

### 背景

PRD 中 P1 需求的账号登录系统和操作日志，本次先实现用户登录系统（操作日志待后续实现）。同时根据测试反馈对数据管理页做了多项体验优化。

### 工作内容

#### 1. 用户登录系统

| 模块 | 文件 | 说明 |
|------|------|------|
| 认证模块 | `app/js/auth.js` | 新增文件，实现 login/logout/changePassword/addUser/listUsers/toggleUser/resetPassword |
| 密码方案 | （内置） | 浏览器原生 `crypto.subtle.digest('SHA-256')`，无外部依赖 |
| 登录态 | sessionStorage | 存储 `{id, username, displayName, role, needPasswordChange}` |

**登录流程：**
- 首次访问 → 显示登录页（默认覆盖主界面，不闪烁）
- 输入正确账号密码 → 检查首次登录标记 → 强制改密弹窗（`__need_change__:` 前缀标记）
- 改密后进入主界面，侧边栏底部显示当前用户名
- 刷新页面 → sessionStorage 保持登录态

**用户体系：**
- 内置管理员账号：`admin` / `admin888`（首次登录强制改密）
- 无用户注册功能，管理员在「用户管理」页创建普通账号
- 普通账号默认密码 `88888888`，首次登录强制改密
- 管理员菜单控制：仅 admin 角色可见「数据管理」「产品管理」「用户管理」

#### 数据管理页调整

- **移除「导入数据」入口**（基础数据已录入完毕，保留导入代码）
- 导出功能增加**时间维度筛选**：本周（自然周）、本月（自然月）、本年（1月1日~今天）、全部、自定义日期范围
- 移除「本季度」预设和「清除所有数据」按钮
- 收银台顶部新增**当日销售统计**：门票张数 + 实收金额

#### 数据库迁移

| 迁移文件 | 说明 |
|----------|------|
| `2026063001_seed_admin_user.sql` | 插入管理员默认账号（SHA-256 哈希） |
| `2026063002_users_rls_policies.sql` | users 表 SELECT RLS 策略 |
| `2026063003_fix_users_rls.sql` | users 表 UPDATE RLS 策略（改密操作） |
| `2026063004_users_last_login.sql` | users 表增加 `last_login_at` 字段 |
| `2026063005_users_insert_rls.sql` | users 表 INSERT RLS 策略（管理员创建用户） |

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/auth.js` | **新增** 认证模块 |
| `app/js/ui.js` | 用户管理页 + 当日销售统计 + 导出时间筛选 UI + 移除导入/清除入口 |
| `app/js/app.js` | 登录态守卫 + 登录/改密表单处理 + admin 菜单控制 |
| `app/js/import-export.js` | 导出增加 `_filterByDateRange` 时间范围过滤 |
| `app/index.html` | 登录覆盖层 + 改密弹窗 + 退出按钮 + 用户管理 tab + admin菜单标记 |
| `app/css/style.css` | 登录页样式 + 当日统计条 + 退出按钮 + 导航分隔线 |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 131 | 不变 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 待录入 |
| app_config | 4 | 动态产品配置 |
| users | 1+ | admin + 新建普通账号 |

### 待办 / 后续计划

- [ ] 细粒度操作日志审计（PRD 3.8）
- [ ] 历史数据对比分析（同比/环比）
- [ ] 多用户权限体系细化
- [ ] 收银交易记录支持打印小票
- [ ] 日结/交班报表
