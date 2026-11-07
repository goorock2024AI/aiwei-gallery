-- Additive; keep the queue and its private files on application rollback.
CREATE TABLE IF NOT EXISTS artist_mail_imports (
 id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, message_id TEXT NOT NULL,
 thread_id TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL, body TEXT NOT NULL, source_complete BOOLEAN NOT NULL,
 artist_id TEXT REFERENCES artist_profiles(id),
 record_id TEXT UNIQUE REFERENCES artist_records(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(mailbox,message_id),
 CHECK((artist_id IS NULL) = (record_id IS NULL))
);
CREATE INDEX IF NOT EXISTS artist_mail_received ON artist_mail_imports(received_at DESC,id);
CREATE TABLE IF NOT EXISTS artist_mail_items (
 import_id TEXT NOT NULL REFERENCES artist_mail_imports(id),
 item_key TEXT NOT NULL, name TEXT NOT NULL, url TEXT, reason TEXT NOT NULL,
 file_id TEXT UNIQUE REFERENCES artist_files(id),
 PRIMARY KEY(import_id,item_key)
);
