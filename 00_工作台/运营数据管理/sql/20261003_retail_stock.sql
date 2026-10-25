-- Prospective stock accounting: existing sales are baselines, never back-deducted.
BEGIN;
-- Freeze sale writes while capturing the historical baseline and enabling the trigger.
LOCK TABLE revenue IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS retail_stock_balances (
 revenue_id TEXT NOT NULL, product_id TEXT NOT NULL,
 baseline_qty INTEGER NOT NULL DEFAULT 0, current_qty INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(revenue_id,product_id)
);
CREATE TABLE IF NOT EXISTS retail_stock_movements (
 id BIGSERIAL PRIMARY KEY, revenue_id TEXT NOT NULL, product_id TEXT NOT NULL,
 quantity_delta INTEGER NOT NULL, stock_before INTEGER NOT NULL, stock_after INTEGER NOT NULL,
 actor_id TEXT, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION retail_stock_quantities(items JSONB)
RETURNS TABLE(product_id TEXT, qty INTEGER) LANGUAGE plpgsql AS $$
DECLARE item JSONB; identity TEXT; amount NUMERIC;
BEGIN
 IF items IS NULL OR items = 'null'::jsonb OR items = '{}'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(items) <> 'array' THEN RAISE EXCEPTION '零售明细必须为数组'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  identity := COALESCE(item->>'productId',item->>'product_id');
  IF identity IS NULL OR identity = '' THEN CONTINUE; END IF;
  IF COALESCE(item->>'isCountableStock',item->>'is_countable_stock','true') = 'false' THEN CONTINUE; END IF;
  amount := COALESCE(item->>'qty',item->>'quantity','0')::NUMERIC;
  IF amount < 0 OR amount <> trunc(amount) OR amount > 2147483647 THEN
   RAISE EXCEPTION '计库存商品销售数量必须为非负整数';
  END IF;
  product_id := identity; qty := amount::INTEGER; RETURN NEXT;
 END LOOP;
END $$;
-- Only on first installation. Replaying this migration must not reset tracked balances.
INSERT INTO retail_stock_balances(revenue_id,product_id,baseline_qty,current_qty)
SELECT r.id,q.product_id,sum(q.qty)::INTEGER,sum(q.qty)::INTEGER
FROM revenue r CROSS JOIN LATERAL retail_stock_quantities(r.retail_items) q
JOIN creative_products p ON p.id=q.product_id AND COALESCE(p.is_countable_stock,true)
GROUP BY r.id,q.product_id ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION apply_retail_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE sale_id TEXT; items JSONB; entry RECORD; target_qty INTEGER; delta INTEGER; previous_stock INTEGER;
BEGIN
 sale_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='UPDATE' AND NEW.id <> OLD.id THEN RAISE EXCEPTION '销售记录编号不可修改'; END IF;
 items := CASE WHEN TG_OP='DELETE' THEN '[]'::jsonb ELSE NEW.retail_items END;
 IF TG_OP <> 'DELETE' AND EXISTS (
  SELECT 1 FROM retail_stock_quantities(items) q LEFT JOIN creative_products p ON p.id=q.product_id WHERE p.id IS NULL
 ) THEN RAISE EXCEPTION '所选商品不存在，请刷新商品库'; END IF;
 -- Lock product rows in a consistent order, then reconcile the persisted sale balance.
 FOR entry IN
  SELECT p.id,COALESCE(p.is_countable_stock,true) counted,
   COALESCE(q.qty,0)::INTEGER desired
  FROM creative_products p LEFT JOIN
   (SELECT product_id,sum(qty)::INTEGER qty FROM retail_stock_quantities(items) GROUP BY product_id) q ON q.product_id=p.id
  WHERE q.product_id IS NOT NULL OR EXISTS
   (SELECT 1 FROM retail_stock_balances b WHERE b.revenue_id=sale_id AND b.product_id=p.id)
  ORDER BY p.id FOR UPDATE OF p
 LOOP
  INSERT INTO retail_stock_balances(revenue_id,product_id) VALUES(sale_id,entry.id) ON CONFLICT DO NOTHING;
  SELECT CASE WHEN TG_OP='DELETE' THEN baseline_qty
   WHEN entry.counted THEN entry.desired ELSE current_qty END - current_qty
   INTO delta FROM retail_stock_balances WHERE revenue_id=sale_id AND product_id=entry.id FOR UPDATE;
  IF delta <> 0 THEN
   SELECT COALESCE(stock,0) INTO previous_stock FROM creative_products WHERE id=entry.id;
   UPDATE creative_products SET stock=COALESCE(stock,0)-delta,updated_at=now() WHERE id=entry.id;
   INSERT INTO retail_stock_movements(revenue_id,product_id,quantity_delta,stock_before,stock_after,actor_id,action)
    VALUES(sale_id,entry.id,-delta,previous_stock,previous_stock-delta,
     NULLIF(current_setting('aiwei.actor_id',true),''),TG_OP);
   UPDATE retail_stock_balances SET current_qty=current_qty+delta WHERE revenue_id=sale_id AND product_id=entry.id;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN DELETE FROM retail_stock_balances WHERE revenue_id=sale_id; RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS revenue_retail_stock ON revenue;
CREATE TRIGGER revenue_retail_stock AFTER INSERT OR UPDATE OR DELETE ON revenue
 FOR EACH ROW EXECUTE FUNCTION apply_retail_stock();
COMMIT;
