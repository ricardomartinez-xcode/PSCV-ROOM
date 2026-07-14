-- Separate tasks from events without breaking current task data.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS item_kind TEXT NOT NULL DEFAULT 'task';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS starts_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ends_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_item_kind ON tasks(item_kind);
