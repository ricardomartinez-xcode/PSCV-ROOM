import { HttpError } from "@/lib/server/authz";
import { safePushEndpointUrl } from "@/lib/server/push-endpoint-policy";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin) {
    throw new HttpError(403, "Origen no permitido.");
  }
}

export function validatePushEndpoint(endpoint: string) {
  const url = safePushEndpointUrl(endpoint);
  if (!url) throw new HttpError(400, "Endpoint push inválido.");
  return url;
}
