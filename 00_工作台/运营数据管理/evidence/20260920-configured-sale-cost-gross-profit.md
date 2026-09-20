# OPS-FIN-20260920 配置商品成本与毛利口径修复

## 受理范围

- 业务目标：门票、套票、咖啡和工坊的新成交记录按成交时成本计算销售成本与毛利。
- 范围：POS 成本快照、销售成本事实、单笔利润、四层月度汇总、零成本治理提示。
- 不做事项：不读取或修改生产经营数据；不使用当前配置倒推历史流水；不改变期间支出和工坊项目直接支出的既有归属。
- 事实源：产品配置 `app_config`、成交明细 JSONB、`business_cost_facts_v2`、`business_profit_facts_v2`、`business_layer_summary_v2`。
- 验收标准：四类商品均形成销售成本事实；毛利等于净收入减销售成本；历史无快照记录不回填；零成本进入治理清单；迁移可重复执行和回滚。
- 红线：生产迁移和部署需单独授权及发布前备份。

## 修复内容

- 门票、套票、咖啡和工坊成交明细新增 `costPriceSnapshot`、`snapshotVersion`、`snapshotAt`。
- 编辑已有流水时保留原成本快照；没有历史成本证据的旧明细按 0 保持未知，不采用当前配置成本。
- 新增 `configured_sale_cost_facts_v2`，把四类配置商品快照转换为 `sold_cogs`。
- 保留原成本事实为内部基础视图，规范入口 `business_cost_facts_v2` 合并原事实与配置商品销售成本。
- 单笔利润、月度毛利和治理问题视图重新绑定规范成本入口。
- 新增正向和回滚迁移，并纳入完整迁移清单。

## 本地验证

- `npm run check:configured-sales-cost`：通过；覆盖四类快照、编辑保留和历史不回填。
- `npm run check:configured-sales-cost-integration`：通过；成本事实、单笔利润、月度毛利、零成本 P1、幂等和回滚均通过。
- `npm run check:pos-ticket-quantity-browser`：通过；浏览器覆盖新成交快照与历史编辑保护。
- `npm run check:product-config-cost-browser`：通过。
- `npm run check:workshop-projects`、`npm run check:retail-snapshot`、`npm run check:dist-sync`：通过。
- `npm run check:m6-migrations`：通过；21 个正向文件、17 个回滚文件，两轮正向、逐文件幂等、完整回滚和重放均成功，旧事实不变。
- `node --check`：应用和两套发布镜像的 `models.js`、`ui.js` 均通过。
- `git diff --check`：通过。
- 标准 `npm run check:m6-release` 按预期被“工作区必须干净”门禁拦截；随后用 `--allow-dirty` 完成非发布预检，21/17 迁移清单、校验和与静态镜像均通过。当前改动尚未提交，未进入生产发布。

## 回滚

1. 前端回退 `index.html`、`models.js`、`ui.js` 至发布前版本。
2. 数据库执行 `sql/20260920_configured_sale_cost_snapshots_rollback.sql`。
3. 回滚只移除新增成本解释层，不删除或改写收入、支出及历史经营流水。

## 状态与风险

- 状态：本地验证通过，待授权发布。
- 生产状态：未迁移、未部署、未写入生产数据。
- 口径风险：工坊单位成本属于销售成本；既有同项目支出仍属于期间成本并影响经营贡献。若同一笔材料采购同时计入两者，需要后续由财务确认是否属于重复归集。
