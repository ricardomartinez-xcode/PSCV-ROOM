import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { deliverAnnouncementEmails, type AnnouncementNotification } from "@/lib/server/notification-email";
import { groupAdminNotifications, type AdminNotificationRow } from "@/lib/server/notification-groups";
import { d1All, d1Run } from "@/lib/server/d1-data";
import { notificationActionUrl } from "@/lib/notification-action";
import { dispatchPushNotificationsInBackground } from "@/lib/server/push-delivery";

const notificationSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().default(""),
  kind: z.enum(["system", "reminder", "material_added", "task_updated"]).default("system"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  audience: z.enum(["all", "students", "admins"]).default("all"),
  media_id: z.string().max(200).nullable().optional(),
  media_url: z.string().url().max(2048).nullable().optional(),
  media_type: z.enum(["image", "video", "audio", "file"]).nullable().optional(),
});

type ProfileTarget = {
  id: string;
  role: "student" | "admin" | "owner";
};

export async function GET(request: Request) {
  try {
    await requirePermission(request, "notifications:manage");
    const data = await d1All<AdminNotificationRow>(
      `SELECT id, profile_id, kind, priority, title, body, media_url, media_type, entity, entity_id, read_at, dismissed_at, created_at
       FROM notifications
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    return NextResponse.json({ ok: true, notifications: groupAdminNotifications(data) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requirePermission(request, "notifications:manage");
    const body = notificationSchema.parse(await request.json());
    const where = body.audience === "students"
      ? "WHERE active = 1 AND role = 'student'"
      : body.audience === "admins"
        ? "WHERE active = 1 AND role IN ('admin', 'owner')"
        : "WHERE active = 1";
    const targets = await d1All<ProfileTarget>(`SELECT id, role FROM app_profiles ${where}`);

    const rows: AnnouncementNotification[] = targets.map((target) => {
      const id = crypto.randomUUID();
      return {
        id,
        profile_id: target.id,
        kind: body.kind,
        priority: body.priority,
        title: body.title,
        body: body.body,
        action_url: notificationActionUrl(id),
      };
    });

    for (const row of rows) {
      await d1Run(
        `INSERT INTO notifications (id, profile_id, kind, priority, title, body, media_id, media_url, media_type, entity, entity_id, action_url, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'broadcast', ?, ?, ?)`,
        [row.id, row.profile_id, row.kind, row.priority, row.title, row.body, body.media_id ?? null, body.media_url ?? null, body.media_type ?? null, body.audience, row.action_url, profile.id],
      );
    }

    if (!rows.length) return NextResponse.json({ ok: true, inserted: 0, email: { configured: false, considered: 0, delivered: 0, skipped: 0, failed: 0, errors: [] } });

    const email = await deliverAnnouncementEmails(rows);
    await dispatchPushNotificationsInBackground(rows.map((row) => row.id));
    return NextResponse.json({ ok: true, inserted: rows.length, systemDeliveryQueued: true, email });
  } catch (error) {
    return errorResponse(error);
  }
}
