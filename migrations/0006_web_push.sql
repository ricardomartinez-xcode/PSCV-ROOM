CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile_active
ON push_subscriptions(profile_id, active);

CREATE TABLE IF NOT EXISTS push_deliveries (
  notification_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_code INTEGER NOT NULL,
  PRIMARY KEY (notification_id, subscription_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_subscription
ON push_deliveries(subscription_id, delivered_at);
