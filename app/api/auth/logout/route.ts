import { errorResponse, HttpError } from "@/lib/server/authz";
import { getD1 } from "@/lib/server/cloudflare";
import { revokePersistentSession } from "@/lib/server/persistent-session";

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      throw new HttpError(403, "Origen no permitido.");
    }
    const cookie = await revokePersistentSession(await getD1(), request);
    return Response.json({ authenticated: false }, {
      headers: { "Set-Cookie": cookie, "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
