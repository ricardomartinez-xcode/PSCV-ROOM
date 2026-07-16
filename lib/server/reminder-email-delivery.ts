import { deliverAnnouncementEmails, type AnnouncementNotification } from "@/lib/server/notification-email";
import { ACTIVITY_REMINDER_KINDS } from "@/lib/server/event-reminders";

type DueReminder = AnnouncementNotification & { scheduled_for: string };

function changedRows(result: D1Result) {
  const changes = result.meta?.changes;
  return typeof changes === "number" ? changes : Number(changes ?? 0);
}

export async function processDueReminderEmails(env: CloudflareEnv) {
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - 2 * 86400000).toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const placeholders = ACTIVITY_REMINDER_KINDS.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT n.id, n.profile_id, n.kind, n.priority, n.title, n.body, n.action_url, n.scheduled_for
       FROM notifications n
       JOIN notification_preferences p
         ON p.profile_id = n.profile_id
        AND p.email_enabled = 1
       LEFT JOIN notification_email_deliveries d ON d.notification_id = n.id
      WHERE n.profile_id IS NOT NULL
        AND n.dismissed_at IS NULL
        AND n.kind IN (${placeholders})
        AND n.scheduled_for <= ?
        AND n.scheduled_for >= ?
        AND (
          d.notification_id IS NULL
          OR (d.status = 'pending' AND d.delivered_at <= ?)
        )
      ORDER BY n.scheduled_for ASC
      LIMIT 100`,
  ).bind(...ACTIVITY_REMINDER_KINDS, now, earliest, staleBefore).all<DueReminder>();

  const counters = { delivered: 0, failed: 0, skipped: 0 };
  for (const notification of result.results ?? []) {
    const claimedAt = new Date().toISOString();
    const claim = await env.DB.prepare(
      `INSERT INTO notification_email_deliveries (notification_id, delivered_at, status)
       VALUES (?, ?, 'pending')
       ON CONFLICT(notification_id) DO UPDATE SET
         delivered_at = excluded.delivered_at,
         status = 'pending'
       WHERE notification_email_deliveries.status = 'pending'
         AND notification_email_deliveries.delivered_at <= ?`,
    ).bind(notification.id, claimedAt, staleBefore).run();

    if (changedRows(claim) === 0) {
      counters.skipped += 1;
      continue;
    }

    const delivery = await deliverAnnouncementEmails([notification]);
    if (delivery.delivered === 1) {
      await env.DB.prepare(
        `UPDATE notification_email_deliveries
            SET delivered_at = ?, status = 'delivered'
          WHERE notification_id = ? AND status = 'pending'`,
      ).bind(new Date().toISOString(), notification.id).run();
      counters.delivered += 1;
    } else if (delivery.failed > 0) {
      await env.DB.prepare(
        "DELETE FROM notification_email_deliveries WHERE notification_id = ? AND status = 'pending'",
      ).bind(notification.id).run();
      counters.failed += 1;
    } else {
      await env.DB.prepare(
        "DELETE FROM notification_email_deliveries WHERE notification_id = ? AND status = 'pending'",
      ).bind(notification.id).run();
      counters.skipped += 1;
    }
  }

  return { scanned: result.results?.length ?? 0, ...counters };
}
