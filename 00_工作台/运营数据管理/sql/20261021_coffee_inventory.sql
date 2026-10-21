BEGIN;
CREATE TABLE IF NOT EXISTS coffee_inventory_state (
  id TEXT PRIMARY KEY CHECK (id = 'coffee'),
  version INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO coffee_inventory_state(id) VALUES ('coffee') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS coffee_inventory_events (
  request_id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  state_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE coffee_inventory_events IS '咖啡库存专用API事务审计；不开放通用REST写入，不删除历史';
COMMIT;
