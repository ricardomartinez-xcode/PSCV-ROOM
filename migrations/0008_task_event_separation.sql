-- Separate task and event scheduling metadata.
ALTER TABLE tasks ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'task';
ALTER TABLE tasks ADD COLUMN starts_at TEXT;
ALTER TABLE tasks ADD COLUMN ends_at TEXT;
ALTER TABLE tasks ADD COLUMN location TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_item_kind ON tasks(item_kind);

-- Preserve existing rows whose configured type is Evento.
UPDATE tasks
SET item_kind = 'event',
    starts_at = due_date || 'T' || COALESCE(NULLIF(due_time, ''), '09:00') || ':00'
WHERE task_type_id IN (SELECT id FROM task_types WHERE lower(name) = 'evento');
