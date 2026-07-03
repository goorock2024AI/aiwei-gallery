# 艾维美术馆 — 项目基础规则

## 通用规则
1. 新增文档使用 Markdown (.md) 格式。
2. 所有任务先沟通确认需求再执行，不可先斩后奏。
3. 本文件与根目录 AIWEI.md 同时生效，规则冲突以本文件为准。

## 仓库架构

| 仓库 | 路径 | 用途 |
|------|------|------|
| aiwei-gallery（根） | . | 入口索引 INDEX.md |
| aiwei-operations | ./aiwei-operations/ | 运营数据系统开发 |
| aiwei-planning | ./aiwei-planning/ | 规划文档 + 项目注册表 |
| aiwei-content | ./aiwei-content/ | 自媒体内容 |

各子仓库有独立的 AIWEI.md 工作规则。

## 启动流程
1. 读 INDEX.md 了解总览。
2. 根据任务确定所属子仓库，只在该仓内工作。
3. 跨仓库数据通过 Supabase 查询，不跨仓读文件。

## 数据管理
- 项目注册表在 registry/，同时写入 Supabase project_registry 表。
- 财务数据从 Supabase 实时获取，不从文档读取。
- 项目状态以 registry/*.md 为准。

