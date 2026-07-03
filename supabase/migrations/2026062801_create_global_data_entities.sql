-- 全域数据管理架构：用户体系 + 业务实体
-- 创建 7 张新表

-- ============================================================
-- 1. 用户体系
-- ============================================================

-- 1.1 用户账户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  password_hash TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 操作审计日志
CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT '',
  action TEXT NOT NULL,         -- 'create', 'update', 'delete'
  table_name TEXT NOT NULL,
  record_id TEXT DEFAULT '',
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_table ON operation_logs(table_name);

-- ============================================================
-- 2. 业务实体
-- ============================================================

-- 2.1 项目注册表（中枢表，索引所有业务项目）
CREATE TABLE IF NOT EXISTS project_registry (
  id TEXT PRIMARY KEY,               -- 自动生成：exh-202609-yunnan
  name TEXT NOT NULL,                 -- 项目名称：云南重彩画展
  category TEXT NOT NULL,             -- exhibition / partnership / renovation / event / content / other
  status TEXT DEFAULT 'draft',       -- draft / active / paused / completed / cancelled
  start_date TEXT DEFAULT '',         -- 2026-09-01
  end_date TEXT DEFAULT '',
  deadline TEXT DEFAULT '',           -- 关键里程碑日期
  lead TEXT DEFAULT '',               -- 负责人
  ops_project_name TEXT DEFAULT '',   -- 与 revenue.project_name 等关联
  registry_file TEXT DEFAULT '',      -- 对应 registry/*.md 路径
  budget NUMERIC(12,2) DEFAULT 0,
  actual_spend NUMERIC(12,2) DEFAULT 0,
  revenue_generated NUMERIC(12,2) DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_registry_status ON project_registry(status);
CREATE INDEX IF NOT EXISTS idx_project_registry_category ON project_registry(category);

-- 2.2 产品/材料库存表
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '文创',  -- 文创 / 工坊材料 / 耗材
  quantity NUMERIC(12,2) DEFAULT 0,
  unit TEXT DEFAULT '个',                 -- 个 / 套 / 份 / kg
  unit_cost NUMERIC(10,2) DEFAULT 0,
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);

-- 2.3 展品目录表
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,                 -- 作品名称
  artist TEXT DEFAULT '',               -- 艺术家
  medium TEXT DEFAULT '',               -- 媒介（油画/水墨/雕塑/装置）
  size TEXT DEFAULT '',                 -- 尺寸
  year TEXT DEFAULT '',                 -- 创作年份
  value NUMERIC(12,2) DEFAULT 0,       -- 估价/定价
  location TEXT DEFAULT '',             -- 存放位置
  exhibition_id TEXT DEFAULT '',        -- 关联 project_registry.id
  image_url TEXT DEFAULT '',
  status TEXT DEFAULT '馆藏',           -- 馆藏 / 在展 / 代售 / 已售 / 借展
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artworks_exhibition ON artworks(exhibition_id);
CREATE INDEX IF NOT EXISTS idx_artworks_artist ON artworks(artist);

-- 2.4 合作伙伴表
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '其他',      -- 赞助商 / 合作方 / 艺术家 / 供应商 / 媒体
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  wechat TEXT DEFAULT '',
  status TEXT DEFAULT 'active',           -- active / inactive / lead
  tags TEXT[] DEFAULT '{}',
  cooperation_history JSONB DEFAULT '[]', -- [{project_id, date, note}]
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_type ON partners(type);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);

-- 2.5 内容发布记录表
CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,               -- 公众号 / 视频号 / 小红书 / 抖音 / 其他
  type TEXT DEFAULT '文章',              -- 文章 / 视频 / 图文 / 海报
  publish_date TEXT DEFAULT '',
  url TEXT DEFAULT '',
  stats JSONB DEFAULT '{}',             -- {reads, likes, shares, comments}
  project_tags TEXT[] DEFAULT '{}',      -- 关联项目名称列表
  author TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_posts_platform ON content_posts(platform);
CREATE INDEX IF NOT EXISTS idx_content_posts_date ON content_posts(publish_date);
