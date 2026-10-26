import { getMaterialsBucket } from "@/lib/server/cloudflare";

const PREFIX = "__pscv_media__/images/";
const VALID_ID = /^r2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpeg|png|webp|avif|gif)$/i;
const ALLOWED = new Map([
  ["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/avif", "avif"], ["image/gif", "gif"],
]);

export function isR2ImageId(id: string) {
  return VALID_ID.test(id);
}

export function r2ImageKey(id: string) {
  if (!isR2ImageId(id)) throw new Error("Identificador de imagen inválido.");
  return PREFIX + id;
}

export async function saveTaskImage(file: File) {
  const mime = file.type.toLowerCase();
  const extension = ALLOWED.get(mime);
  if (!extension || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error("Imagen inválida: JPEG, PNG, WebP, AVIF o GIF, máximo 10 MB.");
  }
  const id = "r2_" + crypto.randomUUID() + "." + extension;
  const key = r2ImageKey(id);
  const bucket = await getMaterialsBucket();
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });
  return { id, url: "/api/media/images/" + encodeURIComponent(id) };
}

export async function fetchTaskImage(id: string) {
  const bucket = await getMaterialsBucket();
  return bucket.get(r2ImageKey(id));
}

export async function removeTaskImage(id: string) {
  const bucket = await getMaterialsBucket();
  await bucket.delete(r2ImageKey(id));
}
