# M5-05 数据治理工作台验证记录

- 日期：2026-09-10
- 版本：`2.0.0-dev.m5-05.1`
- 工作区：`C:/Users/goorock/.codex/worktrees/ac2e/艾维美术馆`
- 分支：`codex/operations-v2`
- 状态：本地验证通过；未读取生产、未迁移生产、未部署。

## 交付内容

运营管理页已接入数据治理工作台。当前月份的问题摘要直接读取 `data_governance_baseline_v2`，固定展示待归类收入、待归类成本和缺成本商品/作品的问题数、影响记录、影响金额、优先级与来源。工作台不会把候选数混入稳定问题数。

候选队列复用 M4 已冻结的 `product_alias_candidates_v2`、`product_master_governance_v2`、`revenue_attribution_candidates_v2`、`cost_attribution_candidates_v2`、`gallery_link_candidates_v2`、`workshop_link_candidates_v2` 和 `space_classification_candidates_v2`，归入六个管理域。收入、支出、画廊、工坊和空间候选按所选月份在服务端过滤；商品卡明确标记为“全部历史别名 + 当前商品主数据”。每个候选来源最多读取 500 条，达到上限时显示 `500+`。

批次状态按所选月份读取 `governance_batch_summary_v2`，分列草稿、待审核、已批准、已应用、已拒绝和已撤销。运营管理页只展示摘要；完整候选和治理写动作继续进入 M4 页面。

## 验证结果

| 验证项 | 结果 |
|---|---|
| 纯模型 | 三类基线合计、问题与候选分列的 P1-P4、六个候选域、状态分布、批次状态、空期间及部分失败通过 |
| 隔离样本 | 3 个稳定治理问题、4 条候选/证据；问题影响金额 45.00；商品、收入、支出候选与基线逐项一致 |
| 批次状态 | 同月展示草稿、待审核、已批准、已应用各 1 个；进行中批次为草稿、待审核、已批准共 3 个 |
| 查询范围 | 基线使用 `period_month=eq.YYYY-MM`；五类期间候选使用 `business_date` 月初/月末；批次使用 `created_at` 月初/月末 |
| 失败隔离 | 主动中断空间候选请求后只标记空间合作来源失败，其他治理卡片、经营总览和趋势保持可用 |
| editor | 可见运营管理和数据管理入口；数据管理页只显示治理批次区；可见草稿流程，不显示批准、拒绝、应用或撤销按钮；审批接口返回 403 |
| admin/viewer | admin 可见四类专属批次动作；viewer 运营管理入口隐藏，治理基线请求返回 403；只读汇总写入返回 405 |
| 响应式 | Microsoft Edge 1440×1100 和 390×844 可用；摘要、问题卡、优先级、候选域和批次状态按宽度重排 |
| 回归 | M5-02 页面框架、M5-03 四层总览、M5-04 趋势比较、创意商品选择器、收入比较图及静态目录同步全部通过 |

浏览器专用插件当前不可用，本次使用工作区共享 Playwright 驱动 Microsoft Edge。页面异常为 0。桌面截图位于 `C:/Users/goorock/AppData/Local/Temp/aiwei-m5-05-desktop.png`，手机截图位于 `C:/Users/goorock/AppData/Local/Temp/aiwei-m5-05-mobile.png`。

隔离样本使用 `m505-` 前缀。测试结束后收入、支出、商品、业务链接、治理批次和操作日志对应记录数均为 0；M5-03/M5-04 回归夹具也已清零。测试 API 端口 3124 与 PostgreSQL 端口 55435 已关闭。

## 权限边界与回退

本任务没有修改服务端角色规则、数据库结构或原始事实。前端权限与既有服务端能力对齐：editor 可创建、dry-run、提交治理批次；admin 才能批准、拒绝、应用或撤销。运营管理工作台本身不提供写动作。

回退只需恢复 `app` 与仓库根 `dist` 中的 `operations-dashboard.js`、`style.css`、`index.html`、`app.js`、`auth.js`、`ui.js`，并移除 M5-05 检查脚本。

下一任务为 M5-06 业务模型对应展示。生产读取、真实数据治理和部署仍需单独安排。
