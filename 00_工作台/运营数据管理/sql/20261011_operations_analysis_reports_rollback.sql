BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM operations_analysis_reports) OR EXISTS (SELECT 1 FROM operations_analysis_packets) THEN
  RAISE EXCEPTION 'Report snapshots exist. Preserve reports and packets; roll back application code only.';
 END IF;
END $$;
DROP TABLE operations_analysis_reports;
DROP TABLE operations_analysis_packets;
COMMIT;
