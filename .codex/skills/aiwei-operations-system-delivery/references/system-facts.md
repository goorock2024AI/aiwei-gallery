# 运营数据系统事实锚点

## 项目位置

- 系统主目录：`00_工作台/运营数据管理/`
- 线上镜像/部署相关文件：根目录 `dist/`、`wrangler.jsonc`、`deploy.sh`
- 开发日志：`00_工作台/运营数据管理/POS收银台开发日志.md`
- 月度工作日志：`00_工作台/工作日志/`

## 当前架构

- 前端：纯 HTML/CSS/JS
- 后端：Node.js 自建 REST API
- 数据库：PostgreSQL 17
- 部署：腾讯云轻量服务器 Docker，Nginx + API + DB

## 高风险事实

- 经营数据以当前腾讯云自建 API / 正式系统为准。
- Supabase 是历史迁移来源，不能作为当前写入事实源。
- API 鉴权、HTTPS、自动备份、退款/作废、库存扣减、采购入库、日结报表仍是下一阶段重点核验项。
- 临时排查脚本可能包含敏感连接信息，默认不得入库。

## 常见同步点

- 新增表：建表、`server.js` tableMap、白名单、前端模型、初始化 SQL 必须成组核对。
- 新增侧边栏页面：`index.html`、`app.js` 路由、`auth.js` accessMap 必须成组核对。
- 版本升级：`VERSION`、`app/js/app.js`、`index.html` token、日志必须同步。
