import { NextResponse } from "next/server";
import { errorResponse, requireProfile } from "@/lib/server/authz";
import { getCloudflareEnv } from "@/lib/server/cloudflare";
import { isVapidConfigured } from "@/lib/server/web-push";

export async function GET(request: Request) {
  try {
    await requireProfile(request);
    const env = await getCloudflareEnv();
    const enabled = isVapidConfigured(env);
    return NextResponse.json({
      ok: true,
      enabled,
      publicKey: enabled ? env.VAPID_PUBLIC_KEY ?? null : null,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
