BEGIN;
DROP VIEW IF EXISTS space_project_performance_v2;
DROP VIEW IF EXISTS space_usage_with_payments;
CREATE OR REPLACE VIEW space_usage_with_payments AS
SELECT s.id,s.date,s.end_date,s.space,s.project_name,s.type,s.client,s.status,s.rental_type,s.receivable_amount,s.expected_payment_date,s.notes,s.created_at,
COALESCE((SELECT json_agg(json_build_object('id',p.id,'paymentDate',p.payment_date,'amount',p.amount,'paymentMethod',p.payment_method,'notes',p.notes,'createdAt',p.created_at) ORDER BY p.payment_date) FROM space_payments p WHERE p.space_usage_id=s.id),'[]'::json) AS payments,
COALESCE((SELECT SUM(amount) FROM space_payments p WHERE p.space_usage_id=s.id),0) AS received_amount
FROM space_usage s;
-- Additive project fields remain in place to preserve contract and classification data.
COMMIT;
