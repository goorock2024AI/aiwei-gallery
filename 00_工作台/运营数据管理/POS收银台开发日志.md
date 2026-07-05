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
