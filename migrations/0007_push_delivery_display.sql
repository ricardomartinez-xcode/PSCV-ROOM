ALTER TABLE push_deliveries ADD COLUMN displayed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_push_deliveries_pending_display
ON push_deliveries(subscription_id, displayed_at, delivered_at);
