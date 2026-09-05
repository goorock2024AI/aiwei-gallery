# 前端静态热修 Runbook

适用于只修改前端静态文件的任务。

## 目标

用固定、小型流程完成前端修复和上线，避免重复验证、重复备份和重复描述。

## 流程

1. 归类  
确认只改 `app/index.html`、`app/css/*`、`app/js/*` 或对应 `dist/` 镜像；不涉及后端、数据库、权限或生产写入。

2. 本地验证  
按 `minimum-verification-matrix.md` 的“前端静态热修”标准执行。只跑与本任务相关的专项脚本。

3. 发布  
优先使用 `scripts/deploy-static-hotfix.ps1`。  
脚本不可用时，手工按单文件执行：备份 -> 上传 -> mtime/size -> HTTPS token -> API 冒烟。

4. 线上验证  
按 `minimum-verification-matrix.md` 的“前端静态热修”线上项执行。路径或容器不确定时读 `runtime-facts.md`；命中历史坑时读 `deployment-gotchas.md`。

5. 记录  
开发日志写改动、验证摘要、回滚点、边界和状态，不复制完整命令输出。

## 退出条件

- 没有改生产数据。
- 没有后端容器重建需求。
- 线上静态文件和 API 冒烟通过。
- 日志可追溯到回滚点。
