# 发布检查清单（兼容索引）

默认不要从本文件开始部署任务。先读 `delivery-optimization.md` 归类，再进入对应 runbook 或验证标准。

## 去向

- 任务路由：`delivery-optimization.md`
- 前端静态热修：`runbook-frontend-static-hotfix.md`
- 验证标准：`minimum-verification-matrix.md`
- 运行事实：`runtime-facts.md`
- 部署踩坑：`deployment-gotchas.md`

## 共性原则

- 发布前确认红线：数据库、权限、退款/作废、删除、生产写入、密钥。
- 发布中必须有可回滚对象。
- 发布后必须有线上证据和日志记录。
