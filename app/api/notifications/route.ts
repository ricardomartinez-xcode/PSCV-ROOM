import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireProfile } from "@/lib/server/authz";
import { d1All, d1First, d1Run } from "@/lib/server/d1-data";

const patchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["read", "dismiss"]),
});

const emailPreferenceSchema = z.object({
  emailEnabled: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const profile = await requireProfile(request);
    const now = new Date().toISOString();
    const [notifications, preferences] = await Promise.all([
      d1All<Record<string, unknown>>(
        `SELECT id, kind, priority, title, body, media_url, media_type, entity, entity_id, action_url, scheduled_for, read_at, dismissed_at, created_at
         FROM notifications
         WHERE (profile_id = ? OR profile_id IS NULL)
           AND dismissed_at IS NULL
           AND scheduled_for <= ?
         ORDER BY scheduled_for DESC
         LIMIT 80`,
        [profile.id, now],
      ),
      d1First<Record<string, unknown>>(
        "SELECT profile_id, in_app_enabled, email_enabled, due_soon_hours, categories FROM notification_preferences WHERE profile_id = ? LIMIT 1",
        [profile.id],
      ),
    ]);

    return NextResponse.json({
      ok: true,
      profileId: profile.id,
      notifications,
      unread: notifications.filter((notification) => !notification.read_at).length,
      preferences: preferences ?? null,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = await requireProfile(request);
    const body = patchSchema.parse(await request.json());
    const placeholders = body.ids.map(() => "?").join(",");
    const now = new Date().toISOString();
    if (body.action === "read") {
      await d1Run(
        `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id IN (${placeholders}) AND (profile_id = ? OR profile_id IS NULL)`,
        [now, ...body.ids, profile.id],
      );
    } else {
      await d1Run(
        `UPDATE notifications SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE id IN (${placeholders}) AND (profile_id = ? OR profile_id IS NULL)`,
        [now, now, ...body.ids, profile.id],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const profile = await requireProfile(request);
    const body = emailPreferenceSchema.parse(await request.json());
    const now = new Date().toISOString();
    await d1Run(
      `INSERT INTO notification_preferences (profile_id, email_enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET email_enabled = excluded.email_enabled, updated_at = excluded.updated_at`,
      [profile.id, body.emailEnabled ? 1 : 0, now],
    );
    const preferences = await d1First<Record<string, unknown>>(
      "SELECT profile_id, in_app_enabled, email_enabled, due_soon_hours, categories FROM notification_preferences WHERE profile_id = ? LIMIT 1",
      [profile.id],
    );
    return NextResponse.json({ ok: true, preferences });
  } catch (error) {
    return errorResponse(error);
  }
}
