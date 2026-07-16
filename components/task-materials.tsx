"use client";

import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { materialDisplayName } from "@/lib/material-display-name";

export type TaskMaterialSection = {
  id: string;
  name: string;
  path: string;
  color: string | null;
};

export type TaskMaterial = {
  id: string;
  title: string;
  material_type: string | null;
  provider: string | null;
  source_url: string | null;
  preview_url: string | null;
  download_url?: string | null;
  thumbnail_url: string | null;
  public_url?: string | null;
  r2_key: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  section_id?: string | null;
  section?: TaskMaterialSection | null;
};

type MaterialLibraryPayload = {
  ok?: boolean;
  materials?: TaskMaterial[];
  error?: string;
};

type TaskMaterialPickerProps = {
  selectedIds: string[];
  initialMaterials?: TaskMaterial[];
  onChange: (ids: string[]) => void;
};

const EMPTY_MATERIALS: TaskMaterial[] = [];
const MAX_TASK_MATERIALS = 50;

function mergeMaterials(current: TaskMaterial[], incoming: TaskMaterial[]) {
  const byId = new Map(current.map((material) => [material.id, material]));
  for (const material of incoming) byId.set(material.id, material);
  return [...byId.values()];
}

function safeResourceUrl(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function materialPreviewUrl(material: TaskMaterial) {
  if (material.r2_key) {
    return `/api/materials/${encodeURIComponent(material.id)}/file?mode=preview`;
  }
  return safeResourceUrl(material.preview_url ?? material.public_url ?? material.source_url);
}

function materialDownloadUrl(material: TaskMaterial) {
  if (material.r2_key) {
    return `/api/materials/${encodeURIComponent(material.id)}/file?mode=download`;
  }
  return safeResourceUrl(material.download_url ?? material.public_url ?? material.source_url ?? material.preview_url);
}

function materialDetail(material: TaskMaterial) {
  const section = material.section?.name || material.section?.path;
  const file = material.file_name ? materialDisplayName(material.file_name) : material.material_type || "Recurso";
  return section ? `${section} · ${file}` : file;
}

export function TaskMaterialPicker({
  selectedIds,
  initialMaterials,
  onChange,
}: TaskMaterialPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskMaterial[]>([]);
  const [knownMaterials, setKnownMaterials] = useState<TaskMaterial[]>(() => initialMaterials ?? EMPTY_MATERIALS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setKnownMaterials((current) => mergeMaterials(current, initialMaterials ?? EMPTY_MATERIALS));
  }, [initialMaterials]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({ limit: "500" });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/materials/library?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({})) as MaterialLibraryPayload;
        if (!response.ok || body.error) {
          throw new Error(body.error ?? "No se pudieron cargar los materiales del bucket.");
        }
        const materials = body.materials ?? [];
        setResults(materials);
        setKnownMaterials((current) => mergeMaterials(current, materials));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los materiales del bucket.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 220 : 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, reloadToken]);

  const selected = useMemo(() => {
    const byId = new Map(knownMaterials.map((material) => [material.id, material]));
    return selectedIds.map((id) => byId.get(id)).filter((material): material is TaskMaterial => Boolean(material));
  }, [knownMaterials, selectedIds]);

  function toggle(materialId: string) {
    if (!selectedIds.includes(materialId) && selectedIds.length >= MAX_TASK_MATERIALS) return;
    onChange(
      selectedIds.includes(materialId)
        ? selectedIds.filter((id) => id !== materialId)
        : [...selectedIds, materialId],
    );
  }

  return (
    <fieldset className="taskMaterialPicker wide" aria-describedby="task-material-picker-help">
      <legend>Materiales de la actividad</legend>
      <p id="task-material-picker-help">
        Selecciona uno o varios recursos del bucket. Puedes buscarlos por archivo, carpeta o sección.
      </p>

      <div className="taskMaterialPickerToolbar">
        <label className="taskMaterialSearch">
          <span>Buscar materiales</span>
          <span className="taskMaterialSearchControl">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Archivo, carpeta o sección"
            />
          </span>
        </label>
        <button
          type="button"
          className="taskMaterialRefresh"
          onClick={() => setReloadToken((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Recargar
        </button>
      </div>

      <div className="taskMaterialPickerStatus" role="status" aria-live="polite">
        <span>
          {loading
            ? "Consultando el bucket…"
            : `${results.length} ${results.length === 1 ? "material disponible" : "materiales disponibles"}`}
        </span>
        <strong>{selectedIds.length} de {MAX_TASK_MATERIALS} seleccionados</strong>
      </div>

      {loadError ? <p className="taskMaterialError" role="alert">{loadError}</p> : null}

      <div className="taskMaterialOptions">
        {results.map((material) => {
          const checked = selectedIds.includes(material.id);
          const selectionLimitReached = !checked && selectedIds.length >= MAX_TASK_MATERIALS;
          return (
            <label className={`taskMaterialOption ${checked ? "selected" : ""}`} key={material.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={selectionLimitReached}
                onChange={() => toggle(material.id)}
              />
              <FileText size={18} aria-hidden="true" />
              <span>
                <strong>{materialDisplayName(material.title)}</strong>
                <small>{materialDetail(material)}</small>
              </span>
            </label>
          );
        })}
        {!loading && !loadError && !results.length ? (
          <div className="taskMaterialEmpty">
            <FileText size={20} aria-hidden="true" />
            <span>{query.trim() ? "No hay coincidencias. Prueba con otra carpeta o archivo." : "No hay materiales indexados. Un administrador puede usar Materiales → Sincronizar bucket."}</span>
          </div>
        ) : null}
      </div>

      {selected.length ? (
        <div className="taskMaterialSelection" aria-label="Materiales seleccionados">
          {selected.map((material) => (
            <span key={material.id}>
              <span>{materialDisplayName(material.title)}</span>
              <button type="button" aria-label={`Quitar ${materialDisplayName(material.title)}`} onClick={() => toggle(material.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

function canRenderAsImage(material: TaskMaterial) {
  return /^(image\/(?:avif|bmp|gif|jpeg|png|webp))(?:;|$)/i.test(material.content_type ?? "")
    || /\.(avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(material.file_name ?? material.title);
}

function canRenderAsPdf(material: TaskMaterial) {
  return /^(application\/pdf)(?:;|$)/i.test(material.content_type ?? "")
    || /\.pdf(?:[?#]|$)/i.test(material.file_name ?? material.title);
}

export function TaskMaterialGallery({ materials }: { materials: TaskMaterial[] }) {
  const [preview, setPreview] = useState<TaskMaterial | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!preview) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [preview]);

  if (!materials.length) return null;

  const previewUrl = preview ? materialPreviewUrl(preview) : null;
  const downloadUrl = preview ? materialDownloadUrl(preview) : null;
  const previewIsInline = preview ? canRenderAsImage(preview) || canRenderAsPdf(preview) : false;

  return (
    <>
      <div className="taskMaterialGallery" aria-label="Materiales de la actividad">
        {materials.map((material) => {
          const itemPreviewUrl = materialPreviewUrl(material);
          const itemDownloadUrl = materialDownloadUrl(material);
          return (
            <article className="taskMaterialCard" key={material.id}>
              <FileText size={20} aria-hidden="true" />
              <div>
                <strong>{materialDisplayName(material.title)}</strong>
                <small>{materialDetail(material)}</small>
              </div>
              <div className="taskMaterialCardActions">
                {itemPreviewUrl ? (
                  <button type="button" onClick={() => setPreview(material)}>
                    <Eye size={16} aria-hidden="true" />
                    Vista previa
                  </button>
                ) : null}
                {itemDownloadUrl ? (
                  <a href={itemDownloadUrl} download>
                    <Download size={16} aria-hidden="true" />
                    Descargar
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {preview ? (
        <div
          className="taskMaterialPreviewBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <section
            ref={dialogRef}
            className="taskMaterialPreviewDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-material-preview-title"
          >
            <header>
              <div>
                <small>Vista previa del material</small>
                <strong id="task-material-preview-title">{materialDisplayName(preview.title)}</strong>
              </div>
              <button ref={closeButtonRef} type="button" aria-label="Cerrar vista previa" onClick={() => setPreview(null)}>
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="taskMaterialPreviewBody">
              {previewUrl && canRenderAsImage(preview) ? (
                <img src={previewUrl} alt={materialDisplayName(preview.title)} referrerPolicy="no-referrer" />
              ) : previewUrl && canRenderAsPdf(preview) ? (
                <iframe
                  src={previewUrl}
                  title={`Vista previa de ${materialDisplayName(preview.title)}`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  tabIndex={-1}
                />
              ) : (
                <div className="taskMaterialPreviewUnavailable" role="status">
                  <FileText size={34} aria-hidden="true" />
                  <strong>Vista previa segura no disponible</strong>
                  <p>Este formato se conserva para descarga, pero no se ejecuta dentro de PSCV Room.</p>
                </div>
              )}
            </div>
            <footer>
              {downloadUrl ? (
                <a href={downloadUrl} download>
                  <Download size={16} aria-hidden="true" />
                  Descargar
                </a>
              ) : null}
              {previewUrl && previewIsInline ? (
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} aria-hidden="true" />
                  Abrir aparte
                </a>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
