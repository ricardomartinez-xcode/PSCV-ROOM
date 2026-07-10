import { HttpError } from "@/lib/server/authz";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin) {
    throw new HttpError(403, "Origen no permitido.");
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function validatePushEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new HttpError(400, "Endpoint push inválido.");
  }
  if (
    hostname === "localhost"
    || hostname === "::1"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || isPrivateIpv4(hostname)
  ) {
    throw new HttpError(400, "Endpoint push inválido.");
  }
  return url;
}
