import { errorResponse, getCurrentIdentity, requireProfileForIdentity } from "@/lib/server/authz";

export async function GET(request: Request) {
  try {
    // Verify the Cloudflare Access assertion once, then use that same identity
    // for the database authorization lookup. This avoids a second JWKS request
    // during the post-Microsoft redirect.
    const identity = await getCurrentIdentity(request);
    const profile = await requireProfileForIdentity(identity);

    return Response.json({ authenticated: true, identity: { email: identity.email }, profile });
  } catch (error) {
    return errorResponse(error);
  }
}
