# 艾维美术馆项目规则

## 2.0 工作区入口

运营系统 2.0 开发先读 [DEVELOPMENT.md](DEVELOPMENT.md)，按其中的分支与工作区定位代码。

本文件是短入口。只保留每次都需要的规则；任务相关细节通过指针读取。

## 通用规则

1. 新增文档使用 Markdown。
2. 本文件与根目录 `AIWEI.md` 同时生效。
3. 系统任务先做初步分级和路由，再进入分析。方向型任务必须先通过问答确认真实目标；执行闭环见 `docs/agents/six-step-loop.md`。

## 仓库入口

| 仓库 | 路径 | 用途 |
|---|---|---|
| aiwei-gallery | `.` | 入口索引、全局规则 |
| aiwei-operations | `./aiwei-operations/` | 运营数据系统开发 |
| aiwei-planning | `./aiwei-planning/` | 规划文档、项目注册表 |
| aiwei-content | `./aiwei-content/` | 自媒体内容 |

启动时先读 `INDEX.md` 判断所属子仓；只在相关子仓内工作。跨仓数据通过正式 API 查询，不跨仓读文件替代事实源。

## 数据规则

- 项目状态以 `registry/*.md` 为准。
- 财务数据从腾讯云 API 实时获取，不从文档推断。
- 项目注册表在 `registry/`，并同步写入腾讯云 API。

## 运营数据系统

核心路径：`00_工作台/运营数据管理/`

常用入口：

- 正式地址：`https://iwe.ucanart.cc`
- 开发日志：`00_工作台/运营数据管理/POS收银台开发日志.md`
- 部署方案：`00_工作台/运营数据管理/艾维美术馆运营数据管理系统-部署方案.md`
- 低开销交付：`00_工作台/运营数据管理/references/delivery-optimization.md`

触发规则：

- 优化、修复、部署、排障运营系统时，只先读 `references/delivery-optimization.md` 归类。
- 该入口会按任务类型指向必要的 runbook、事实源、验证标准或高风险流程；不要从 `CLAUDE.md` 直接展开部署细节。

## 执行闭环

任务路由和初步分级在入口完成；六步流程负责执行中的真实目标、方案、验证、复盘和继续发现。方向型任务在目标未确认前，不进入设计或开发。

详细流程、失败回落和完成标准见 `docs/agents/six-step-loop.md`。

## Agent 资料

- Issue tracker：`docs/agents/issue-tracker.md`
- Triage labels：`docs/agents/triage-labels.md`
- Domain docs：`docs/agents/domain.md`
