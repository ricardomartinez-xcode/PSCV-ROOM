import { getCloudflareEnv } from "@/lib/server/cloudflare";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export type ImageCategory = "task" | "event" | "announcement";

type CloudflareEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
};

type DirectUploadResult = { id: string; uploadURL: string };
type ImageDetails = {
  id: string;
  draft?: boolean;
  variants?: string[];
  filename?: string;
  uploaded?: string;
};

async function configuration() {
  const env = await getCloudflareEnv();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_IMAGES_API_TOKEN?.trim(); // gitleaks:allow
  if (!accountId || !token) {
    throw new Error("Cloudflare Images no está configurado. Agrega CLOUDFLARE_IMAGES_API_TOKEN y CLOUDFLARE_ACCOUNT_ID.");
  }
  return { accountId, token };
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const { accountId, token } = await configuration();
  const headers = new Headers(init.headers);
  headers.set("Authorization", ["Bearer", token].join(" "));
  const response = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json() as CloudflareEnvelope<T>;
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(detail || `Cloudflare Images respondió ${response.status}.`);
  }
  return payload.result;
}

export async function createDirectImageUpload(input: { creatorId: string; category: ImageCategory }) {
  const form = new FormData();
  form.set("requireSignedURLs", "false");
  form.set("creator", input.creatorId);
  form.set("metadata", JSON.stringify({ category: input.category, app: "pscv-room" }));
  return apiRequest<DirectUploadResult>("/images/v2/direct_upload", { method: "POST", body: form });
}

export async function getCloudflareImage(imageId: string) {
  const image = await apiRequest<ImageDetails>(`/images/v1/${encodeURIComponent(imageId)}`);
  const variants = image.variants ?? [];
  const url = variants.find((variant) => variant.endsWith("/public")) ?? variants[0] ?? null;
  return { ...image, url };
}

export async function deleteCloudflareImage(imageId: string) {
  await apiRequest<unknown>(`/images/v1/${encodeURIComponent(imageId)}`, { method: "DELETE" });
}
