-- M4-07 rollback removes only its read-only candidate views.

BEGIN;

DROP VIEW IF EXISTS workshop_link_candidates_v2;
DROP VIEW IF EXISTS gallery_link_candidates_v2;

COMMIT;
