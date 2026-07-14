-- Separate task and event scheduling metadata.
ALTER TABLE tasks ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'task';
ALTER TABLE tasks ADD COLUMN starts_at TEXT;
ALTER TABLE tasks ADD COLUMN ends_at TEXT;
ALTER TABLE tasks ADD COLUMN location TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_item_kind ON tasks(item_kind);
