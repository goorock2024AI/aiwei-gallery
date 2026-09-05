# 部署踩坑

用于部署、线上验证、路径排障时读取。

| 场景 | 正确做法 |
|---|---|
| 上传前端文件 | 一次一个文件上传，上传后立刻查 mtime/size |
| 验证静态 URL | 浏览器路径是 `/js/ui.js`、`/css/style.css`，不是 `/app/js/ui.js` |
| 修改 `server.js` | 重建 API 镜像并 `up -d api`，单纯 restart 不会使用新文件 |
| 前端 JS 语法检查 | 本地 `node --check`；不要用宿主机旧 Node 检查前端可选链 |
| 本地预览 | 用 `preview.js`，不要用不代理 `/rest/*` 的静态 server |
| 功能测试账号 | 用 `test4`，测试后清理业务数据 |
| SSH 限流 | 出现 `Exceeded MaxStartups` 后等待至少 30 秒 |
| VERSION | 修改版本元数据时上传到 `/opt/aiwei/VERSION`，不是 app 目录 |

