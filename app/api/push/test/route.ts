import { NextResponse } from "next/server";
import { errorResponse, requireProfile } from "@/lib/server/authz";
import { getCloudflareEnv } from "@/lib/server/cloudflare";
import { d1All, d1Run } from "@/lib/server/d1-data";
import { sendPushWake } from "@/lib/server/web-push";

type SubscriptionRow = { id: string; endpoint: string };

export async function POST(request: Request) {
  try {
    const profile = await requireProfile(request);
    const env = await getCloudflareEnv();
    const now = new Date().toISOString();
    const notificationId = crypto.randomUUID();
    await d1Run(
      `INSERT INTO notifications (
         id, profile_id, kind, priority, title, body, entity, entity_id, action_url, scheduled_for, created_by
       ) VALUES (?, ?, 'push_test', 'normal', ?, ?, 'system', ?, '/', ?, ?)`,
      [notificationId, profile.id, "Notificación de prueba", "Web Push funciona correctamente en este dispositivo.", notificationId, now, profile.id],
    );
    const subscriptions = await d1All<SubscriptionRow>(
      `SELECT id, endpoint FROM push_subscriptions WHERE profile_id = ? AND active = 1`,
      [profile.id],
    );
    let delivered = 0;
    for (const subscription of subscriptions) {
      const response = await sendPushWake(subscription, env);
      if (response.ok) delivered += 1;
    }
    return NextResponse.json({ ok: true, subscriptions: subscriptions.length, delivered });
  } catch (error) {
    return errorResponse(error);
  }
}
