# aiwei-operations — 运营数据管理系统

## 技术栈
- 前端：纯 HTML/CSS/JS（无框架）
- 后端：Node.js（自建 REST API）
- 数据库：PostgreSQL 17（Docker 容器内）
- 图表：Chart.js
- 部署：腾讯云轻量应用服务器（Docker Compose 编排）

## 服务器信息
| 项目 | 详情 |
|------|------|
| 服务器 | 腾讯云轻量应用服务器 Ubuntu 22.04 |
| IP | `122.51.56.50` |
| SSH 密钥 | `~/.ssh/id_rsa`（本地私钥）|
| 部署目录 | `/opt/aiwei/` |
| SSH 连接 | `ssh root@122.51.56.50` |

## 架构

```
用户浏览器 → http://122.51.56.50
                  │
            Nginx（:80）
            ├─ 静态文件（/usr/share/nginx/html）
            └─ 反向代理 → Node.js API（api:3000）
                               │
                           PostgreSQL 17（db:5432）
```

## 容器服务（Docker Compose）

| 容器 | 功能 | 端口 |
|------|------|------|
| nginx | 前端页面 + API 反向代理 | 80 |
| api | 业务 REST API（server.js）| 3000 |
| db | PostgreSQL 数据库 | 5432 |

```bash
# 服务管理（在服务器上执行）
cd /opt/aiwei
docker compose ps                   # 状态
docker compose logs -f [容器名]     # 日志
docker compose restart [容器名]      # 重启
docker compose build api            # 更新 API
docker compose up -d api            # 启动新版 API
docker compose exec db psql -U postgres  # 直接操作数据库
```

## API 端点

所有 API 通过 Nginx 反向代理访问：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/rest/v1/login` | 服务端密码校验登录 |
| POST | `/rest/v1/change-password` | 修改密码 |
| GET  | `/rest/v1/{table}` | 列表查询（支持 eq/neq/gte/lte/ilike 过滤器）|
| GET  | `/rest/v1/{table}?id=eq.{id}` | 单条查询 |
| POST | `/rest/v1/{table}` | 新增记录（JSON body, camelCase 自动转 snake_case）|
| PATCH | `/rest/v1/{table}?id=eq.{id}` | 更新记录 |
| DELETE | `/rest/v1/{table}?id=eq.{id}` | 删除记录 |

支持的表：`revenue`, `expense`, `space_usage`, `gallery_sales`, `app_config`, `users`, `operation_logs`, `project_registry`, `inventory`, `artworks`, `partners`, `content_posts`

## 数据库实体（12 张表）

| 表 | 记录数 | 说明 |
|----|:------:|------|
| revenue | 165 | 收入记录（含全部历史）|
| expense | 0 | 支出记录 |
| space_usage | 0 | 空间使用 |
| gallery_sales | 0 | 画廊销售 |
| app_config | 4 | 动态配置（票务/咖啡/工坊/空间）|
| users | 4 | 用户（admin + 3 成员）|
| operation_logs | 16 | 操作日志 |
| project_registry | 0 | 项目注册表 |
| inventory | 0 | 库存 |
| artworks | 0 | 艺术品 |
| partners | 0 | 合作伙伴 |
| content_posts | 0 | 内容发布 |

## 目录结构
```
00_工作台/运营数据管理/
├── app/                    # 前端代码
│   ├── index.html          # 入口页面
│   ├── css/style.css       # 样式
│   ├── js/
│   │   ├── app.js          # 初始化与路由
│   │   ├── auth.js         # 认证（调用服务端登录 API）
│   │   ├── charts.js       # 图表渲染
│   │   ├── import-export.js# 导入导出
│   │   ├── models.js       # 数据模型
│   │   ├── store.js        # REST API 封装（CRUD）
│   │   ├── supabase-config.js  # API 连接配置
│   │   ├── ui.js           # UI 渲染核心
│   │   └── operation-logger.js # 操作日志
│   └── sql/init.sql        # 数据库初始化 DDL + 种子数据
├── server.js               # Node.js REST API 服务
├── Dockerfile              # API 容器镜像定义
├── docker-compose.yml      # 3 容器编排
├── nginx.conf              # Nginx 反向代理配置
├── deploy.sh               # 一键部署脚本（本地执行）
├── package.json            # Node.js 依赖
└── POS收银台开发日志.md     # 开发日志（含本次上线记录）
```

## 管理员账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin888 | 管理员（操作入口：http://122.51.56.50）|

## 数据迁移来源
- 旧 Supabase 实例：`https://pyzitexdzfrbexwgoqpz.supabase.co`
- 前端直连 Supabase 的旧架构已废弃
- 2026-07-04 完成 165 条 revenue、4 个用户、16 条日志、4 项配置的迁移

## 开发流程
1. 编辑 `00_工作台/运营数据管理/app/` 或 `server.js`
2. 更新前端文件后上传服务器：`scp app/js/xxx.js root@122.51.56.50:/opt/aiwei/app/js/`
3. 更新 server.js 后需要重建 API：`ssh root@122.51.56.50 "cd /opt/aiwei && docker compose build api && docker compose up -d api"`
4. 更新后递增 `index.html` 中 JS 文件的 `?v=N` 版本号（强制浏览器刷新缓存）
5. 提交 git：暂存对应改动的文件后 commit

## 注意事项
- `supabase-config.js` 中的 `url` 已改为 `http://122.51.56.50`，指向自有 API
- 操作涉及数据变更（SQL/API 写入）需先确认再执行
- 服务器防火墙仅开放 22（SSH）和 80（HTTP）
- 当前无 HTTPS 配置，`crypto.subtle.digest()` 不可用（已通过服务端登录绕过）
