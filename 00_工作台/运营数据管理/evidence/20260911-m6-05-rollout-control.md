# M6-05 2.0 灰度开关与入口控制证据

- 日期：2026-09-11
- 版本：`2.0.0-dev.m6-05.1`
- 环境：本机隔离 PostgreSQL、Node API、Edge/Playwright
- 边界：未连接生产、未读取或修改真实业务数据、未部署、未推送
- 结论：通过；下一任务 M6-06

## 1. 灰度模型

`app_config.operations_rollout` 保存单一模式，新库和迁移默认 `off`。

| 模式 | admin | editor | viewer |
|---|---|---|---|
| `off` | 关闭 | 关闭 | 关闭 |
| `admin` | 开放 | 关闭 | 关闭 |
| `staff` | 开放 | 开放 | 关闭 |

前端在状态返回前默认隐藏入口；导航点击和 `OperationsDashboard.render()` 分别校验权限。开放时侧栏和页面显示对应试运行标识。关闭只影响 2.0 运营管理，1.0 页面保持原权限。

## 2. 变更与审计

专用接口 `GET/POST /rest/v1/operations-rollout` 负责读取和管理员变更。POST 要求合法模式及 4–300 字原因，在事务中建立并锁定配置行后比较旧值，拒绝无变化提交。每次真实变化写入 `operation_logs`：

- `action=operations_rollout_change`
- `table_name=app_config`
- `record_id=operations_rollout`
- `details={oldMode,newMode,reason}`
- `user_id` 从登录会话取得，时间由服务端写入

通用 `app_config` POST、PATCH 当前键、PATCH 改键和 DELETE 均不能修改或移除该配置。

## 3. 验证结果

| 检查 | 结果 |
|---|---|
| `npm run check:m6-rollout` | 26 项 HTTP 检查通过；三模式、三角色、绕过拦截、3 次可信审计、敏感 API 和 1.0 隔离通过 |
| `npm run check:m6-rollout-browser` | off 入口隐藏与直接页面保护、admin/staff 矩阵、试运行标识和管理卡通过；页面异常 0 |
| `npm run check:m6-migrations` | 19 个正向、15 个回滚；逐文件幂等、完整回滚、再次重放、旧版事实不变通过 |
| `npm run check:m6-core` | 100 项核心权限与流程 HTTP 检查通过 |
| `npm run check:m6-reconciliation` | 收入、成本、画廊、空间、日结及差异集精确对账通过 |
| `npm run check:dist-sync` | `app/dist` 关键静态文件同步 |

测试脚本在结束时恢复原灰度配置并清理专项审计记录。全新数据库演练库自动删除，业务样本清理后核心事实恢复。

## 4. 结论

M6-05 无未关闭 P0/P1。2.0 已具备默认关闭、管理员试运行、内部试运行和可追溯切换能力，可以进入 M6-06 本地观测与问题闭环建设。生产状态仍保持未迁移、未部署。
