const MATERIAL_UUID_PREFIX = /^[\s_]*[0-9a-f]{8}(?:[\s_-]+[0-9a-f]{4}){3}[\s_-]+[0-9a-f]{12}(?=$|[\s_.-])/i;
const EXTENSION_ONLY = /^\.[a-z0-9]{2,8}$/i;

export function materialDisplayName(value: string | null | undefined, fallback = "Documento sin nombre") {
  const normalized = (value ?? "").replace(/^_+/, "").trim();
  if (!normalized) return fallback;

  const withoutWorkerId = normalized
    .replace(MATERIAL_UUID_PREFIX, "")
    .replace(/^[\s_-]+/, "")
    .trim();

  if (!withoutWorkerId || EXTENSION_ONLY.test(withoutWorkerId)) return fallback;
  return withoutWorkerId;
}
