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

## 2026-06-27 第三期：P0 迭代补全与统计修正

### 背景

P0 迭代 1（画廊销售）和迭代 2（场地租金并入空间使用）已完成代码层面的开发，但存在以下问题：场地租金虽已录入空间使用表，但 Dashboard、报表统计完全未纳入；画廊销售的外围功能（CSV 导出、JSON 备份、数据统计）也未覆盖。本次集中修复。

### 工作内容

#### 1. 场地租金纳入统计（核心修正）

| 位置 | 改动前 | 改动后 |
|------|--------|--------|
| Dashboard 首页 `ui.js` | `totalRevenue` 仅从 revenue 表计算 | 加载 `space` 数据，将付费租金的 `receivedAmount` 计入总收入 |
| 报表数据总览 `charts.js _renderOverview` | 场地收入仅算 `venueAmount` | 按筛选月份加载空间数据，付费租金累加到场地行 |
| 月度收入趋势图 `charts.js renderRevenueTrend` | 场地柱仅含 `venueAmount` | 按月过滤付费空间租金累加到 `venueData` |
| 收入结构饼图 `charts.js renderRevenueStructure` | 场地占比仅含 `venueAmount` | 付费空间租金累加到场地金额 |

#### 2. 统计口径调整（应收 → 已收）

运营方要求收入按实际到账统计，故全部 4 处统计将 `receivableAmount`（应收）改为 `receivedAmount`（已收）：
- `ui.js:71` — Dashboard 总收入
- `charts.js:54` — 报表数据总览
- `charts.js:194` — 收入趋势图
- `charts.js:260` — 收入结构饼图

#### 3. 收银台顶部待收款提醒

在收银台日期栏右侧新增红色醒目提示（`ui.js._loadSpaceRentReminder`）：
- 遍历空间使用数据，找出 `付费` 且 `应收 > 已收` 的未到账记录
- 汇总待收总额，显示未付笔数
- 点击链接直接跳转到空间使用标签页
- 无未收款时自动隐藏

新增 CSS 样式（`style.css`）`.space-rent-reminder` 红色加粗+可点击链接。

#### 4. 画廊销售外围功能补全

画廊录入页（表单+列表+CRUD+图表）此前已实现，但以下外围缺口已补全：

| 功能 | 文件 | 改动 |
|------|------|------|
| CSV 导出画廊 | `import-export.js` | 新增画廊表头+行映射 |
| JSON 备份含画廊 | `import-export.js` | 导出/导入均含 `gallery` 表 |
| CSV 导入画廊 | `import-export.js` | 识别含"画廊"文件名，解析画廊 CSV |
| 数据管理页统计 | `ui.js` | 数据概览增加画廊条数 |
| 危险操作清空画廊 | `ui.js` | 清除数据包含 `gallery_sales` 表 |
| 月份筛选持久化 | `ui.js` | 新增 `_galleryFilterMonth` |
| 导出按钮 | `ui.js` | 数据管理页新增画廊导出按钮 |

#### 5. 杂项修复

- 补全 `_editingGalleryId` 状态声明（遗漏初始化导致编辑模式异常）
- 补全 `_spaceFilterMonth` 状态声明

### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/ui.js` | 场地租金纳入 Dashboard 统计 + 收银台待收款提醒 + 画廊外围功能补全 + 状态初始化 |
| `app/js/charts.js` | 场地租金纳入报表总览/趋势图/结构饼图 + 口径改为已收 |
| `app/js/import-export.js` | 画廊 CSV 导出/导入 + JSON 备份/恢复 |
| `app/css/style.css` | 新增待收款提醒样式 |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 128 | 2026年1-6月历史收入数据 |
| expense | 34 | 历史支出数据 |
| space_usage | 7 | 历史空间使用记录 |
| gallery_sales | 0 | 画廊销售（空表，待录入） |
| app_config | 4 | 动态产品配置 |

---

## 2026-06-28 第四期：数据保存 Bug 修复 + 项目正式上线

### 背景

线上测试发现 POS 收银录入数据后不保存，虽显示"收款成功"但刷新后数据消失。经排查为前端代码缺陷，同时项目准备正式上线，完成了 GitHub 仓库创建和 Cloudflare Pages 部署配置。

### 工作内容

#### 1. 数据不保存问题诊断与修复

| 问题 | 根因 | 修复 |
|------|------|------|
| store.js 重复定义 | `_ensureClient()` 定义了两次，第一次定义后夹带的 `_toSnake`/`_toCamel` 等转换方法被第二次定义覆盖 | 清理重复定义，恢复转换函数 |
| 错误被静默吞掉 | `Store.add/update/delete` 失败时 `return null` 不抛异常，UI 的 try/catch 捕获不到 | 改为 `throw new Error(error.message)`，让错误正确冒泡 |
| POS 字段丢失 | `createRevenue` 没有保留 `ticketItems`、`coffeeItems`、`paymentMethod` 等 POS 新增字段 | 增加字段保留逻辑，并从明细项推导数量和金额 |
| `init.sql` 落后 | 缺少 `combo_qty/amount`、`ticket_items`、`coffee_items`、`retail_items`、`payment_method`、`gallery_sales` 表、`app_config` 种子数据等 | 重写 `init.sql` 覆盖全部字段和表 |

#### 2. 数据报表页功能增强

- 报表页新增**月份选择器**，支持按特定月份筛选查看
- 报表结构图改为始终显示当前筛选范围的收入结构（不再仅限当月）
- 场地租金（空间付费收入）纳入 Dashboard 首页统计
- 统计口径统一：全部场所收入改为**已收金额**（receivedAmount）而非应收

#### 3. 收银台功能完善

- 收银台顶部新增**场地租金待收款提醒**（红色醒目提示可点击跳转到空间使用页）
- 无待收款时自动隐藏

#### 4. 画廊销售外围功能补全

- CSV 导出支持画廊销售数据
- JSON 备份与恢复支持画廊表
- 数据管理页统计、危险操作清空均包含画廊数据
- 月份筛选状态持久化

#### 5. 项目上线

- 创建 GitHub 仓库 `goorock2024AI/aiwei-gallery`
- 本地分支 `master` 重命名为 `main` 并推送
- 新增 `dist/` 部署目录（Cloudflare Pages 使用的英文路径，避免中文路径问题）
- 编写上线部署方案文档
- 添加 `.claude/` 目录到 `.gitignore`

### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/store.js` | 去重复定义 + add/update/delete 改为 throw |
| `app/js/models.js` | createRevenue 保留 POS 字段 |
| `app/js/ui.js` | 场地租金纳入统计 + 收银台待收款提醒 + 画廊外围功能 |
| `app/js/charts.js` | 报表月份筛选 + 场地租金纳入趋势/结构图 |
| `app/js/import-export.js` | 画廊 CSV 导出/JSON 备份/导入 |
| `app/sql/init.sql` | 补充全部字段、表、种子数据 |
| `app/index.html` | 脚本加 `?v=2` 缓存打破 |
| `scripts/deploy.sh` | 部署辅助脚本 |
| `.gitignore` | `.claude/` 目录全局忽略 |
| `POS收银台开发日志.md` | 本期日志 |
| `艾维美术馆运营数据管理系统-部署方案.md` | 新增部署方案文档 |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 131 | 2026年1-6月历史收入数据 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 画廊销售（空表，待录入） |
| app_config | 4 | 动态产品配置 |

### 待办 / 后续计划

- [ ] P0 迭代 4：账号登录系统（自建 users 表）
- [ ] P0 迭代 5：细粒度操作日志审计
- [ ] P0 迭代 6：历史数据对比分析（同比/环比）
- [ ] 收银交易记录支持打印小票
- [ ] 多用户登录（经手人自动识别）
- [ ] 日结/交班报表
- [ ] POS 键盘快捷键支持

---

## 2026-06-28 MVP v1.0 里程碑

### 状态

至此完成艾维美术馆运营数据管理系统 MVP 版本的开发与上线。

### 已实现功能

| 模块 | 功能 |
|------|------|
| 收银台（POS） | 票务/咖啡加减按钮 + 工坊/文创添加 + 收款方式 + 一键确认收款 |
| 支出录入 | 备用金支出/借入 + CRUD + 发票/凭证管理 |
| 画廊销售 | 作品/艺术家/成交价/佣金 + CRUD |
| 空间使用 | 卡片看板 + 租期 + 租金管理 + 时间冲突检查 |
| 数据报表 | 月度收入趋势 + 收入结构 + 工坊排行 + 支出汇总 + 空间统计 |
| 数据管理 | CSV 导出/导入、JSON 备份恢复、数据概览 |
| 产品管理 | 票务/咖啡/工坊/空间动态配置（增删改） |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 131 | 2026年1-6月历史收入数据 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 画廊销售（空表，待录入） |
| app_config | 4 | 动态产品配置 |

### 基础设施

- 数据库：Supabase（已上线运行）
- 前端托管：Cloudflare Pages（https://aiwei-gallery.pages.dev）
- 源码管理：GitHub（goorock2024AI/aiwei-gallery）
- 自动部署：git push → Cloudflare 自动部署

### 下一步计划

**第一阶段：测试验收**
- [ ] 全功能回归测试（收银台、支出、画廊、空间、报表、数据管理、产品管理）
- [ ] 边界情况测试（空数据、极值、网络异常）
- [ ] 美术馆实际使用反馈收集
- [ ] Bug 修复与体验优化
- [ ] 历史数据录入（支出、空间使用）

**第二阶段：功能迭代**
- [ ] P0 迭代 4：账号登录系统（自建 users 表）
- [ ] P0 迭代 5：细粒度操作日志审计
- [ ] P0 迭代 6：历史数据对比分析（同比/环比）
- [ ] 收银交易记录支持打印小票
- [ ] 多用户登录（经手人自动识别）
- [ ] 日结/交班报表
- [ ] POS 键盘快捷键支持
