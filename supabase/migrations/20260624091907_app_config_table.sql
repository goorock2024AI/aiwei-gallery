-- 应用配置表（key-value 存储，用于产品/价格/空间等动态配置）
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 插入默认配置
INSERT INTO app_config (key, value) VALUES
  ('ticket_products', '[{"name":"普通票","price":10},{"name":"套票","price":25}]'::jsonb),
  ('coffee_products', '[{"name":"手冲咖啡","price":15}]'::jsonb),
  ('workshop_products', '[{"name":"果壳风铃","price":128},{"name":"豆荚娃娃","price":118},{"name":"迷你冰箱贴","price":35},{"name":"木刻杯垫","price":88},{"name":"A5木刻","price":168},{"name":"A4木刻","price":198},{"name":"拓印体验","price":38}]'::jsonb),
  ('spaces', '[{"name":"1号厅","dailyPrice":10000,"halfDayPrice":5000,"desc":"大型展览、中大型活动"},{"name":"2号厅","dailyPrice":8000,"halfDayPrice":4000,"desc":"中小型展览、活动"},{"name":"美学空间","dailyPrice":4000,"halfDayPrice":2000,"desc":"沙龙、会议、团建"},{"name":"多功能厅","dailyPrice":8000,"halfDayPrice":4000,"desc":"会议、培训、拍卖"},{"name":"六楼综合空间","dailyPrice":0,"halfDayPrice":0,"desc":"文创、咖啡、工坊"},{"name":"走廊画廊","dailyPrice":0,"halfDayPrice":0,"desc":"展陈/活动"},{"name":"户外露台","dailyPrice":0,"halfDayPrice":0,"desc":"观景、休憩"}]'::jsonb)
ON CONFLICT (key) DO NOTHING;
