import { deliverAnnouncementEmails, type AnnouncementNotification } from "@/lib/server/notification-email";
import { ACTIVITY_REMINDER_KINDS } from "@/lib/server/event-reminders";

type DueReminder = AnnouncementNotification & { scheduled_for: string };

export async function processDueReminderEmails(env: CloudflareEnv) {
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - 2 * 86400000).toISOString();
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
        AND d.notification_id IS NULL
      ORDER BY n.scheduled_for ASC
      LIMIT 100`,
  ).bind(...ACTIVITY_REMINDER_KINDS, now, earliest).all<DueReminder>();

  const counters = { delivered: 0, failed: 0, skipped: 0 };
  for (const notification of result.results ?? []) {
    const delivery = await deliverAnnouncementEmails([notification]);
    if (delivery.delivered === 1) {
      await env.DB.prepare(
        `INSERT INTO notification_email_deliveries (notification_id, delivered_at)
         VALUES (?, ?)
         ON CONFLICT(notification_id) DO NOTHING`,
      ).bind(notification.id, new Date().toISOString()).run();
      counters.delivered += 1;
    } else if (delivery.failed > 0) {
      counters.failed += 1;
    } else {
      counters.skipped += 1;
    }
  }

  return { scanned: result.results?.length ?? 0, ...counters };
}
