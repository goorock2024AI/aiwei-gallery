# M3-04 第二批验证记录

日期：2026-09-05；版本：2.0.0-dev.m3-04.2。

## 结果

核心商品/别名/销售链路本地验证通过。操作日志存在已知 401，完整审计与生产可用性未验收。

## 环境

- 独立 PostgreSQL 17，127.0.0.1:55434，测试库 aiwei_m3_04_test；仅合成测试数据。
- 本地 Node API 与静态页：http://127.0.0.1:3104/index.html。
- Browser plugin not available；使用已安装的 Playwright 与 Edge headless，未安装依赖。
- 桌面 1440×1000；手机 390×844。

## 检查

| 检查 | 结果 |
|---|---|
| 正确页面 / 非空 / 无错误覆盖层 | 通过，运营数据管理及收银台可见 |
| 别名新增、编辑、停用、启用 | 通过，列表及服务端状态对应变化 |
| 按别名选商品与实际收款 | 通过，零售金额 10，快照成本 2/件 |
| 重新打开收入编辑并保存 | 通过，销售明细 JSONB 保持一致 |
| 改商品标准名、规格、分类和成本 | 通过，原快照仍为纯悦饮用水、550ml、饮料、成本 2 |
| 手动改名 | 通过，清除已选商品关联，显示未关联商品 |
| 页面刷新 | 通过，已登录界面正确恢复 |
| 手机弹窗 | 通过，边界在视口内、内部可滚动 |
| 未登录 / viewer / editor / admin API | 通过，按现有权限返回 401/403/200/201/405 |
| 错误输入、不存在的商品、重复别名 | 通过，写入被拒绝 |
| 控制台 | 有条件通过：无 JS 异常；6 个既有 operation_logs 401，产品/别名/销售请求成功 |
| 视图回退、重建、幂等 | 通过，原始收入行指纹一致 |

## 可重复检查

在应用目录执行：

~~~powershell
node --check server.js
node --check app/js/ui.js
node --check app/js/models.js
node --check app/js/app.js
npm run check:retail-snapshot
npm run check:dist-sync
npm run check:creative-pos-picker
npm run check:revenue-comparison-chart
~~~

本次本地运行记录：tmp/m3-04-api-test.js（36 项 HTTP 断言）、tmp/m3-04-browser-test.js、tmp/m3-04-browser-result.json。测试连接信息仅在被忽略的 tmp 内。

## 截图

- [桌面商品别名](../tmp/m3-04-alias-desktop.png)
- [手机商品别名](../tmp/m3-04-alias-mobile.png)
- [POS 分类快照](../tmp/m3-04-pos-snapshot.png)

## 风险与回退

P1：既有操作日志请求缺少认证；editor 的 operation_logs 访问策略也需后续明确。未改变生产权限，不把写入成功等同于审计完成。

生产未迁移、未部署；未使用真实经营数据。SQL 回退重执行 sql/20260903_m3_02_business_fact_views.sql，快照 JSONB 保留；重新启用执行 sql/20260905_m3_04_retail_snapshot.sql。

本轮收尾停止专用 API 与 PostgreSQL，合成数据与原始测试输出保留在被忽略的 tmp 下供复核。
