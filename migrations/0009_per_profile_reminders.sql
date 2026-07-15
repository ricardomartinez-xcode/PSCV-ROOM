CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  notification_id TEXT PRIMARY KEY,
  delivered_at TEXT NOT NULL,
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_email_deliveries_delivered_at
  ON notification_email_deliveries(delivered_at);

INSERT INTO notification_preferences (
  profile_id, in_app_enabled, email_enabled, categories, created_at, updated_at
)
SELECT id, 1, 1, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_profiles
WHERE active = 1
ON CONFLICT(profile_id) DO NOTHING;

INSERT INTO notifications (
  id, profile_id, kind, priority, title, body, entity, entity_id,
  action_url, scheduled_for, created_by, created_at
)
SELECT
  lower(hex(randomblob(16))),
  p.id,
  n.kind,
  n.priority,
  n.title,
  n.body,
  n.entity,
  n.entity_id,
  n.action_url,
  n.scheduled_for,
  n.created_by,
  n.created_at
FROM notifications n
JOIN app_profiles p ON p.active = 1
WHERE n.profile_id IS NULL
  AND n.dismissed_at IS NULL
  AND n.kind IN (
    'event_reminder_day_before',
    'task_reminder_3_days',
    'task_reminder_2_days',
    'task_reminder_1_day',
    'task_reminder_day_of'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM notifications existing
    WHERE existing.profile_id = p.id
      AND existing.entity = n.entity
      AND existing.entity_id = n.entity_id
      AND existing.kind = n.kind
      AND existing.scheduled_for = n.scheduled_for
      AND existing.dismissed_at IS NULL
  );

UPDATE notifications
SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
WHERE profile_id IS NULL
  AND kind IN (
    'event_reminder_day_before',
    'task_reminder_3_days',
    'task_reminder_2_days',
    'task_reminder_1_day',
    'task_reminder_day_of'
  );
