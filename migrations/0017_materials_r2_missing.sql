-- Preserve index records and task links while tracking objects removed from R2.
ALTER TABLE materials ADD COLUMN r2_missing_at TEXT;
CREATE INDEX IF NOT EXISTS idx_materials_r2_missing ON materials(provider, r2_missing_at);
