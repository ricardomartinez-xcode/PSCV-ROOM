import { errorResponse, getCurrentIdentity, requireProfileForIdentity } from "@/lib/server/authz";
import { renewedSessionCookie } from "@/lib/server/persistent-session";

export async function GET(request: Request) {
  try {
    const identity = await getCurrentIdentity(request);
    const profile = await requireProfileForIdentity(identity);
    const headers = new Headers({ "Cache-Control": "no-store, private", Vary: "Cookie" });
    const cookie = renewedSessionCookie(request);
    if (cookie) headers.set("Set-Cookie", cookie);
    return Response.json({ authenticated: true, identity: { email: identity.email }, profile }, { headers });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }
}
