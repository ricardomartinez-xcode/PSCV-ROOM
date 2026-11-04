-- Sessions have no idle or absolute timeout. Logout revokes them in the database.
-- Only the digest of a random browser credential is stored.
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES app_profiles(id) ON DELETE CASCADE,
  access_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_profile ON app_sessions(profile_id);
