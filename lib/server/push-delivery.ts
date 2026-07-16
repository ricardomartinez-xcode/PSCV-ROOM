import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sendPushWake } from "@/lib/server/web-push";

type DeliveryRow = {
  notification_id: string;
  subscription_id: string;
  endpoint: string;
};

type NotificationIdRow = {
  id: string;
};

type DeliveryOutcome = "delivered" | "deactivated" | "failed" | "skipped";

type DeliveryCounters = Record<DeliveryOutcome, number>;

const TARGETED_NOTIFICATION_BATCH_SIZE = 50;
const PUSH_DELIVERY_CONCURRENCY = 6;

function emptyCounters(): DeliveryCounters {
  return { delivered: 0, deactivated: 0, failed: 0, skipped: 0 };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
  } catch (error) {
    const now = new Date().toISOString();
    console.error(JSON.stringify({
      message: "push delivery failed",
      notificationId: row.notification_id,
      subscriptionId: row.subscription_id,
      error: errorMessage(error),
    }));
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

async function processDeliveryRows(
  rows: DeliveryRow[],
  env: CloudflareEnv,
  staleBefore: string,
) {
  const counters = emptyCounters();
  for (let index = 0; index < rows.length; index += PUSH_DELIVERY_CONCURRENCY) {
    const deliveryRows = rows.slice(index, index + PUSH_DELIVERY_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      deliveryRows.map((row) => processDelivery(row, env, staleBefore)),
    );
    for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex += 1) {
      const outcome = outcomes[outcomeIndex];
      if (outcome.status === "fulfilled") {
        counters[outcome.value] += 1;
        continue;
      }
      counters.failed += 1;
      console.error(JSON.stringify({
        message: "push delivery row failed",
        notificationId: deliveryRows[outcomeIndex]?.notification_id,
        subscriptionId: deliveryRows[outcomeIndex]?.subscription_id,
        error: errorMessage(outcome.reason),
      }));
    }
  }
  return counters;
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

  const rows = result.results ?? [];
  const counters = await processDeliveryRows(rows, env, staleBefore);

  return { scanned: rows.length, ...counters };
}

export async function processPushNotificationsByIds(
  env: CloudflareEnv,
  notificationIds: readonly string[],
) {
  const ids = [...new Set(notificationIds.filter(Boolean))];
  const counters = emptyCounters();
  let scanned = 0;
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  for (let index = 0; index < ids.length; index += TARGETED_NOTIFICATION_BATCH_SIZE) {
    const batch = ids.slice(index, index + TARGETED_NOTIFICATION_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT n.id AS notification_id, s.id AS subscription_id, s.endpoint
         FROM notifications n
         JOIN push_subscriptions s
           ON s.active = 1
          AND (n.profile_id IS NULL OR n.profile_id = s.profile_id)
         LEFT JOIN push_deliveries d
           ON d.notification_id = n.id
          AND d.subscription_id = s.id
        WHERE n.id IN (${placeholders})
          AND n.dismissed_at IS NULL
          AND n.kind <> 'push_test'
          AND n.scheduled_for <= ?
          AND (
            d.notification_id IS NULL
            OR (d.status_code = 0 AND d.delivered_at <= ?)
          )
        ORDER BY n.scheduled_for ASC`,
    ).bind(...batch, now, staleBefore).all<DeliveryRow>();
    const rows = result.results ?? [];
    const batchCounters = await processDeliveryRows(rows, env, staleBefore);
    scanned += rows.length;
    for (const outcome of Object.keys(counters) as DeliveryOutcome[]) {
      counters[outcome] += batchCounters[outcome];
    }
  }

  return { scanned, ...counters };
}

export async function processTaskPushNotifications(
  env: CloudflareEnv,
  taskIds: readonly string[],
) {
  const tasks = [...new Set(taskIds.filter(Boolean))];
  const notificationIds: string[] = [];
  const now = new Date().toISOString();

  for (let index = 0; index < tasks.length; index += TARGETED_NOTIFICATION_BATCH_SIZE) {
    const batch = tasks.slice(index, index + TARGETED_NOTIFICATION_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT id
         FROM notifications
        WHERE entity = 'tasks'
          AND entity_id IN (${placeholders})
          AND dismissed_at IS NULL
          AND scheduled_for <= ?`,
    ).bind(...batch, now).all<NotificationIdRow>();
    for (const row of result.results ?? []) notificationIds.push(row.id);
  }

  const delivery = await processPushNotificationsByIds(env, notificationIds);
  return {
    targetedTasks: tasks.length,
    targetedNotifications: new Set(notificationIds).size,
    ...delivery,
  };
}

export async function dispatchPushNotificationsInBackground(
  notificationIds?: readonly string[],
) {
  const context = await getCloudflareContext({ async: true });
  const ids = notificationIds ? [...new Set(notificationIds.filter(Boolean))] : [];
  const delivery = ids.length
    ? processPushNotificationsByIds(context.env, ids)
    : processDuePushNotifications(context.env);

  context.ctx.waitUntil(delivery
    .then((result) => {
      console.info(JSON.stringify({
        message: "push delivery completed",
        targetedNotifications: ids.length,
        ...result,
      }));
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        message: "push delivery background job failed",
        targetedNotifications: ids.length,
        error: errorMessage(error),
      }));
    }));
}

export async function dispatchTaskPushNotificationsInBackground(
  taskIds: readonly string[],
) {
  const context = await getCloudflareContext({ async: true });
  const ids = [...new Set(taskIds.filter(Boolean))];
  const delivery = processTaskPushNotifications(context.env, ids);

  context.ctx.waitUntil(delivery
    .then((result) => {
      console.info(JSON.stringify({
        message: "task push delivery completed",
        ...result,
      }));
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        message: "task push delivery background job failed",
        targetedTasks: ids.length,
        error: errorMessage(error),
      }));
    }));
}
