ALTER TABLE notification_email_deliveries
  ADD COLUMN status TEXT NOT NULL DEFAULT 'delivered'
  CHECK (status IN ('pending', 'delivered'));

CREATE INDEX IF NOT EXISTS idx_notification_email_deliveries_status
  ON notification_email_deliveries(status, delivered_at);
