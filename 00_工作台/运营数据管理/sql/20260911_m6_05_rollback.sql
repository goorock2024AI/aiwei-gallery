BEGIN;

DELETE FROM app_config WHERE key = 'operations_rollout';

COMMIT;
