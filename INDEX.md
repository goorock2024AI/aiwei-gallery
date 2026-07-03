# 艾维美术馆 — 系统索引

更新时间：2026-06-28

## 子仓库

| 仓库 | 路径 | 说明 |
|------|------|------|
| **aiwei-operations** | ./aiwei-operations/ | 运营数据管理系统（Supabase + 前端） |
| **aiwei-planning** | ./aiwei-planning/ | 规划文档 + 项目注册表 |
| **aiwei-content** | ./aiwei-content/ | 自媒体内容排期与发布记录 |

<!--
工作规则：
- 运营系统开发 → 进入 aiwei-operations/
- 展览策划/项目跟踪 → 进入 aiwei-planning/registry/
- 写推文/内容排期 → 进入 aiwei-content/
- 查数据 → 查 Supabase（revenue / expense / space_usage / gallery_sales / project_registry）
- 全馆整体情况 → 读本 INDEX.md + 查全表
-->

## 活跃项目

| 项目 | 状态 | 时间 | 注册文件 |
|------|------|------|---------|
| [云南重彩画展](aiwei-planning/registry/exhibitions/云南重彩画展.md) | active | 2026-09~10 | exhibitions/云南重彩画展.md |
| [公众号内容收集整理测试](aiwei-planning/registry/content/公众号内容收集整理测试.md) | active | 2026-06~ | content/公众号内容收集整理测试.md |

## 其他项目目录（不入仓库）

| 目录 | 内容 | 引用方式 |
|------|------|---------|
| [02_展览活动](./02_展览活动/) | 展览原始文件（docx/xlsx/psd） | 通过 registry 中的关键文档路径引用 |
| [04_空间改造](./04_空间改造/) | 改造方案、设计图 | 通过 registry 引用 |
| [05_合作商业](./05_合作商业/) | 合作方材料、合同 | 通过 registry 引用 |
| [01_运营行政](./01_运营行政/) | 行政 SOP、合规文件 | 按需直接访问 |
| [06_财务报销](./06_财务报销/) | 报销凭证 | 按需直接访问 |
| [07_资料档案](./07_资料档案/) | 建筑图纸、介绍材料 | 按需直接访问 |
| [90_临时待整理](./90_临时待整理/) | 待归档散件 | 按需直接访问 |

## Supabase 数据查询

```sql
-- 查询全部活跃项目
SELECT * FROM project_registry WHERE status IN ('active', 'draft');

-- 查询某项目营收
SELECT r.name, SUM(v.ticket_amount + v.workshop_amount + v.venue_amount) as revenue
FROM project_registry r
LEFT JOIN revenue v ON v.project_name = r.ops_project_name
WHERE r.id = 'exh-202609-yunnan'
GROUP BY r.name;

-- 查询场地使用情况
SELECT * FROM space_usage ORDER BY date DESC;

-- 查询全部实体列表
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```
