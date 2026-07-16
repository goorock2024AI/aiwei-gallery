# 艾维美术馆 — 项目基础规则

## 通用规则

1. 新增文档使用 Markdown (.md) 格式。
2. **所有任务必须严格按「六步流程」执行**：分析→设计→执行→验证→复盘→继续发现。**第 5 步复盘和第 6 步继续发现是六步流程的核心价值所在，不可省略。** 详见下方「问题处理六步流程」章节。
3. 本文件与根目录 AIWEI.md 同时生效，是本项目的强制行为规范。

## 仓库架构

| 仓库 | 路径 | 用途 |
|------|------|------|
| aiwei-gallery（根） | . | 入口索引 INDEX.md |
| aiwei-operations | ./aiwei-operations/ | 运营数据系统开发 |
| aiwei-planning | ./aiwei-planning/ | 规划文档 + 项目注册表 |
| aiwei-content | ./aiwei-content/ | 自媒体内容 |

各子仓库有独立的 AIWEI.md 工作规则。

## 启动流程

1. 读 INDEX.md 了解总览。
2. 根据任务确定所属子仓库，只在该仓内工作。
3. 跨仓库数据通过**腾讯云 API** 查询（`http://122.51.56.50/rest/v1/{table}`），不跨仓读文件。

## 数据管理

- 项目注册表在 registry/，同时写入腾讯云 API（原 Supabase project_registry 表）。
- 财务数据从**腾讯云 API** 实时获取，不从文档读取。
- 项目状态以 registry/*.md 为准。

## 运营数据系统信息

- 访问地址：http://122.51.56.50
- 管理员账号：admin / admin888
- 测试账号：test4（admin 权限），所有测试通过此账号进行，测试完成后必须清理产生的业务数据
- 部署方式：腾讯云轻量服务器 Docker（Nginx + Node.js API + PostgreSQL 17）
- 仓库位置：`00_工作台/运营数据管理/`（核心文件：server.js + app/）
- 开发日志：`00_工作台/运营数据管理/POS收银台开发日志.md`
- 详细运维：`00_工作台/运营数据管理/艾维美术馆运营数据管理系统-部署方案.md`

### 云端服务器配置（2026-07-10 核实，部署前必读）

> **这是硬约束，不是参考**。下面所有路径、端口、容器名都以本节为准。任何与之不符的「直觉」都要先回到本节验证。

#### 主机

| 项 | 值 |
|---|---|
| IP | `122.51.56.50`（腾讯云轻量应用服务器）|
| OS | Ubuntu 22.04.5 LTS |
| 内核 | Linux 5.15.0-106-generic |
| 内存 | 3.3 GiB（无 Swap，注意 OOM）|
| 磁盘 | 40 GB / 已用 ~7 GB |
| SSH | `ssh root@122.51.56.50`，root 密钥登录 |

#### Docker 容器

| 容器 | 镜像 | 端口（对外） | 端口（容器内） | 用途 | 资源占用 |
|---|---|---|---|---|---|
| `aiwei-nginx-1` | `nginx:alpine` | **80** | 80 | 静态文件 + `/rest/*` 反代 | 5 MB |
| `aiwei-api-1` | 自建 `aiwei-api`（基于 `node:20-alpine`）| — | 3000 | Node.js REST API（`server.js`）| 19 MB |
| `aiwei-db-1` | `postgres:17-alpine` | — | 5432 | PostgreSQL 17 | 60 MB |

- **端口监听**：对外仅 Nginx:80；api:3000 在 docker 网络 `aiwei-net` 内，外部不可直连（必须经 Nginx 反代 `/rest/*`）；5432 在宿主机监听 `0.0.0.0`（依赖腾讯云安全组限制外网访问）。
- **数据库名**：`postgres`，用户 `postgres`，密码在 `/opt/aiwei/.env` 的 `DB_PASSWORD=Aiwei2024Gallery!`。
- **数据库现有表（13 张）**：app_config / artworks / content_posts / creative_products / expense / gallery_sales / inventory / operation_logs / partners / project_registry / revenue / space_usage / users。**新功能建表前先确认是否已有同名表，避免重复创建。**

#### 路径映射（最容易出错的点）

```
宿主机 /opt/aiwei/                容器内                     说明
─────────────────                ───────                    ────
./VERSION                         （无容器内映射，元数据）     当前云端值 1.2.0；不是 nginx / api 容器内文件
./app/                           /usr/share/nginx/html/     Nginx 静态 root
  ├─ index.html                                            ⚠️ 容器内是「扁平」的，没有 /usr/share/nginx/html/app/ 这一层
  ├─ css/style.css                                         浏览器访问 http://122.51.56.50/css/style.css（不是 /app/css/style.css）
  └─ js/ui.js                                              浏览器访问 http://122.51.56.50/js/ui.js
./nginx.conf                     /etc/nginx/conf.d/default.conf
./server.js                      /app/server.js              （api 容器内）
./app/sql/init.sql               /docker-entrypoint-initdb.d/init.sql  （db 容器内，初始化用）
./scripts/build-version.js       （不在容器内，仅本机构建时用）
```

> ⚠️ **核心约束**：Nginx 容器内的静态文件目录是 `/usr/share/nginx/html/`（扁平），**不存在 `app/` 这一层**。所以：
> - 本地源码在 `app/js/ui.js`，但线上浏览器访问的 URL 是 `/js/ui.js`（不是 `/app/js/ui.js`）
> - scp 目标路径是 `/opt/aiwei/app/js/ui.js`（带 `app/` 前缀，因为这是宿主机路径）
> - 不要在 curl 测试时写 `/app/...`，会 fallback 到 index.html

#### 本地预览（开发期用，2026-07-10 走通）

```bash
# 启动：根目录下用 preview_start 工具，或直接
node 00_工作台/运营数据管理/preview.js

# 访问
http://localhost:3000
```

- **设计**：纯 Node 0 依赖，静态文件从 `app/` 直接读，`/rest/*` 反代到腾讯云 API
- **优势**：改 `app/*` 文件后浏览器刷新即可看效果（**无须 scp 云端**），数据走云端 PG = 真实场景
- **自动启动**：`.claude/launch.json` 已配 `node 00_工作台/运营数据管理/preview.js`，preview 工具自动接管
- **环境变量**：`PORT`（默认 3000）、`UPSTREAM`（默认 `http://122.51.56.50`）
- **不要用 `npx serve`** —— `serve` 不代理 `/rest/*`，且本机装的服务端版本不一定有
- **`dist/` 目录** 不归本预览管，是 `scripts/deploy.sh` 复制给 Cloudflare Pages 用的另一条部署路径

#### 部署运维操作清单

**修改前端文件（HTML/CSS/JS）**：
```bash
scp <local-file> root@122.51.56.50:/opt/aiwei/app/<同相对路径>
# 例：scp app/js/ui.js root@122.51.56.50:/opt/aiwei/app/js/ui.js
# 上传即生效，浏览器需刷缓存（index.html 的 ?v= token 升级强制刷新）
```

**修改 `VERSION`（版本号文件）**：每次升级 `APP_VERSION` 时**同步 scp 到云端**，否则云端无对照、运营侧读不到真值：
```bash
scp VERSION root@122.51.56.50:/opt/aiwei/VERSION
# 路径：/opt/aiwei/VERSION（与 app/ 同级，**不带** app/ 前缀；不是 nginx 容器内）
# 当前云端值：1.2.0（2026-07-16 起的云端基线）
```

> 注：当前前端 `app.js` 用**硬编码常量** `const APP_VERSION = 'x.x.x'` 而非读 VERSION 文件，所以云端 VERSION 暂未被任何运行时消费。保留是为后续 build-version.js 切换为占位符机制时打好基础。

**修改 `server.js`（API 后端）**：
```bash
scp server.js root@122.51.56.50:/opt/aiwei/
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose build api && docker compose up -d api"
# ⚠️ 必须重建容器（api 镜像是自建 `aiwei-api`，不是从 registry 拉取）
# 重建期间 API 短暂不可用（约 10-30 秒）
```

**修改 `nginx.conf`**：
```bash
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose restart nginx"
```

**修改数据库结构（建表/改列）**：
```bash
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose exec -T db psql -U postgres -c \"CREATE TABLE ...\""
# 同步修改本地 app/sql/init.sql（让新部署也能建表）
```

#### 部署后必做验证（避免「scp 成功但实际未生效」）

```bash
# 1. 验证文件真的落地（防 scp 多文件静默跳过）
ssh root@122.51.56.50 "ls -la /opt/aiwei/app/js/ui.js"
# 检查 mtime 必须是当前时间

# 2. 验证 HTTP 能拉到新文件
curl -sS -o /dev/null -w "%{http_code} (%{size_download} bytes)\n" \
  "http://122.51.56.50/js/ui.js?v=<新token>"
# size 必须与本地一致

# 3. 验证 API 容器启动无错
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose logs api --tail=5"
# 必须看到 "AIWEI API server running on port 3000"，无 SyntaxError/ReferenceError

# 4. 验证关键 API 端点
curl -sS -o /dev/null -w "%{http_code}\n" "http://122.51.56.50/rest/v1/revenue?limit=1"
curl -sS -o /dev/null -w "%{http_code}\n" "http://122.51.56.50/rest/v1/space_usage?limit=1"
```

#### 不要做的事（历史踩坑）

| 错误做法 | 后果 | 正确做法 |
|---|---|---|
| `scp a b c d root@...:dest/` 一次传多个文件 | **部分文件会静默跳过**，mtime 不更新 | 一次一个文件，scp 完立刻 `ls -la` 逐个验证 mtime |
| `ssh root@... "node --check app/js/ui.js"` 做语法检查 | **宿主机 Node 12 不支持 `?.` 可选链**，会报假错 | 在容器内执行：`docker compose exec api node --check /app/server.js`（仅 server.js；前端 ui.js 靠浏览器解析，不需要服务端 Node 校验） |
| curl `http://122.51.56.50/app/js/ui.js` 测试 | 容器内没有 `/usr/share/nginx/html/app/`，fallback 到 index.html，**以为是 200 就以为对了** | 正确的 URL 是 `/js/ui.js`（无 `app/` 前缀）|
| 本地 `npx serve -s dist` 起 preview 验证 | ~~本机连不上远端 PG 且 serve 不代理 API~~（已解决） | 见下方「本地预览」章节 |
| 直接 `docker compose restart` 改 server.js 后 | 容器用旧镜像，server.js 修改不生效 | 必须先 `docker compose build api --no-cache` 再 `up -d` |
| 用 admin 账号做功能测试 | 污染生产数据，无法用 `git log` 追踪测试痕迹 | 用 test4 账号测试，测试完成 DELETE 该账号产生的业务数据 |

## 问题处理六步流程

### 概述

所有任务（修复 bug、添加功能、重构等）必须按以下六步执行，不可跳步。采用 **loop 工作模式**：将任务拆分成若干小任务，每个 session 执行多轮循环，每轮完成一个完整的六步流程。

**默认终止条件：每个 session 执行 6-8 轮六步循环后，询问用户是否继续。**

### 六步流程

[BEGIN CHECKLIST]
□ 步骤 1 分析（确认任务、分析任务）：先不动手。确认任务是什么、要解决什么问题；再分析问题在哪、根因是什么。查看相关代码、数据流、日志，形成判断。

□ 步骤 2 设计（设计方案）：写下执行方案（改什么文件、怎么改、预期效果），作为后续执行中的回溯路径，防止执行到一半跑偏。如果执行中发现了方案未预料到的情况，先暂停，回到此步更新方案再继续。

□ 步骤 3 执行（按方案实施）：按既定的方案动手改代码。

□ 步骤 4 验证（对照分析与方案验证）：对照第 1 步的分析和第 2 步的方案来验证是否真的生效。根据问题类型选择验证方式：
  - 前端问题：浏览器预览 + 控制台确认
  - 后端问题：API 请求测试
  - 部署问题：确认线上表现

□ 步骤 5 复盘（全流程回顾 + 沉淀）：从第 1 步到第 4 步，从头回顾：
  - 问题分析是否到位？有没有漏掉关键线索？
  - 方案设计是否合理？有没有更简单的解法？
  - 执行过程有无偏离方案？为什么偏离？
  - 验证方法是否充分？有没有遗漏的场景？
  - **复盘的核心目标**：找出哪些因素影响了分析、设计、执行的判断，导致方向错误。将这些经验沉淀到 memory 或更新相关文档。

□ 步骤 6 继续发现（主动迭代）：用复盘得到的认知，主动检查代码库中是否存在同类模式或问题，进入下一轮循环。修一个 bug 或完成一个功能不是终点，每轮循环都要让系统或方法变得更好一点。
[END CHECKLIST]

### 验证失败的回落规则

验证不合格时，不能直接回到执行阶段，必须按以下规则逐级回溯：

- **第 1 次验证失败** → 回到**步骤 2（设计）**，重新制定方案，然后按 执行→验证 继续
- **第 2 次验证失败** → 强制回到**步骤 1（分析）**，重新分析问题根因，然后按 设计→执行→验证 继续
- **第 3 次验证失败** → 回到**步骤 2（设计）**，重新制定方案
- **第 4 次验证失败** → **直接进入步骤 5（复盘）**，沉淀失败原因，标记任务为**未完成**，结束流程

> 设计逻辑：连续失败通常意味着"对问题的根本理解有误"而非"方案写得不够好"，所以第 2 次失败强制回溯到分析阶段，打破执行↔验证的死循环。

### 核心强调

**警告：步骤 5（复盘）和步骤 6（继续发现）是六步流程的核心价值所在，不可省略。如果任务完成时没有执行这两步，视为任务未完成。**
