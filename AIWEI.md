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
- 财务数据从**腾讯云自建 API** 实时获取（不再使用 Supabase）
- API 地址：`http://122.51.56.50/rest/v1/{table}`
- 旧 Supabase 实例（`pyzitexdzfrbexwgoqpz.supabase.co`）已停止使用
- 项目状态以 registry/*.md 为准
- 更新项目状态时同时更新 registry 文件和 Supabase project_registry 表
- 所有业务的"项目名称"在录入时保持与 registry 中 ops_project_name 一致

## 任务执行规范

所有任务必须按「六步流程」执行：分析→设计→执行→验证→复盘→继续发现。详细规范见 [CLAUDE.md](CLAUDE.md)「问题处理六步流程」章节。

**特别强调：第 5 步复盘和第 6 步继续发现是六步流程的核心价值所在，不可省略。**

## 避免的操作
- 不扫描 02_展览活动 下的大文件（docx/zip/psd）
- 不扫描 03_内容传播 下的图片视频
- 不扫描 04/05/06/07/90 的非 .md 文件
