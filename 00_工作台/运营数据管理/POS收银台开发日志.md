# 收银台项目开发日志

> 项目：美术馆运营数据管理系统 — 收银台模块（POS）
> 时间段：2026-06-24

---

## 2026-06-24 第一期：POS 收银机模式

### 背景

原有收入录入页是表单式，需要手动填写多个字段、计算金额、选择日期等，前台收银场景中操作繁琐、效率低。改造为 POS 收银模式，前台人员通过大按钮快速录入、选择支付方式、一键保存。

### 功能需求

| # | 板块 | 录入方式 | 说明 |
|---|---|---|---|
| 1 | **门票** | 加减按钮 | 普通票 ¥10、套票 ¥25（含门票+咖啡） |
| 2 | **咖啡** | 加减按钮，¥15/杯 | 独立模块，未来可增加 SKU |
| 3 | **工坊** | 下拉选项目 → 数量 → 折扣 → 添加 | 一单可添加多项 |
| 4 | **文创零售** | 填单价 → 数量 → 产品名 → 添加 | 一单可添加多项 |
| 5 | **画廊** | 独立标签页（后续细化） | 低频 |
| 6 | **场地租金** | 独立标签页（后续细化） | 低频 |

### 工作内容

1. **数据库迁移**（第1轮）
   - revenue 表新增 `payment_method`、`combo_qty/combo_amount`、`retail_items`、`retail_amount` 列
   - 工坊 items 支持 `discount` 折扣字段

2. **数据模型修改**（models.js）
   - 新增 COMBO_PRICE=25、COFFEE_PRICE=15 常量
   - createRevenue() 新增 combo、retail、paymentMethod 字段
   - calcWorkshopTotal 支持折扣计算
   - 验证规则增加 combo/retail 空值判断

3. **POS 界面开发**（ui.js）
   - 重写 renderRevenuePage() 为 POS 收银布局
   - 新增函数：_adjustTicket、_selectPayment、_addWorkshopItem、_addRetailItem、_updatePOS、_confirmPOSPayment、_resetPOS、_fillPOSEdit
   - 底部固定结算栏（收款方式 + 汇总 + 确认收款）
   - 编辑模式兼容

4. **POS 样式**（style.css）
   - 商品按钮、工坊/文创添加区、收款方式按钮组、确认按钮等样式

5. **BUG 修复**
   - 快速点击确认收款 → 加锁 `_submittingPayment` 防重复提交
   - 默认收款方式改为「扫码支付」
   - 确认收款→cashAmount/accountAmount 兼容逻辑修正

6. **UI 布局改造**
   - 顶部导航栏 → 左侧 200px 固定侧边栏
   - POS 页底部结算栏固定（sticky bottom）
   - 响应式：侧边栏折叠为窄条

### 涉及文件

| 文件 | 改动 |
|---|---|
| `supabase/migrations/20260624081037_*.sql` | 新增 payment_method、retail_items、combo_qty/combo_amount |
| `supabase/migrations/20260624081933_*.sql` | 新增 retail_amount |
| `app/js/models.js` | POS 数据模型 |
| `app/js/ui.js` | POS 界面（约 500 行新代码） |
| `app/css/style.css` | POS 样式 + 侧边栏 + 固定底部 |
| `app/index.html` | 侧边栏布局 |
| `app/js/app.js` | tab 路由、启动加载 |

---

## 2026-06-24 第二期：产品/资产管理页

### 背景

门票价格、工坊产品、经营空间全部硬编码在 models.js 中，价格调整需改代码。新增产品管理页，将配置存入 Supabase，实现动态管理。

### 功能需求

| 类别 | 管理内容 | 说明 |
|---|---|---|
| 票务产品 | 名称 + 单价，支持增删改 | POS 票务按钮自动生成 |
| 咖啡饮品 | 名称 + 单价，支持增删改 | POS 咖啡按钮自动生成 |
| 工坊产品 | 名称 + 单价，支持增删改 | POS 工坊下拉列表 |
| 经营空间 | 名称 + 日价 + 半天价 + 说明 | 空间使用登记下拉 |

### 工作内容

1. **数据库迁移**（第2轮）
   - 新建 `app_config` 表（key-value，JSONB value）
   - 新建 `ticket_items`、`coffee_items` JSONB 列（revenue 表，存储动态票种项）
   - 配置 RLS policy 允许匿名读写

2. **数据层**（store.js）
   - 新增 `loadAppConfig()` — 启动时从数据库加载配置到 MODELS
   - 新增 `saveConfig(key, value)` — upsert 单条配置
   - 启动流程（app.js）增加 `loadAppConfig()`

3. **产品管理页**（ui.js）
   - 新增 `renderProductPage()` — 4 张卡片渲染
   - 新增 `_addConfigItem()`、`_editConfigItem()`、`_deleteConfigItem()` — CRUD 操作
   - 保存时 upsert 到 Supabase 并更新 MODELS 内存对象

4. **POS 收银适配**
   - 票务/咖啡区改为从 `MODELS.ticketProducts` / `MODELS.coffeeProducts` 动态渲染
   - `_confirmPOSPayment` 金额计算改为遍历动态列表
   - `_resetPOS` 清空逻辑适配动态 ID

5. **种子数据**
   - app_config 表 seed 插入默认值
   - ticket_products: 普通票¥10、套票¥25
   - coffee_products: 手冲咖啡¥15
   - workshop_products: 7 项工坊产品
   - spaces: 7 个空间

### 涉及文件

| 文件 | 改动 |
|---|---|
| `supabase/migrations/20260624091907_*.sql` | 新建 app_config 表 + seed 数据 |
| `supabase/migrations/20260624092059_*.sql` | 新增 ticket_items/coffee_items 列 |
| `supabase/migrations/20260624092652_*.sql` | app_config RLS policy |
| `app/js/supabase-config.js` | 新增 CONFIG_TABLE 常量 |
| `app/js/store.js` | 新增 loadAppConfig / saveConfig |
| `app/js/models.js` | 新增动态配置字段 |
| `app/js/ui.js` | 新增 renderProductPage + POS 动态渲染适配 |
| `app/js/app.js` | 启动加载配置 + products 路由 |
| `app/index.html` | 新增「产品管理」Tab |

---

## 待办 / 后续计划

- [ ] 收银交易记录支持打印小票
- [ ] 多用户登录（经手人自动识别）
- [ ] 画廊销售独立录入页
- [ ] 场地租金独立录入页
- [ ] 日结/交班报表
- [ ] POS 键盘快捷键支持
