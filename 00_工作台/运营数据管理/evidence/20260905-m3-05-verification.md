# M3-05 支出与成本归属验证记录

- 日期：2026-09-05；版本：2.0.0-dev.m3-05.1；状态：本地验证通过。
- 工作区：C:/Users/goorock/.codex/worktrees/ac2e/艾维美术馆；分支：codex/operations-v2。
- 承接 M3-04 提交 dcd7b27，按馆长要求完成后继续 M3-05。本次没有生产迁移、部署或真实经营数据写入。

## 分析与设计

依据开发文档 M3-05 任务卡，让支出具备成本类型、业务层、业务类型、能力轴、项目关联和待归类入口。原 expense.category 独立保留，不使用归属值覆盖类别。

新增 expense-entry.js 原子保存接口；server.js 接入，Dockerfile 纳入新模块。费用、record_business_links 和可信操作人审计在一个事务中保存。使用现有业务字典及规则，不另建重复口径。

保存支持默认建议、手动确认、明确待归类。规则优先级为项目、关联活动、类别、说明，再按 priority/confidence/id 排序；支持 exact/contains/prefix/suffix。手动/已确认链接优先，并保留业务层和能力轴的显式空值。共享费用不自动分摊到某一业务层。

## 验证结果

| 验证 | 结果 |
|---|---|
| 独立 PostgreSQL 17 测试库 + Node API | 127.0.0.1:55435 / aiwei_m3_05_test；API 3105 |
| check-expense-entry-integration.js | 30 项 HTTP 检查及 SQL 断言通过：未登录/viewer 拒绝，editor/admin 成功，非法金额/日期/维度/层级拒绝，项目优先，手动留空，待归类，原类别保留 |
| 真实事务失败 | 测试库临时审计 CHECK 约束让审计插入失败；支出与归属链接均回滚，约束随后移除 |
| 财务口径 | 备用金借入不进运营成本事实；销售 20 元、成本快照 4 元、毛利 16 元；期间支出不进入销售毛利重复扣减 |
| check-expense-entry-migration.js | 回滚、重应用、重复应用通过；逐行 JSON 比较原支出/收入/链接及 M3-04 收入视图定义完全不变 |
| Playwright + headless Edge | 新增默认建议、新增待归类、筛选、编辑项目及归属、原类别不变、再次打开保留选择、手机实际保存、保存失败保留表单全部通过；页面异常 0 |
| 页面检查 | 1440×1100、390×844；手机表格横向滚动，编辑弹窗内部滚动可到保存按钮 |
| 静态及兼容回归 | server/expense-entry/ui/app 语法、工作区检查、dist 同步、POS 选择器、销售快照、收入比较图检查均通过 |

浏览器专用插件不可用，本次采用已安装 Playwright 驱动 Edge。Node 本地静态根路由既有问题仍使用 /index.html 访问。没有执行 Docker 镜像构建或生产容器冒烟；已检查 Dockerfile 显式复制 expense-entry.js。

## 复现与证据

三个脚本位于 scripts/check-expense-entry-{integration,migration,browser}.js。前两项 npm 命令为 check:expense-entry 与 check:expense-migration。浏览器脚本需已安装 playwright（或 PLAYWRIGHT_MODULE 指向已安装模块）和 Edge。

只允许专用本地测试库。API 脚本校验配置 host=127.0.0.1、port=55435、database=aiwei_m3_05_test，读取不纳入 Git 的 tmp/m3-05-test.json，其中 password 是三个 m305-admin/editor/viewer 本地测试用户的随机口令。运行前须启动此隔离库与端口 3105 的 API，并设置相同测试 AUTH_SECRET、测试上传目录及 app 静态目录；不能指向生产。测试会清理 m305- 前缀测试记录并构造审计失败约束，不能与其他测试并发。

测试库由 app/sql/init.sql、现有 1.0 增量及 M3-02 三份迁移、M3-04、M3-05 按顺序初始化。现有隔离库和临时启动信息保留在 tmp/m3-05-pg-20260905 与 tmp/m3-05-test.json；不提交口令、数据库文件或日志。

截图：m3-05-desktop.png、m3-05-edit-mobile.png（仅虚构测试数据）。更完整运行结果及截图保留于 tmp/m3-05-*。

## 回滚与发布边界

部署前必须单独确认备份、生产已有迁移及真实数据对账。顺序：M3-02 → M3-04 → 20260905_m3_05_expense_classification.sql，然后发布匹配的 API 与静态文件；不能仅上传新前端。

若需要回退 M3-05，负责人为运营系统维护者：先停用新录入入口/恢复 M3-04 静态与 API，再执行 20260905_m3_05_rollback.sql。回滚仅恢复旧成本视图、移除匹配函数及本次五条种子规则；保留原流水、已保存链接与 M3-04 收入快照。若上线后人工修改过这五条规则，须先备份规则后选择性回退，不能直接删除修改成果。触发条件为归属错误、保存异常或口径对账不符。

## 复盘与下一步

页面回归补齐编辑弹窗归属控件，并将待归类筛选下合计明确命名；手机表格设置最低宽度避免列被挤成单字。

M3-04 记录的前端 operation-logger.js 缺 Authorization / 通用日志写权限问题仍在其他旧流程中；本次新增/编辑支出绕开该路径，使用事务内服务端审计，并未宣称全局审计已修复。旧通用 API/导入流程仍有各自的保存路径，未在此任务全面改造。

下一任务是 M3-06 工坊与体验活动流程；M3-05 本地验证完成不代表生产上线或真实业务验收。
