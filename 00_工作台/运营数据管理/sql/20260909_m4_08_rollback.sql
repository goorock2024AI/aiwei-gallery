-- M4-08 rollback removes only its read-only candidate view.

BEGIN;

DROP VIEW IF EXISTS space_classification_candidates_v2;

COMMIT;
