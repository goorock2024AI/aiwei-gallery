# M5-06 业务模型对应展示验证记录

- 日期：2026-09-10
- 版本：`2.0.0-dev.m5-06.1`
- 分支：`codex/operations-v2`
- 环境：本地隔离 PostgreSQL `127.0.0.1:55435/aiwei_m3_05_test`、本地 API `127.0.0.1:3124`、Microsoft Edge
- 边界：未连接生产、未修改数据库结构或业务记录、未部署

## 交付结果

运营管理页“业务模型对应”区已从占位说明升级为只读模型地图。页面以 `business_dimensions` 为唯一字典来源，固定按业务层、业务类型、成本类型、能力轴四类展示；业务类型通过 `parent_code` 标注所属业务层，启用与停用项分别计数并保留可见。

页面同时展示经营事实链和 9 项指标映射。原始收入、支出、零售、画廊、工坊和空间记录进入 `business_revenue_facts_v2`、`business_cost_facts_v2`、`business_profit_facts_v2` 与 `business_layer_summary_v2`，再由总览、矩阵和趋势区直接读取冻结字段。待归类影响继续来自 `data_governance_baseline_v2` 并单独展示；毛利率空值仍显示“—”；1.0/2.0 差异只用于口径核对。

模型区明确标识为全局只读说明，不随年月筛选改变，也不提供维度或事实写动作。接口失败时只降级模型区，静态事实链和指标映射仍保留，其他经营分区不被清空。

## 数据与权限验证

隔离数据库实际返回 28 个启用字典项：4 个业务层、11 个业务类型、10 个成本类型、3 个能力轴。页面业务层顺序与冻结模型一致：到馆参观、现场消费、体验活动、艺术交易与合作。

| 场景 | 结果 |
|---|---|
| admin 读取 `business_dimensions` | 200 |
| editor 读取并展示完整模型地图 | 200 |
| viewer 读取公共业务字典 | 200 |
| viewer 查看运营管理入口 | 前端隐藏 |
| 未登录读取业务字典 | 401 |
| 模型接口中断 | 模型区显示失败，其他区继续可用 |

## 自动化与界面验收

- `npm run check:m5-model`：四类顺序、父级映射、停用项、空字典、事实链和 9 项指标来源通过。
- `npm run check:m5-model-browser`：实际字典对账、`order=sort_order.asc&limit=500` 有界查询、权限、失败隔离、1440px 和 390px Edge 页面通过，页面脚本错误为 0。
- `npm run check:m5-overview`、`check:m5-trend`、`check:m5-governance`：M5-03 至 M5-05 纯模型回归通过。
- `npm run check:creative-pos-picker`、`check:revenue-comparison-chart`：既有前端关键回归通过。
- `npm run check:dist-sync` 以及 app/dist JavaScript 语法检查通过。

本次浏览器验证只读取隔离字典，没有新增或修改业务数据。测试 API 与 PostgreSQL 在验证后关闭。

## 下一任务

M5-07 统一筛选、来源下钻与 UTF-8 CSV 导出。
