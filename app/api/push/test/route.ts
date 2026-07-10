import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireProfile } from "@/lib/server/authz";
import { getCloudflareEnv } from "@/lib/server/cloudflare";
import { assertSameOrigin, validatePushEndpoint } from "@/lib/server/push-security";
import { sendPushWake } from "@/lib/server/web-push";

const bodySchema = z.object({ endpoint: z.string().url().max(2048) });
type SubscriptionRow = { id: string; endpoint: string };

type PushResponse = { ok: boolean; status: number };

async function removeFailedTest(env: CloudflareEnv, notificationId: string, subscriptionId: string) {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM push_deliveries WHERE notification_id = ? AND subscription_id = ?`,
    ).bind(notificationId, subscriptionId),
    env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(notificationId),
  ]);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = bodySchema.parse(await request.json());
    validatePushEndpoint(body.endpoint);
    const env = await getCloudflareEnv();
    const subscription = await env.DB.prepare(
      `SELECT id, endpoint
         FROM push_subscriptions
        WHERE profile_id = ? AND endpoint = ? AND active = 1
        LIMIT 1`,
    ).bind(profile.id, body.endpoint).first<SubscriptionRow>();
    if (!subscription) throw new HttpError(404, "Este dispositivo no tiene una suscripción activa.");

    const now = new Date().toISOString();
    const notificationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO notifications (
           id, profile_id, kind, priority, title, body, entity, entity_id, action_url, scheduled_for, created_by
         ) VALUES (?, ?, 'push_test', 'normal', ?, ?, 'system', ?, '/', ?, ?)`,
      ).bind(notificationId, profile.id, "Notificación de prueba", "Web Push funciona correctamente en este dispositivo.", notificationId, now, profile.id),
      env.DB.prepare(
        `INSERT INTO push_deliveries (
           notification_id, subscription_id, delivered_at, status_code, displayed_at
         ) VALUES (?, ?, ?, 0, NULL)`,
      ).bind(notificationId, subscription.id, now),
    ]);

    let response: PushResponse;
    try {
      response = await sendPushWake(subscription, env);
    } catch (error) {
      await removeFailedTest(env, notificationId, subscription.id);
      throw error;
    }

    const completedAt = new Date().toISOString();
    if (!response.ok) {
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM push_deliveries WHERE notification_id = ? AND subscription_id = ?`,
        ).bind(notificationId, subscription.id),
        env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(notificationId),
        env.DB.prepare(
          `UPDATE push_subscriptions
              SET active = CASE WHEN ? IN (404, 410) THEN 0 ELSE active END,
                  failure_count = failure_count + 1,
                  updated_at = ?
            WHERE id = ?`,
        ).bind(response.status, completedAt, subscription.id),
      ]);
      throw new HttpError(502, `El servicio push rechazó la prueba (${response.status}).`);
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE push_deliveries SET delivered_at = ?, status_code = ?
          WHERE notification_id = ? AND subscription_id = ?`,
      ).bind(completedAt, response.status, notificationId, subscription.id),
      env.DB.prepare(
        `UPDATE push_subscriptions
            SET last_success_at = ?, failure_count = 0, updated_at = ?
          WHERE id = ?`,
      ).bind(completedAt, completedAt, subscription.id),
    ]);

    return NextResponse.json({ ok: true, delivered: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
