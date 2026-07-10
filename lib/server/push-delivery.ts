import { sendPushWake } from "@/lib/server/web-push";

type DeliveryRow = {
  notification_id: string;
  subscription_id: string;
  endpoint: string;
};

export async function processDuePushNotifications(env: CloudflareEnv) {
  const now = new Date();
  const earliest = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT n.id AS notification_id, s.id AS subscription_id, s.endpoint
       FROM notifications n
       JOIN push_subscriptions s
         ON s.active = 1
        AND (n.profile_id IS NULL OR n.profile_id = s.profile_id)
       LEFT JOIN push_deliveries d
         ON d.notification_id = n.id
        AND d.subscription_id = s.id
      WHERE n.dismissed_at IS NULL
        AND n.scheduled_for <= ?
        AND n.scheduled_for >= ?
        AND d.notification_id IS NULL
      ORDER BY n.scheduled_for ASC
      LIMIT 200`,
  ).bind(now.toISOString(), earliest).all<DeliveryRow>();

  let delivered = 0;
  let deactivated = 0;
  let failed = 0;

  for (const row of result.results ?? []) {
    try {
      const response = await sendPushWake({ id: row.subscription_id, endpoint: row.endpoint }, env);
      if (response.ok) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO push_deliveries (notification_id, subscription_id, delivered_at, status_code)
           VALUES (?, ?, ?, ?)`,
        ).bind(row.notification_id, row.subscription_id, new Date().toISOString(), response.status).run();
        await env.DB.prepare(
          `UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0, updated_at = ? WHERE id = ?`,
        ).bind(new Date().toISOString(), new Date().toISOString(), row.subscription_id).run();
        delivered += 1;
      } else if (response.status === 404 || response.status === 410) {
        await env.DB.prepare(
          `UPDATE push_subscriptions SET active = 0, failure_count = failure_count + 1, updated_at = ? WHERE id = ?`,
        ).bind(new Date().toISOString(), row.subscription_id).run();
        deactivated += 1;
      } else {
        await env.DB.prepare(
          `UPDATE push_subscriptions SET failure_count = failure_count + 1, updated_at = ? WHERE id = ?`,
        ).bind(new Date().toISOString(), row.subscription_id).run();
        failed += 1;
      }
    } catch {
      await env.DB.prepare(
        `UPDATE push_subscriptions SET failure_count = failure_count + 1, updated_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), row.subscription_id).run();
      failed += 1;
    }
  }

  return { scanned: result.results?.length ?? 0, delivered, deactivated, failed };
}
