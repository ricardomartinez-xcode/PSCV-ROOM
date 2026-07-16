-- Keep the only configurable early-task window aligned with the product rule.
UPDATE notification_preferences
SET due_soon_hours = 24,
    updated_at = CURRENT_TIMESTAMP
WHERE due_soon_hours <> 24;

-- Defensive cleanup for databases that received legacy reminders after 0010.
UPDATE notifications
SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
WHERE kind IN (
  'task_reminder_3_days',
  'task_reminder_2_days'
)
  AND dismissed_at IS NULL;

-- Retain one active logical reminder if an at-least-once invocation previously
-- raced and produced duplicates. Historical dismissed rows remain available.
UPDATE notifications
SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
WHERE rowid IN (
  SELECT stale.rowid
  FROM notifications AS stale
  JOIN notifications AS keep
    ON keep.profile_id = stale.profile_id
   AND keep.entity = stale.entity
   AND keep.entity_id = stale.entity_id
   AND keep.kind = stale.kind
   AND keep.dismissed_at IS NULL
   AND (
     keep.scheduled_for > stale.scheduled_for
     OR (
       keep.scheduled_for = stale.scheduled_for
       AND keep.rowid > stale.rowid
     )
   )
  WHERE stale.entity = 'tasks'
    AND stale.profile_id IS NOT NULL
    AND stale.dismissed_at IS NULL
    AND stale.kind IN (
      'event_reminder_day_before',
      'task_reminder_1_day',
      'task_reminder_day_of'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_active_activity_reminder
ON notifications(profile_id, entity_id, kind)
WHERE entity = 'tasks'
  AND profile_id IS NOT NULL
  AND dismissed_at IS NULL
  AND kind IN (
    'event_reminder_day_before',
    'task_reminder_1_day',
    'task_reminder_day_of'
  );
