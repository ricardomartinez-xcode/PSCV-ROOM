import { NextResponse } from "next/server";
import { errorResponse, requireProfile } from "@/lib/server/authz";
import { getCloudflareEnv } from "@/lib/server/cloudflare";

export async function GET(request: Request) {
  try {
    await requireProfile(request);
    const env = await getCloudflareEnv();
    return NextResponse.json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
