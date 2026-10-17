# 共享自动部署接入

项目 ID 保持 `goorock2024AI--aiwei-gallery`。共享服务读取默认分支 main 的 `.agentos/deploy.yaml` 授权，发布分支为 `codex/shared-auto-deploy`；两侧 branch 必须一致，任一侧 enabled=false 都禁止后续发布。

服务每轮扫描 GitHub，按发布分支精确 SHA 下载、构建 API、启动 API/Nginx 并检查健康。不新增 Actions、Webhook 或 SSH Secret，不通过手动部署代替推送测试。

## 首次接管基线

远端 main 为 1.3.3，已提交的 2.0 分支仅 rc.9，线上已为 rc.17。因此本发布分支在 main 基础上，仅将 40 个构建输入文件对齐到 2026-10-17 当前线上副本，清单与 SHA256 见 `.agentos/production-source-sha256.json`。包括当日已在线的周报更新，未从其他工作区批量提交未完成工作。实际源码仍在 `00_工作台/运营数据管理/`；本分支是生产发布基线，后续应先在开发分支验证，再将相关变更同步到本分支，不合并无关工作。

源码保持线上字节内容，包括历史缓存标识和部分旧显示版本文字，不借接入重构业务代码。SQL 清单只是当前镜像的既有依赖，本次不执行其中的迁移。静态服务仅挂载三份入口 HTML 和 js/css/lib，排除旧种子、历史 SQL 和无关旧文件。

## 资源与环境

- 服务器项目目录：`/opt/agentos-deploy/projects/goorock2024AI--aiwei-gallery`。
- 管理员维护 `settings.json` 为 `{"compose_project":"aiwei"}`，沿用现有 API/Nginx 容器身份。
- `production.env` 从现有生产环境文件在服务器内部准备，权限 600；不提交凭据，不作为镜像构建参数。
- Compose 只声明 api/nginx；数据库不纳入新建、初始化、重建或迁移。
- 沿用外部网络 `aiwei_aiwei-net`、数据库主机 `db`、现有卷 `aiwei_uploads-data`；原 `aiwei_db-data` 及数据库容器不变。
- Nginx 固定现有镜像 digest，绑定 `127.0.0.1:8081`；`wechat-gateway` 使用 host 网络，公网入口为 https://iwe.ucanart.cc 。
- `/healthz` 明确代理真实 API，避免 SPA 首页的伪健康 200；另外检查首页 200 与匿名经营接口 401。
- API 镜像由服务按 SHA 标记。构建基镜像和 npm 依赖目前仍继承原 Dockerfile 的可变解析方式，未实现跨时间完全可重现构建；回退使用保留的实际镜像，不重新构建。

## 备份与回退

首次切换备份目录：`/opt/aiwei/backups/agentos-first-adoption-20261017`。包括生产代码配置、PostgreSQL dump、上传卷备份、容器检查快照和数据指纹，均只在服务器保留。数据库 dump 已通过 pg_restore 清单及独立无网络、tmpfs PostgreSQL 17 的完整恢复（55 个 public 表/视图）。

首次失败还没有共享服务的上一个 healthy release，不能依赖它自动恢复旧部署。管理员执行该备份目录中的 `rollback-application.sh` 可用原 `/opt/aiwei` 代码与配置恢复 API/Nginx，明确固定 `aiwei-api:pre-agentos-20261017` 和旧 Nginx digest，避免候选构建改变可变标签。脚本不操作数据库。回退前先在默认分支或发布分支关闭 enabled，阻止后续推送发布。

后续失败由共享服务尝试切回上一个 healthy SHA 的保留镜像；恢复后仍需人工核对公网、鉴权和经营数据。**应用回退不撤销数据库迁移或经营数据写入。** 本次 migration=null，无结构变化。数据库备份仅在单独评估数据损失和获得恢复授权后用于数据恢复，不能直接覆盖较新的生产数据。

## 验证与范围

本地 40 文件哈希、JavaScript 语法检查通过。电脑没有 Docker，因此 Compose 解析、与实际 API 凭据一致性校验及候选构建在服务器隔离临时目录执行，预检未运行生产切换命令。资源检查确认仅有 API/Nginx、原外部网络及卷、loopback 端口。

共享服务身份兼容修复位于 Agent OS PR #1 的 `a51408d7c25f22b3a912afc9916d7d86d3b5fc93`，11 项测试通过。项目身份与严格协议不变，Docker 安全命名与协议身份分离，旧小写项目资源名保持不变。

2026-10-17 已完成真实 GitHub 发布分支更新触发的自动部署，最终成功 SHA 为 `5561b5c79e10e16e0450acad7f1078adcad487a2`，state.json 为 healthy。验证细节及首次检查发现问题的修复经过见 [实测记录](shared-auto-deployment-verification-2026-10-17.md)。只做只读业务验证，不创建测试经营流水，不代替馆长验收经营效果。默认分支授权、分支提交、备份、源码清单及部署结果共同组成交付证据。

共享服务另完成轻量分支引用轮询与解压目录权限修复；服务器最终安装版本为 Agent OS PR #1 的 `ef4f434d2fcc4e6dc73a9069682816421ab5dab4`。静态资源缺失或不可读时返回404，CSS及JS已纳入健康检查。
