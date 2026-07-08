-- Add events as a first-class task-flow category.
INSERT OR IGNORE INTO task_types (id, name, color, icon, card_size, sort_order, active, config)
VALUES ('task-type-evento', 'Evento', '#7c3aed', 'calendar-days', 'large', 15, 1, '{"persistAfterDue":true,"autoReminders":["day_before","day_of"]}');

CREATE INDEX IF NOT EXISTS idx_notifications_event_reminders
ON notifications(entity, entity_id, kind, scheduled_for);
