BEGIN;
-- Additive metadata only: original projects, receipts and income views remain intact.
CREATE TABLE IF NOT EXISTS space_quick_rentals (
 space_usage_id TEXT PRIMARY KEY REFERENCES space_usage(id) ON DELETE RESTRICT,
 mode TEXT NOT NULL DEFAULT 'simple' CHECK(mode IN ('simple','full')),
 start_at TEXT NOT NULL CHECK(start_at ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
 end_at TEXT NOT NULL CHECK(end_at ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_at>start_at),
 client_contact TEXT NOT NULL DEFAULT '',client_phone TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),initial_request_hash TEXT NOT NULL,
 completed_at TIMESTAMPTZ,converted_at TIMESTAMPTZ,
 created_by TEXT NOT NULL,updated_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
