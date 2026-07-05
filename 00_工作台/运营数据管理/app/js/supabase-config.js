// supabase-config.js — API 连接配置（指向自有后端，不再使用 Supabase）
const SUPABASE_CONFIG = {
  url: 'http://122.51.56.50',
  anonKey: 'aiwei_anon_key_public_2024'
};

// 表名映射（保持和 store.js 兼容）
const TABLE_NAMES = {
  revenue: 'revenue',
  expense: 'expense',
  space: 'space_usage',
  gallery: 'gallery_sales',
  users: 'users',
  operationLogs: 'operation_logs',
  projectRegistry: 'project_registry',
  inventory: 'inventory',
  artworks: 'artworks',
  partners: 'partners',
  contentPosts: 'content_posts',
  creativeProducts: 'creative_products'
};

const CONFIG_TABLE = 'app_config';
