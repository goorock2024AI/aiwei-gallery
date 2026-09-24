# OPS-DAILY-20260924 财务日结核对优化验证记录

## 结论

发布候选版本为 `2.0.0-rc.6`。本地功能验证通过，用户已明确授权生产发布；财务只读账号的权限扩大仅限读取柜台现金流水和导出日结，没有新增写入、复核、删除或现金操作权限。

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
