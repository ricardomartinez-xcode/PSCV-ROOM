export const MAX_DIRECT_MATERIAL_BYTES = 50 * 1024 * 1024;

const CONTENT_TYPES_BY_EXTENSION: Record<string, readonly string[]> = {
  avif: ["image/avif"],
  bmp: ["image/bmp"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  gif: ["image/gif"],
  jpeg: ["image/jpeg"],
  jpg: ["image/jpeg"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odt: ["application/vnd.oasis.opendocument.text"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  rtf: ["application/rtf", "text/rtf"],
  txt: ["text/plain"],
  webp: ["image/webp"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

export const MATERIAL_UPLOAD_ACCEPT = Object.keys(CONTENT_TYPES_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

export function validateMaterialUpload(input: {
  fileName: string;
  contentType: string;
  size: number;
}) {
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false as const, error: "El archivo está vacío." };
  }
  if (input.size > MAX_DIRECT_MATERIAL_BYTES) {
    return { ok: false as const, error: "El archivo supera el límite de 50 MB para carga directa." };
  }

  const extension = input.fileName.trim().toLowerCase().split(".").at(-1) ?? "";
  const allowedTypes = CONTENT_TYPES_BY_EXTENSION[extension];
  if (!allowedTypes) {
    return { ok: false as const, error: "Formato no permitido para materiales." };
  }

  const contentType = input.contentType.trim().toLowerCase().split(";", 1)[0];
  if (contentType && contentType !== "application/octet-stream" && !allowedTypes.includes(contentType)) {
    return { ok: false as const, error: "El tipo del archivo no coincide con su extensión." };
  }

  return {
    ok: true as const,
    contentType: contentType && contentType !== "application/octet-stream"
      ? contentType
      : allowedTypes[0],
  };
}
