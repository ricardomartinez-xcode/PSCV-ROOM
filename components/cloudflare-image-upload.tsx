"use client";

import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";

export type UploadedImage = { id: string; url: string };
export type ImageUploadCategory = "task" | "event" | "announcement";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

export function CloudflareImageUpload({ value, category, label = "Imagen", onChange }: {
  value: UploadedImage | null;
  category: ImageUploadCategory;
  label?: string;
  onChange: (image: UploadedImage | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);

  async function removePendingImage(id: string) {
    await fetch(`/api/admin/images/${encodeURIComponent(id)}?category=${category}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => undefined);
  }

  async function upload(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Usa una imagen JPEG, PNG, WebP, AVIF o GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("La imagen no puede superar 10 MB.");
      return;
    }

    setBusy(true);
    try {
      // The existing R2 binding keeps image uploads operational even when Cloudflare
      // Images billing/permissions or Worker Images secrets are not configured.
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
      const response = await fetch("/api/admin/images/r2", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const result = await response.json() as { image?: UploadedImage; error?: string };
      if (!response.ok || !result.image) {
        throw new Error(result.error ?? "No se pudo subir la imagen al almacenamiento.");
      }
      if (pendingImageId && pendingImageId !== result.image.id) await removePendingImage(pendingImageId);
      setPendingImageId(result.image.id);
      onChange(result.image);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function clear() {
    if (pendingImageId && value?.id === pendingImageId) await removePendingImage(pendingImageId);
    setPendingImageId(null);
    onChange(null);
  }

  return (
    <div className="imageUploadField wide">
      <span className="imageUploadLabel">{label}</span>
      {value ? (
        <div className="imageUploadPreview">
          <img src={value.url} alt="Vista previa de la imagen" />
          <div>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}><ImagePlus size={16} />Reemplazar</button>
            <button type="button" onClick={() => void clear()} disabled={busy}><Trash2 size={16} />Quitar</button>
          </div>
        </div>
      ) : (
        <button className="imageUploadPicker" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle className="imageUploadSpinner" size={20} /> : <ImagePlus size={20} />}
          <span><strong>{busy ? "Subiendo imagen..." : "Seleccionar imagen"}</strong><small>JPEG, PNG, WebP, AVIF o GIF · máximo 10 MB</small></span>
        </button>
      )}
      <input ref={inputRef} className="srOnly" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      {error ? <small className="imageUploadError" role="alert">{error}</small> : null}
    </div>
  );
}
