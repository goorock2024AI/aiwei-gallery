# 2.0 开发工作区入口

更新时间：2026-09-05

继续 2.0 开发请使用 Git 分支 codex/operations-v2。当前对应工作区：

C:/Users/goorock/.codex/worktrees/ac2e/艾维美术馆

应用目录为该工作区下的 00_工作台/运营数据管理/；最新阶段记录为该目录的 2.0美术馆运营管理开发文档.md。当前阶段与下一步以该开发文档为准，入口说明不重复维护进度。

## 开始前

在工作区根目录执行：

~~~powershell
git worktree list
git branch --show-current
git status --short
node 00_工作台/运营数据管理/scripts/check-v2-workspace.js
~~~

若工作区路径发生变化，以 git worktree list 中 codex/operations-v2 的实际路径为准。分支不匹配时先切到已有工作区。

## 目录职责

- D:/工作文档/00_进行中/艾维美术馆：全馆资料入口，保留既有本地工作；此处的 2.0 文档是早期规划副本。
- codex/operations-v2 工作区：2.0 开发、验证与提交的唯一当前入口。代码在 00_工作台/运营数据管理/，不是旧 aiwei-operations 子目录。
- .claude/worktrees/cranky-easley-d733e5：其他历史工作区，保留原状。

## 提交范围

本次快照包含此前未提交的运营系统基础更新、M1/M2 文档、M3 迁移包、M3-04 第一批、检查脚本及发布镜像。快照不是上线版本，也不表示所有历史变更都重新验收。

测试数据库、连接文件、凭据、日志、经营原始数据保留在本地并由忽略规则排除；可持久保存的测试摘要在应用目录 evidence/ 下。全馆经营分析、展览和合作等其他任务文件保留原状，使用 git status 查看，不混入运营系统提交。

继续开发时按明确文件列表暂存，核对 git diff --cached --stat 后提交。生产迁移、真实数据对账和线上切换仍需后续单独完成。
