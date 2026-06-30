// supabase-config.js — Supabase 连接配置
const SUPABASE_CONFIG = {
  url: 'https://pyzitexdzfrbexwgoqpz.supabase.co',
  anonKey: 'sb_publishable_wLj18C-NsgFqmjbk8QiAMg_bTuZCBOP'
};

// 表名映射
const TABLE_NAMES = {
  revenue: 'revenue',
  expense: 'expense',
  space: 'space_usage',
  gallery: 'gallery_sales',
  // 全域数据实体（2026-06-28）
  users: 'users',
  operationLogs: 'operation_logs',
  projectRegistry: 'project_registry',
  inventory: 'inventory',
  artworks: 'artworks',
  partners: 'partners',
  contentPosts: 'content_posts'
};

// app_config 表名（固定）
const CONFIG_TABLE = 'app_config';
