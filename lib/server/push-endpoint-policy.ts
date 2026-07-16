const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
] as const;

function normalizedHostname(value: string) {
  const withoutBrackets = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return withoutBrackets.toLowerCase().replace(/\.+$/, "");
}

function ipv4Parts(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4
    || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isRestrictedIpv4(parts: [number, number, number, number]) {
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

function ipv6Groups(hostname: string) {
  if (!hostname.includes(":")) return null;
  if (hostname.includes("%")) return null;

  const halves = hostname.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (value: string) => value
    ? value.split(":").map((part) => {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return Number.NaN;
      return Number.parseInt(part, 16);
    })
    : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if ([...left, ...right].some(Number.isNaN)) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  if (omitted < 1) return null;
  return [...left, ...Array.from({ length: omitted }, () => 0), ...right];
}

function isRestrictedIpv6(hostname: string) {
  const groups = ipv6Groups(hostname);
  if (!groups) return true;

  const first = groups[0];
  // Globally routable unicast currently lives in 2000::/3. Browser push
  // services have no reason to publish loopback, ULA, link-local or multicast
  // literal endpoints.
  if ((first & 0xe000) !== 0x2000) return true;

  // Exclude transition/documentation ranges that can encode another address
  // or are intentionally non-routable.
  if (first === 0x2002) return true; // 6to4
  if (first === 0x2001 && groups[1] === 0x0000) return true; // Teredo
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation

  return false;
}

export function safePushEndpointUrl(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:"
    || (url.port && url.port !== "443")
    || url.username
    || url.password
    || url.hash
  ) {
    return null;
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname) return null;
  if (
    hostname === "localhost"
    || PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return null;
  }

  const ipv4 = ipv4Parts(hostname);
  if (ipv4) return isRestrictedIpv4(ipv4) ? null : url;
  if (hostname.includes(":")) return isRestrictedIpv6(hostname) ? null : url;

  // Single-label names can resolve through a private search domain and are not
  // valid browser push-service endpoints.
  if (!hostname.includes(".")) return null;
  return url;
}

export function isSafePushEndpoint(endpoint: string) {
  return safePushEndpointUrl(endpoint) !== null;
}
