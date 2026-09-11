WITH schema_objects AS (
  SELECT c.relname AS object_name,
    c.relkind::TEXT || ':' || c.relname AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
  UNION ALL
  SELECT table_name || '.' || column_name,
    table_name || '.' || column_name || ':' || data_type || ':' || COALESCE(column_default, '')
  FROM information_schema.columns
  WHERE table_schema = 'public'
), schema_state AS (
  SELECT
    (SELECT COUNT(*)::INTEGER FROM pg_tables WHERE schemaname='public') AS table_count,
    (SELECT COUNT(*)::INTEGER FROM pg_views WHERE schemaname='public') AS view_count,
    MD5(COALESCE(STRING_AGG(definition, '' ORDER BY object_name), '')) AS fingerprint
  FROM schema_objects
)
SELECT JSONB_BUILD_OBJECT(
  'capturedAt', NOW(),
  'database', CURRENT_DATABASE(),
  'serverVersion', CURRENT_SETTING('server_version'),
  'schema', JSONB_BUILD_OBJECT(
    'tableCount', schema_state.table_count,
    'viewCount', schema_state.view_count,
    'fingerprint', schema_state.fingerprint
  ),
  'configuration', JSONB_BUILD_OBJECT(
    'operationsRollout', COALESCE((SELECT value->>'mode' FROM app_config WHERE key='operations_rollout'), 'absent')
  ),
  'counts', JSONB_BUILD_OBJECT(
    'revenue', (SELECT COUNT(*) FROM revenue),
    'expense', (SELECT COUNT(*) FROM expense),
    'gallerySales', (SELECT COUNT(*) FROM gallery_sales),
    'spaceUsage', (SELECT COUNT(*) FROM space_usage),
    'spacePayments', (SELECT COUNT(*) FROM space_payments),
    'dailyClosings', (SELECT COUNT(*) FROM daily_closings),
    'transactionAdjustments', (SELECT COUNT(*) FROM transaction_adjustments),
    'cashMovements', (SELECT COUNT(*) FROM cash_movements),
    'creativeProducts', (SELECT COUNT(*) FROM creative_products),
    'artworks', (SELECT COUNT(*) FROM artworks),
    'users', (SELECT COUNT(*) FROM users),
    'operationLogs', (SELECT COUNT(*) FROM operation_logs)
  ),
  'amounts', JSONB_BUILD_OBJECT(
    'revenueComponents', (SELECT COALESCE(SUM(
      COALESCE(ticket_amount,0) + COALESCE(combo_amount,0) + COALESCE(coffee_amount,0) +
      COALESCE(workshop_amount,0) + COALESCE(retail_amount,0) + COALESCE(creative_amount,0) +
      COALESCE(venue_amount,0) + COALESCE(other_amount,0)
    ),0) FROM revenue),
    'revenueRefunds', (SELECT COALESCE(SUM(refund_amount),0) FROM revenue),
    'expense', (SELECT COALESCE(SUM(amount),0) FROM expense),
    'galleryPrice', (SELECT COALESCE(SUM(price),0) FROM gallery_sales),
    'galleryCommission', (SELECT COALESCE(SUM(commission),0) FROM gallery_sales),
    'galleryRefunds', (SELECT COALESCE(SUM(refund_amount),0) FROM gallery_sales),
    'spaceReceivable', (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage),
    'spaceReceived', (SELECT COALESCE(SUM(amount),0) FROM space_payments),
    'closingSystem', (SELECT COALESCE(SUM(system_net_amount),0) FROM daily_closings),
    'closingConfirmed', (SELECT COALESCE(SUM(confirmed_amount),0) FROM daily_closings),
    'closingDifference', (SELECT COALESCE(SUM(difference_amount),0) FROM daily_closings),
    'adjustments', (SELECT COALESCE(SUM(amount),0) FROM transaction_adjustments),
    'cashMovements', (SELECT COALESCE(SUM(amount),0) FROM cash_movements)
  ),
  'latestFacts', JSONB_BUILD_OBJECT(
    'revenue', (SELECT MAX(date) FROM revenue),
    'expense', (SELECT MAX(date) FROM expense),
    'gallerySales', (SELECT MAX(date) FROM gallery_sales),
    'spaceUsage', (SELECT MAX(date) FROM space_usage),
    'dailyClosings', (SELECT MAX(date) FROM daily_closings)
  )
) AS baseline
FROM schema_state;
