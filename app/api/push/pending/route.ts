import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireProfile } from "@/lib/server/authz";
import { getCloudflareEnv } from "@/lib/server/cloudflare";
import { assertSameOrigin, validatePushEndpoint } from "@/lib/server/push-security";

const bodySchema = z.object({ endpoint: z.string().url().max(2048) });

type ClaimedDelivery = { notification_id: string };
type NotificationRow = {
  id: string;
  kind: string;
  priority: string;
  title: string;
  body: string;
  action_url: string | null;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = bodySchema.parse(await request.json());
    validatePushEndpoint(body.endpoint);
    const env = await getCloudflareEnv();
    const now = new Date().toISOString();

    const claimed = await env.DB.prepare(
      `UPDATE push_deliveries
          SET displayed_at = ?
        WHERE rowid = (
          SELECT d.rowid
            FROM push_deliveries d
            JOIN push_subscriptions s ON s.id = d.subscription_id
            JOIN notifications n ON n.id = d.notification_id
           WHERE s.profile_id = ?
             AND s.endpoint = ?
             AND s.active = 1
             AND d.displayed_at IS NULL
             AND (d.status_code = 0 OR d.status_code BETWEEN 200 AND 299)
             AND n.dismissed_at IS NULL
             AND n.scheduled_for <= ?
             AND (n.profile_id IS NULL OR n.profile_id = ?)
           ORDER BY d.delivered_at ASC
           LIMIT 1
        )
          AND displayed_at IS NULL
      RETURNING notification_id`,
    ).bind(now, profile.id, body.endpoint, now, profile.id).first<ClaimedDelivery>();

    if (!claimed) {
      return NextResponse.json({ ok: true, notification: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const notification = await env.DB.prepare(
      `SELECT id, kind, priority, title, body, action_url
         FROM notifications
        WHERE id = ?
          AND dismissed_at IS NULL
          AND (profile_id IS NULL OR profile_id = ?)
        LIMIT 1`,
    ).bind(claimed.notification_id, profile.id).first<NotificationRow>();

    return NextResponse.json({ ok: true, notification: notification ?? null }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
