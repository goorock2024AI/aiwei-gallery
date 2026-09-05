# M3-03 本地迁移演练总结

执行日期：2026-09-03

## 演练环境

- 环境类型：本机隔离 PostgreSQL 17 临时集群。
- 数据目录：`tmp/m3-03-pgdata-20260903-1433`。
- 监听地址：`127.0.0.1:55433`。
- 认证方式：本地测试 trust 认证。
- 数据来源：`app/sql/init.sql` 初始化的空 1.0 基础结构，不使用生产数据。
- 敏感信息：未读取生产库连接，未打印数据库连接密钥。

## 执行结果

| 项目 | 结果 |
|---|---|
| preflight | PASS 18，WARN 1，BLOCKER 0 |
| Node 版完整演练 | 通过 |
| psql/PowerShell 版完整演练 | 通过 |
| 1.0 初始化 | 通过 |
| M3-02 迁移脚本 | 通过 |
| v2 事实视图创建 | 通过 |
| 验证 SQL | 通过 |
| 回滚 SQL | 通过 |
| 回滚后 1.0 重建 | 通过 |
| 最终 v2 对象清理 | `remaining_v2_objects = 0` |

## API 权限冒烟

测试 API：`http://127.0.0.1:3013`，连接本机隔离测试库。

| 场景 | 结果 |
|---|---|
| 未登录 GET `business_dimensions` | 401 |
| viewer GET `business_dimensions` | 200 |
| viewer GET `business_revenue_facts_v2` | 403 |
| viewer GET `business_cost_facts_v2` | 403 |
| viewer GET `business_profit_facts_v2` | 403 |
| editor GET `business_revenue_facts_v2` | 200 |
| editor GET `business_cost_facts_v2` | 200 |
| editor GET `business_profit_facts_v2` | 200 |
| admin POST `business_profit_facts_v2` | 405 |
| editor POST `product_aliases` | 201 |
| editor GET `product_aliases` 测试记录 | 200 |
| editor GET 1.0 `revenue` | 200 |
| editor GET 1.0 `revenue_facts` | 200 |
| viewer GET 1.0 `revenue_facts` | 200 |

## 证据路径

- preflight 报告：`tmp/m3-03-preflight-20260903-143421.md`
- Node 演练日志：`tmp/m3-03-node-rehearsal-2026-09-03T06-34-22-436Z`
- psql 演练日志：`tmp/m3-03-rehearsal-20260903-143820`
- 最终 API 共存测试日志：命令输出已在本轮任务记录中保留。

## 边界

- 未连接生产库。
- 未执行生产迁移。
- 未部署本地 `server.js` 改动。
- 未使用生产业务数据。
- 临时 PostgreSQL 已停止。

## 结论

M3-03 本地迁移演练通过。M3-02 迁移包在空 1.0 基础结构上可执行、可验证、可回滚；本地 API 白名单与只读守卫可通过运行时冒烟。进入生产迁移前仍需另行完成生产备份、生产基线和上线授权。
