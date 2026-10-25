-- M4-03 rollback: remove the read-only historical alias candidate view.
-- Product aliases, products and historical revenue facts are preserved.

BEGIN;
DROP VIEW IF EXISTS product_alias_candidates_v2;
COMMIT;
