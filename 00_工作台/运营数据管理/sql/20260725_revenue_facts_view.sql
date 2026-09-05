-- P0-01: unified revenue facts view
-- Purpose: expose a read-only revenue_facts endpoint across POS, gallery, and space income.
-- Rollback: DROP VIEW IF EXISTS revenue_facts;

CREATE OR REPLACE VIEW revenue_facts AS
SELECT
  r.id || ':ticket' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(38376) || chr(31080) AS category,
  r.ticket_amount AS amount,
  r.ticket_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.ticket_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':combo' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(21654) || chr(21857) || chr(22871) || chr(31080) AS category,
  r.combo_amount AS amount,
  r.combo_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.combo_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':coffee' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(21654) || chr(21857) AS category,
  r.coffee_amount AS amount,
  r.coffee_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.coffee_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':workshop' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(24037) || chr(22346) AS category,
  r.workshop_amount AS amount,
  r.workshop_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.workshop_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':retail' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(25991) || chr(21019) AS category,
  COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) AS amount,
  COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.retail_amount, 0) + COALESCE(r.creative_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':venue_legacy' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(22330) || chr(22320) || chr(26087) || chr(21475) || chr(24452) AS category,
  r.venue_amount AS amount,
  r.venue_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.venue_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  r.id || ':other' AS id,
  r.id AS record_id,
  r.date,
  'pos' AS source,
  chr(20854) || chr(20182) AS category,
  r.other_amount AS amount,
  r.other_amount AS net_amount,
  r.payment_method,
  r.project_name,
  r.handler,
  r.created_at
FROM revenue r
WHERE COALESCE(r.other_amount, 0) <> 0
  AND COALESCE(r.status, chr(27491) || chr(24120)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  g.id || ':gallery' AS id,
  g.id AS record_id,
  g.date,
  'gallery' AS source,
  chr(30011) || chr(24266) AS category,
  g.price AS amount,
  COALESCE(g.price, 0) - COALESCE(g.commission, 0) AS net_amount,
  g.payment_method,
  g.related_exhibition AS project_name,
  g.handler,
  g.created_at
FROM gallery_sales g
WHERE COALESCE(g.price, 0) <> 0
  AND COALESCE(g.status, chr(24050) || chr(21806) || chr(20986)) <> chr(24050) || chr(20316) || chr(24223)
UNION ALL
SELECT
  p.id || ':space' AS id,
  p.id AS record_id,
  p.payment_date AS date,
  'space' AS source,
  chr(22330) || chr(22320) AS category,
  p.amount AS amount,
  p.amount AS net_amount,
  p.payment_method,
  s.project_name,
  '' AS handler,
  p.created_at
FROM space_payments p
JOIN space_usage s ON s.id = p.space_usage_id
WHERE s.rental_type = chr(20184) || chr(36153)
  AND COALESCE(p.amount, 0) <> 0;
