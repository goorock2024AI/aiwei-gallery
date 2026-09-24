# OPS-DAILY-20260924 财务日结核对优化验证记录

## 结论

`2.0.0-rc.6` 已发布生产，状态为“已发布待观察”。财务只读账号的权限扩大仅限读取柜台现金流水和导出日结，没有新增写入、复核、删除或现金操作权限。

## 冻结口径

- 存现金金额：当日 `cash_movements.type = cash_deposit` 的负数流水取反后汇总。
- 柜台现金期末：期初 + 当日全部柜台现金流水。
- 存现金属于柜台现金到指定账户的资金转移，不新增收入。
- 月度导出按所选日期所在月份生成，一行一天，保留未结存日期用于发现日结缺口。
- viewer 仍只能读取服务端允许的日结记录；既有“只显示已复核日结”的服务端规则未放宽。

## 验证结果

| 场景 | 期望 | 实际 |
|---|---|---|
| 日结月台账 | 直接看到每日存现金 | 通过，样本显示 80.00 元 |
| 查看当日明细 | 弹窗显示，不占页面底部 | 通过 |
| 财务只读导出 | 可导出 `.xlsx`，不可写 | 通过 |
| 现金等式 | 期初 50 + 收款 100 - 存现 80 = 期末 70 | 通过 |
| 手机弹窗 | 390px 不横向越界 | 通过 |
| 静态镜像 | `app/` 与项目 `dist/` 一致 | 通过 |
| 服务端权限回归 | 真实 HTTP 验证 viewer 只读 | 通过，M6 共 104 项 HTTP 检查 |

## 命令摘要

- `node --check app/js/ui.js`
- `node --check app/js/auth.js`
- `node --check server.js`
- `npm run check:daily-closing-finance-browser`
- `npm run check:m6-core`
- `npm run check:dist-sync`
- `node scripts/check-v2-workspace.js`
- `git diff --check`

`npm run check:m6-release` 在工作区有本次未提交改动时按设计拒绝；正式发布前应在提交后重跑。专用本地 PostgreSQL 已在权限回归前启动，并在验证后停止。

## 回滚

恢复本次修改的 `server.js`、`app/js/auth.js`、`app/js/ui.js`、`app/css/style.css`、`app/index.html` 及对应静态镜像即可。无数据库迁移，无经营数据回滚。

## 生产证据

- 功能提交：`c47c4f78e406ebcb8750fcf65dc62b1214e88574`，已同步 GitHub `codex/operations-v2`。
- 数据库备份：`/opt/aiwei/backups/postgres/aiwei-postgres-20260924-115553.dump`，405,039 bytes；双 SHA 与恢复列表检查通过。
- 代码回滚：`/opt/aiwei/backups/daily-closing-finance-20260924-1156`。
- 本地与生产七个发布文件 SHA-256 一致；生产版本 `2.0.0-rc.6`，API、数据库和 Nginx 容器正常，API healthy。
- HTTPS 首页、CSS、app.js、auth.js、ui.js 和 `/healthz` 返回 200；未登录经营接口返回 401，API 错误日志为空。
- 生产 viewer 冒烟：柜台现金未登录 401、viewer GET 200、viewer POST 403、日结已复核过滤通过；临时账号清理后为 0。
- 发布前后基线在排除 `capturedAt` 后完全一致；核心记录数、金额、结构指纹、最新事实日期和灰度均未变化。

## rc.7 历史月份导出修正（已发布待观察）

财务复验指出，`rc.6` 的月度导出仍隐式跟随“日结日期”，不符合历史数据导出的操作习惯。`rc.7` 候选版将查看条件与导出条件拆开：页面增加独立的“历史导出月份”，允许直接选择任一过去月份；“日结日期”只控制页面查看，不再决定导出月份。

专项浏览器回归保持页面查看 `2026-09-24`，再选择 `2026-08` 导出，验证结果如下：

- 查询区间为 `2026-08-01` 至 `2026-08-31`；
- 文件名为 `艾维美术馆_2026-08_日结报表.xlsx`；
- Excel 包含 8 月样本，不包含仍在页面查看的 9 月样本；
- 8 月现金等式为期初 20 + 收款 200 - 存现 150 = 期末 70；
- viewer 权限边界、弹窗明细和 390px 移动端布局继续通过；
- `app/`、项目 `dist/` 与根目录 `dist/` 已同步。

本修正无数据库迁移、无经营数据写入、无新增权限。`2.0.0-rc.7` 已于 2026-09-24 发布生产：数据库备份为 `/opt/aiwei/backups/postgres/aiwei-postgres-20260924-122038.dump`（405,502 bytes，恢复清单校验通过），静态代码回滚点为 `/opt/aiwei/backups/daily-closing-history-export-20260924-1221`。四个发布文件本地与线上 SHA-256 一致；HTTPS 首页、`app.js`、`ui.js` 和健康检查均为 200，未登录收入接口为 401，容器健康且 API 日志无启动错误。发布前后业务基线完全一致，灰度保持 `staff`，未关闭 P0/P1 为 0。
