-- Stops future accounting; retains movements and current stock. Never restore a live database blindly.
BEGIN;
DROP TRIGGER IF EXISTS revenue_retail_stock ON revenue;
DROP FUNCTION IF EXISTS apply_retail_stock();
COMMIT;
