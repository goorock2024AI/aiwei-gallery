// supabase-config.js — API 连接配置（无 Supabase，直连自有后端）
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
  contentPosts: 'content_posts'
};

const CONFIG_TABLE = 'app_config';
