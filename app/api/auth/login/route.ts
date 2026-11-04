import { errorResponse, getAccessIdentity, requireProfileForIdentity } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { createPersistentSession, revokePersistentSession } from "@/lib/server/persistent-session";

export async function GET(request: Request) {
  try {
    const identity = await getAccessIdentity(request);
    const profile = await requireProfileForIdentity(identity);
    const db = await getD1();
    // Replace any prior credential; never accept a caller-selected session ID.
    await revokePersistentSession(db, request);
    const cookie = await createPersistentSession(db, profile.id, identity.subject);
    return new Response(null, {
      status: 303,
      headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": cookie, "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }
}
