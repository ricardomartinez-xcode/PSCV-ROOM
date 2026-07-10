import { sendPushWake } from "@/lib/server/web-push";

type DeliveryRow = {
  notification_id: string;
  subscription_id: string;
  endpoint: string;
};

type DeliveryOutcome = "delivered" | "deactivated" | "failed" | "skipped";

function changedRows(result: D1Result) {
  const changes = result.meta?.changes;
  return typeof changes === "number" ? changes : Number(changes ?? 0);
}

async function processDelivery(
  row: DeliveryRow,
  env: CloudflareEnv,
  staleBefore: string,
): Promise<DeliveryOutcome> {
  const queuedAt = new Date().toISOString();
  const queued = await env.DB.prepare(
    `INSERT INTO push_deliveries (
       notification_id, subscription_id, delivered_at, status_code, displayed_at
     ) VALUES (?, ?, ?, 0, NULL)
     ON CONFLICT(notification_id, subscription_id) DO UPDATE SET
       delivered_at = excluded.delivered_at,
       displayed_at = NULL
     WHERE push_deliveries.status_code = 0
       AND push_deliveries.delivered_at <= ?`,
  ).bind(row.notification_id, row.subscription_id, queuedAt, staleBefore).run();

  if (changedRows(queued) === 0) return "skipped";

  try {
    const response = await sendPushWake({ id: row.subscription_id, endpoint: row.endpoint }, env);
    const now = new Date().toISOString();
    if (response.ok) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE push_deliveries
              SET delivered_at = ?, status_code = ?
            WHERE notification_id = ? AND subscription_id = ?`,
        ).bind(now, response.status, row.notification_id, row.subscription_id),
        env.DB.prepare(
          `UPDATE push_subscriptions
              SET last_success_at = ?, failure_count = 0, updated_at = ?
            WHERE id = ?`,
        ).bind(now, now, row.subscription_id),
      ]);
      return "delivered";
    }

    await env.DB.prepare(
      `DELETE FROM push_deliveries WHERE notification_id = ? AND subscription_id = ?`,
    ).bind(row.notification_id, row.subscription_id).run();

    if (response.status === 404 || response.status === 410) {
      await env.DB.prepare(
        `UPDATE push_subscriptions
            SET active = 0, failure_count = failure_count + 1, updated_at = ?
          WHERE id = ?`,
      ).bind(now, row.subscription_id).run();
      return "deactivated";
    }

    await env.DB.prepare(
      `UPDATE push_subscriptions
          SET failure_count = failure_count + 1, updated_at = ?
        WHERE id = ?`,
    ).bind(now, row.subscription_id).run();
    return "failed";
  } catch {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM push_deliveries WHERE notification_id = ? AND subscription_id = ?`,
      ).bind(row.notification_id, row.subscription_id),
      env.DB.prepare(
        `UPDATE push_subscriptions
            SET failure_count = failure_count + 1, updated_at = ?
          WHERE id = ?`,
      ).bind(now, row.subscription_id),
    ]);
    return "failed";
  }
}

export async function processDuePushNotifications(env: CloudflareEnv) {
  const now = new Date();
  const earliest = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
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
        AND n.kind <> 'push_test'
        AND n.scheduled_for <= ?
        AND n.scheduled_for >= ?
        AND (
          d.notification_id IS NULL
          OR (d.status_code = 0 AND d.delivered_at <= ?)
        )
      ORDER BY n.scheduled_for ASC
      LIMIT 200`,
  ).bind(now.toISOString(), earliest, staleBefore).all<DeliveryRow>();

  const counters = { delivered: 0, deactivated: 0, failed: 0, skipped: 0 };
  const rows = result.results ?? [];
  for (let index = 0; index < rows.length; index += 8) {
    const outcomes = await Promise.all(
      rows.slice(index, index + 8).map((row) => processDelivery(row, env, staleBefore)),
    );
    for (const outcome of outcomes) counters[outcome] += 1;
  }

  return { scanned: rows.length, ...counters };
}
