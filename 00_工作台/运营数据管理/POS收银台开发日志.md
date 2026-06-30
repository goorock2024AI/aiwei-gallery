## 2026-06-30 第五期：用户登录系统 + 数据导出优化

### 背景

PRD 中 P1 需求的账号登录系统和操作日志，本次先实现用户登录系统（操作日志待后续实现）。同时根据测试反馈对数据管理页做了多项体验优化。

### 工作内容

#### 1. 用户登录系统

| 模块 | 文件 | 说明 |
|------|------|------|
| 认证模块 | `app/js/auth.js` | 新增文件，实现 login/logout/changePassword/addUser/listUsers/toggleUser/resetPassword |
| 密码方案 | （内置） | 浏览器原生 `crypto.subtle.digest('SHA-256')`，无外部依赖 |
| 登录态 | sessionStorage | 存储 `{id, username, displayName, role, needPasswordChange}` |

**登录流程：**
- 首次访问 → 显示登录页（默认覆盖主界面，不闪烁）
- 输入正确账号密码 → 检查首次登录标记 → 强制改密弹窗（`__need_change__:` 前缀标记）
- 改密后进入主界面，侧边栏底部显示当前用户名
- 刷新页面 → sessionStorage 保持登录态

**用户体系：**
- 内置管理员账号：`admin` / `admin888888`（首次登录强制改密）
- 无用户注册功能，管理员在「用户管理」页创建普通账号
- 普通账号默认密码 `88888888`，首次登录强制改密
- 管理员菜单控制：仅 admin 角色可见「数据管理」「产品管理」「用户管理」

#### 数据管理页调整

- **移除「导入数据」入口**（基础数据已录入完毕，保留导入代码）
- 导出功能增加**时间维度筛选**：本周（自然周）、本月（自然月）、本年（1月1日~今天）、全部、自定义日期范围
- 移除「本季度」预设和「清除所有数据」按钮
- 收银台顶部新增**当日销售统计**：门票张数 + 实收金额

#### 数据库迁移

| 迁移文件 | 说明 |
|----------|------|
| `2026063001_seed_admin_user.sql` | 插入管理员默认账号（SHA-256 哈希） |
| `2026063002_users_rls_policies.sql` | users 表 SELECT RLS 策略 |
| `2026063003_fix_users_rls.sql` | users 表 UPDATE RLS 策略（改密操作） |
| `2026063004_users_last_login.sql` | users 表增加 `last_login_at` 字段 |
| `2026063005_users_insert_rls.sql` | users 表 INSERT RLS 策略（管理员创建用户） |

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/js/auth.js` | **新增** 认证模块 |
| `app/js/ui.js` | 用户管理页 + 当日销售统计 + 导出时间筛选 UI + 移除导入/清除入口 |
| `app/js/app.js` | 登录态守卫 + 登录/改密表单处理 + admin 菜单控制 |
| `app/js/import-export.js` | 导出增加 `_filterByDateRange` 时间范围过滤 |
| `app/index.html` | 登录覆盖层 + 改密弹窗 + 退出按钮 + 用户管理 tab + admin菜单标记 |
| `app/css/style.css` | 登录页样式 + 当日统计条 + 退出按钮 + 导航分隔线 |
| `supabase/migrations/202606300*_*.sql` | 5 个迁移文件 |

### 数据库状态

| 表 | 记录数 | 说明 |
|----|-------:|------|
| revenue | 131 | 不变 |
| expense | 0 | 待录入 |
| space_usage | 0 | 待录入 |
| gallery_sales | 0 | 待录入 |
| app_config | 4 | 动态产品配置 |
| users | 1+ | admin + 新建普通账号 |

### 待办 / 后续计划

- [ ] 细粒度操作日志审计（PRD 3.8）
- [ ] 历史数据对比分析（同比/环比）
- [ ] 多用户权限体系细化
- [ ] 收银交易记录支持打印小票
- [ ] 日结/交班报表
