import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireProfile } from "@/lib/server/authz";
import { d1Run } from "@/lib/server/d1-data";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }),
});

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Origen no permitido.");
}

function validateEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new HttpError(400, "Endpoint push inválido.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "127.0.0.1") {
    throw new HttpError(400, "Endpoint push inválido.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = subscriptionSchema.parse(await request.json());
    validateEndpoint(body.endpoint);
    const now = new Date().toISOString();
    await d1Run(
      `INSERT INTO push_subscriptions (
         id, profile_id, endpoint, p256dh, auth, user_agent, active, created_at, updated_at, failure_count
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET
         profile_id = excluded.profile_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         active = 1,
         updated_at = excluded.updated_at`,
      [crypto.randomUUID(), profile.id, body.endpoint, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent") ?? "", now, now],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await requireProfile(request);
    const body = z.object({ endpoint: z.string().url() }).parse(await request.json());
    await d1Run(
      `UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE profile_id = ? AND endpoint = ?`,
      [new Date().toISOString(), profile.id, body.endpoint],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
