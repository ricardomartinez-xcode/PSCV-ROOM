import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireProfile } from "@/lib/server/authz";
import { d1Run } from "@/lib/server/d1-data";
import { assertSameOrigin, validatePushEndpoint } from "@/lib/server/push-security";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }),
});

const endpointSchema = z.object({ endpoint: z.string().url().max(2048) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = subscriptionSchema.parse(await request.json());
    validatePushEndpoint(body.endpoint);
    const now = new Date().toISOString();
    const result = await d1Run(
      `INSERT INTO push_subscriptions (
         id, profile_id, endpoint, p256dh, auth, user_agent, active, created_at, updated_at, failure_count
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         active = 1,
         failure_count = 0,
         updated_at = excluded.updated_at
       WHERE push_subscriptions.profile_id = excluded.profile_id`,
      [crypto.randomUUID(), profile.id, body.endpoint, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent") ?? "", now, now],
    );
    if (Number(result.meta?.changes ?? 0) === 0) {
      throw new HttpError(409, "La suscripción ya está vinculada a otro perfil.");
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = endpointSchema.parse(await request.json());
    validatePushEndpoint(body.endpoint);
    await d1Run(
      `UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE profile_id = ? AND endpoint = ?`,
      [new Date().toISOString(), profile.id, body.endpoint],
    );
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
