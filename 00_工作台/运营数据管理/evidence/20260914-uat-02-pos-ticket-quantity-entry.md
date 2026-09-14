# UAT-02 收银台门票与套票数量直接录入证据

日期：2026-09-14  
版本：`2.0.0-rc.3`  
功能提交：`5a4da60 feat(pos): allow direct ticket quantity entry`  
生产范围：`staff` 内部灰度

## 目标与结果

实际收银中，门票和套票遇到团体订单时只能反复点击加号。本次在普通票和套票卡片上增加数字输入框，允许直接键入数量，同时保留原有加减按钮。咖啡商品保持原有数量交互。

所有数量变更统一经过 `_setTicketQty()`：空值、负数归为 0，小数截为整数；隐藏值、可见输入、单项小计和收银总额同步更新。编辑既有收入记录时也使用同一入口回填数量，因此卡片小计与总额保持一致。

## 自动验证

- `node --check app/js/ui.js`：通过。
- `npm run check:pos-ticket-quantity-browser`：通过普通票与套票直接录入、加号同步、总额、负数、小数、编辑回填、咖啡隔离和 390px 手机宽度。
- `npm run check:pos-retail-autocomplete-browser`：通过，UAT-01 文创检索无回归。
- `npm run check:retail-snapshot`：通过。
- `npm run check:dist-sync`：通过，应用目录、项目 `dist/` 与仓库根 `dist/` 一致。
- `npm run check:m6-release -- --allow-dirty`：通过，版本 `2.0.0-rc.3`、20 个正向迁移和 16 个回滚文件完整。
- `git diff --check`：通过。

## 生产发布验证

上传前保存旧版静态文件到 `/opt/aiwei/backups/frontend-ticket-quantity-20260914-135116`。上传后五个发布文件 SHA256 与本地一致，重建 API 后容器版本为 `2.0.0-rc.3`，数据库和 API 均 healthy，容器内 `/healthz` 返回 `{"status":"ok"}`。

公网首页返回 200 并包含 `2.0.0-rc.3-20260914` 缓存标记；线上 `ui.js` 包含 `_setTicketQty` 与 `pos-qty-input`，线上 CSS 包含 `.pos-qty-input`。未登录读取收入接口返回 401，API 本轮日志未发现 `SyntaxError`、`ReferenceError`、未捕获异常或 fatal 错误。

生产冒烟共读取 36 个受保护视图，失败 0；`staff` 下 admin/editor 启用，viewer 对 2.0 视图返回 403 且仍可访问 1.0 收入。生产未复验 P0/P1 为 0，灰度仍为 `staff`。

## 自动备份补充复核

权限修复后的首次定时备份已于 2026-09-14 03:17 生成：

- dump：`aiwei-postgres-20260914-031701.dump`，380,866 bytes；
- dump SHA256：`03abe4053f442cbe3280b9ded634d871352888d178105a4e7dc343774d04a025`；
- baseline SHA256：`e2044ddc2a8a2e3d6a5ae87b4fdc2a802edac1ba75e133f317da1ba6adff9b47`；
- manifest：28 张表、数据库 12,760,755 bytes、`pg_dump` custom format；
- 两个 SHA 校验通过；使用 PostgreSQL 17.10 数据库容器执行 `pg_restore --list` 通过。

宿主机旧版 `pg_restore` 无法读取 1.16 文件头，因此对象校验使用与备份一致的 PostgreSQL 17.10 工具完成。

## 变更边界与待确认

本次未修改数据库结构、经营数据、产品数据或权限配置。`staff` 灰度和 G4 决策保持不变。需要收银人员在真实设备刷新页面后，分别对普通票和套票直接输入数量，完成一笔实际订单验证；真实业务验收与馆长确认完成前不宣布正式切换。
