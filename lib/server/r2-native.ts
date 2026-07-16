import { getCloudflareEnv, getMaterialsBucket } from "@/lib/server/cloudflare";
import {
  encodeMaterialR2KeyForUrl,
  materialR2KeyLookupCandidates,
  normalizeMaterialR2Key,
} from "@/lib/server/r2-paths";

export type NativeR2ListedObject = {
  key: string;
  size: number;
  lastModified: Date | null;
  etag: string | null;
};

function publicUrl(baseUrl: string | undefined, key: string) {
  const base = baseUrl?.trim().replace(/\/$/, "");
  if (!base) return null;
  return `${base}/${encodeMaterialR2KeyForUrl(key)}`;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean)));
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parentPrefix(key: string) {
  const parts = key.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}

function basename(key: string) {
  return key.split("/").filter(Boolean).pop() ?? key;
}

function comparable(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function createNativePublicR2Url(key: string | null | undefined) {
  if (!key) return null;
  const env = await getCloudflareEnv();
  return publicUrl(env.R2_PUBLIC_BASE_URL, key);
}

export async function listNativeR2Objects(prefix = "", limit = 1000): Promise<NativeR2ListedObject[]> {
  const bucket = await getMaterialsBucket();
  const objects: Array<{ key: string; size: number; lastModified: Date; etag: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: Math.min(limit - objects.length, 1000), cursor });
    objects.push(...page.objects.map((object) => ({ key: object.key, size: object.size, lastModified: object.uploaded, etag: object.etag })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objects.length < limit);
  return objects;
}

export async function listNativeR2FolderPrefixes(prefix = "", limit = 50000) {
  const root = normalizeMaterialR2Key(prefix);
  const rootPrefix = root ? `${root}/` : "";
  const folders = new Set<string>();
  const objects = await listNativeR2Objects(rootPrefix, limit);

  if (root) folders.add(root);
  for (const object of objects) {
    const parts = object.key.split("/").filter(Boolean);
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!root || current === root || current.startsWith(rootPrefix)) folders.add(current);
    }
  }

  return Array.from(folders).sort((a, b) => a.localeCompare(b, "es"));
}

export async function putNativeR2Object(input: { key: string; body: ReadableStream | ArrayBuffer | string; contentType?: string; contentDisposition?: string }) {
  const bucket = await getMaterialsBucket();
  const key = normalizeMaterialR2Key(input.key);
  if (!key) throw new Error("Clave R2 inválida.");
  await bucket.put(key, input.body, { httpMetadata: { contentType: input.contentType, contentDisposition: input.contentDisposition } });
  // Object access stays behind the authenticated material file route. Do not
  // mint or persist a public-bucket URL as part of the upload response.
  return { key, publicUrl: null };
}

export async function getNativeR2Object(key: string) {
  const bucket = await getMaterialsBucket();
  if (!key) return null;
  return bucket.get(key);
}

export async function resolveNativeR2ObjectKey(input: { key: string; fileName?: string | null; title?: string | null }) {
  const decodedKey = safeDecode(input.key);
  const normalizedKey = normalizeMaterialR2Key(decodedKey);
  const exactCandidates = materialR2KeyLookupCandidates(input.key);

  for (const candidate of exactCandidates) {
    // R2 object keys are opaque. Always try the persisted/raw key before any
    // decoded or canonical legacy fallback.
    if (await getNativeR2Object(candidate)) return candidate;
  }

  const targetNames = unique([
    basename(input.key),
    basename(decodedKey),
    basename(normalizedKey),
    input.fileName ?? undefined,
    input.title ?? undefined,
  ]).map(comparable).filter(Boolean);

  const prefixes = Array.from(new Set([
    parentPrefix(input.key),
    parentPrefix(decodedKey),
    parentPrefix(normalizeMaterialR2Key(input.key)),
    parentPrefix(normalizedKey),
  ].filter((value) => value.length > 0)));

  const comparableMatches = new Set<string>();

  for (const prefix of prefixes) {
    const objects = await listNativeR2Objects(prefix, 10000);
    for (const object of objects) {
      if (exactCandidates.includes(object.key)) return object.key;
      if (targetNames.includes(comparable(basename(object.key)))) comparableMatches.add(object.key);
    }
  }

  if (comparableMatches.size === 1) return [...comparableMatches][0];
  if (comparableMatches.size > 1) {
    throw new Error("La reparación R2 encontró más de un archivo con el mismo nombre.");
  }

  throw new Error(`No se encontró el objeto R2. Key intentada: ${normalizedKey}`);
}

export async function deleteNativeR2Object(key: string) {
  const bucket = await getMaterialsBucket();
  if (!key) throw new Error("Clave R2 inválida.");
  await bucket.delete(key);
}
