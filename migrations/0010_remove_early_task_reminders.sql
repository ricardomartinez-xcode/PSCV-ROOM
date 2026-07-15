UPDATE notifications
SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
WHERE kind IN (
  'task_reminder_3_days',
  'task_reminder_2_days'
)
  AND dismissed_at IS NULL;
