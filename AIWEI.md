# 艾维美术馆 — Claude 工作规则

## 启动流程
1. 读取 INDEX.md，了解总览
2. 根据任务类型确定所属子仓库
3. 如需跨仓库数据，查 Supabase 而非读文件

## 仓库对应规则

| 任务类型 | 工作仓库 |
|---------|---------|
| 运营数据系统开发/维护 | aiwei-operations/ |
| 项目策划/跟踪/报告 | aiwei-planning/ |
| 展览/活动/合作项目跟踪 | aiwei-planning/registry/ |
| 公众号/内容排期 | aiwei-content/ |
| 全馆整体评估 | 查 Supabase + 读 INDEX.md |

## 数据规则
- 财务数据从 Supabase 实时获取，不从文档获取
- 项目状态以 registry/*.md 为准
- 更新项目状态时同时更新 registry 文件和 Supabase project_registry 表
- 所有业务的"项目名称"在录入时保持与 registry 中 ops_project_name 一致

## 避免的操作
- 不扫描 02_展览活动 下的大文件（docx/zip/psd）
- 不扫描 03_内容传播 下的图片视频
- 不扫描 04/05/06/07/90 的非 .md 文件
