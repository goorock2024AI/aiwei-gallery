-- Additive migration. Rollback disables the entry/API and preserves all records/files.
CREATE TABLE IF NOT EXISTS artist_profiles (
 id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
 archived BOOLEAN NOT NULL DEFAULT FALSE, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS artist_files (
 id TEXT PRIMARY KEY, artist_id TEXT REFERENCES artist_profiles(id), original_name TEXT NOT NULL,
 size BIGINT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL,
 owner_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('staged','active','removed')),
 category TEXT NOT NULL DEFAULT '其他资料', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_files_profile ON artist_files(artist_id,state);
CREATE TABLE IF NOT EXISTS artist_artwork_links (
 artist_id TEXT NOT NULL REFERENCES artist_profiles(id), artwork_id TEXT NOT NULL REFERENCES artworks(id),
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(artist_id,artwork_id)
);
CREATE TABLE IF NOT EXISTS artist_records (
 id TEXT PRIMARY KEY, artist_id TEXT NOT NULL REFERENCES artist_profiles(id),
 kind TEXT NOT NULL CHECK(kind IN ('followup','submission','work')),
 data JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_records_profile ON artist_records(artist_id,created_at);
