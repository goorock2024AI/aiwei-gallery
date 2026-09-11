BEGIN;

INSERT INTO app_config (key, value, updated_at)
VALUES ('operations_rollout', '{"mode":"off"}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

COMMIT;
