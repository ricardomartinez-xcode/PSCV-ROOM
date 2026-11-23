/** Browser capability and safe filename helpers for protected material downloads. */
export const MAX_IOS_FILE_BYTES = 30 * 1024 * 1024;

export function isIOSDownloadPlatform(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function safeMaterialFileName(value: string, mimeType: string): string {
  const cleaned = value.split(/[/\\]/).pop()
    ?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().slice(0, 180) || "material";
  if (/\.[a-z0-9]{1,12}$/i.test(cleaned)) return cleaned;
  const extension = mimeType.includes("pdf") ? ".pdf"
    : mimeType.includes("wordprocessingml") ? ".docx"
    : mimeType.includes("msword") ? ".doc"
    : mimeType.includes("presentationml") ? ".pptx"
    : mimeType.includes("spreadsheetml") ? ".xlsx"
    : mimeType.includes("image/png") ? ".png"
    : mimeType.includes("image/jpeg") ? ".jpg"
    : mimeType.includes("image/webp") ? ".webp"
    : "";
  return cleaned + extension;
}
