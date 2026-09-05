# 运营数据系统运行事实

用于部署、排障、路径确认和线上验证。普通代码任务不需要读取本文件。

## 正式入口

- 正式访问地址：`https://iwe.ucanart.cc`
- 服务器 IP：`122.51.56.50`
- 部署目录：`/opt/aiwei`
- 入口链路：用户浏览器 -> `wechat-gateway` 80/443 -> `127.0.0.1:8081` -> `aiwei-nginx-1` -> `aiwei-api-1` -> `aiwei-db-1`

## 容器

| 容器 | 用途 | 端口 |
|---|---|---|
| `wechat-gateway` | HTTPS 网关 | 80/443 host 网络 |
| `aiwei-nginx-1` | 静态文件和 `/rest/*` 反代 | 8081 -> 80 |
| `aiwei-api-1` | Node.js REST API | Docker 网络 3000 |
| `aiwei-db-1` | PostgreSQL 17 | Docker 网络 5432 |

## 路径映射

| 宿主机 | 容器内 | 说明 |
|---|---|---|
| `/opt/aiwei/app/` | `/usr/share/nginx/html/` | 静态 root，容器内没有 `/app/` 这一层 |
| `/opt/aiwei/app/js/ui.js` | `/usr/share/nginx/html/js/ui.js` | 浏览器访问 `/js/ui.js` |
| `/opt/aiwei/server.js` | `/app/server.js` | API 容器内文件 |
| `/opt/aiwei/VERSION` | 无容器映射 | 元数据文件 |

## 本地预览

```bash
node 00_工作台/运营数据管理/preview.js
```

- 本地访问：`http://localhost:3000`
- 默认 upstream：`http://122.51.56.50`
- HTTPS 验证可临时设 `UPSTREAM=https://iwe.ucanart.cc`

## 部署命令要点

前端静态文件上传到 `/opt/aiwei/app/<相对路径>`，上传即生效，必须更新并验证 cache-bust token。

后端 `server.js` 修改后必须重建 API 容器：

```bash
ssh root@122.51.56.50 "cd /opt/aiwei && docker compose build api && docker compose up -d api"
```

数据库结构变更必须先备份，并同步更新本地初始化 SQL 或 migration。

