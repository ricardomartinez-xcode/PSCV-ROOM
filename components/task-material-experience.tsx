"use client";

import { ExternalLink, FileDown, X } from "lucide-react";
import { useEffect, useState } from "react";

type Material = {
  id: string;
  title: string;
  file_name?: string | null;
  content_type?: string | null;
  preview_url?: string | null;
  public_url?: string | null;
  source_url?: string | null;
  section?: { name?: string | null } | null;
};

type PreviewState = {
  title: string;
  previewUrl: string;
  downloadUrl: string;
  contentType?: string | null;
} | null;

type MaterialPayload = {
  materials?: Material[];
  error?: string;
};

const selectedByForm = new WeakMap<HTMLFormElement, Set<string>>();
const touchedByForm = new WeakMap<HTMLFormElement, boolean>();
let pendingMaterialIds: string[] | null = null;
let fetchPatched = false;

function isTaskWrite(url: string, method: string) {
  return /\/api\/admin\/tasks(?:\/[^/?]+)?(?:\?.*)?$/.test(url)
    && !url.includes("/materials")
    && (method === "POST" || method === "PATCH");
}

function taskIdFromResponse(url: string, method: string, payload: unknown) {
  if (method === "POST") {
    const body = payload as { task?: { id?: unknown } };
    return body.task?.id ? String(body.task.id) : null;
  }

  const match = url.match(/\/api\/admin\/tasks\/([^/?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function syncTaskMaterials(
  originalFetch: typeof window.fetch,
  taskId: string,
  desiredIds: string[],
) {
  const currentResponse = await originalFetch(
    `/api/admin/tasks/${encodeURIComponent(taskId)}/materials`,
    { credentials: "include" },
  );
  const currentBody = await currentResponse.json().catch(() => ({})) as {
    error?: string;
    materials?: Array<{ materials?: { id?: unknown } }>;
  };

  if (!currentResponse.ok) {
    throw new Error(
      currentBody.error ?? "No se pudieron consultar los materiales enlazados.",
    );
  }

  const currentIds = new Set(
    (currentBody.materials ?? [])
      .map((row) => row.materials?.id)
      .filter(Boolean)
      .map(String),
  );
  const desired = new Set(desiredIds);
  const toAdd = [...desired].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desired.has(id));

  for (const [method, materialIds] of [
    ["POST", toAdd],
    ["DELETE", toRemove],
  ] as const) {
    if (!materialIds.length) continue;

    const response = await originalFetch(
      `/api/admin/tasks/${encodeURIComponent(taskId)}/materials`,
      {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialIds }),
      },
    );
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (!response.ok) {
      throw new Error(
        body.error ?? "No se pudieron sincronizar los materiales.",
      );
    }
  }
}

function installFetchPatch() {
  if (fetchPatched) return;
  fetchPatched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (
      init?.method
      ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const desiredIds = pendingMaterialIds?.slice() ?? null;
    const shouldSync =
      desiredIds !== null
      && isTaskWrite(url, method);

    const response = await originalFetch(input, init);

    if (!shouldSync || !response.ok) {
      return response;
    }

    try {
      const payload = await response.clone().json().catch(() => ({}));
      const taskId = taskIdFromResponse(url, method, payload);

      if (taskId) {
        await syncTaskMaterials(originalFetch, taskId, desiredIds);
      }
    } finally {
      pendingMaterialIds = null;
    }

    return response;
  };
}

function materialPreviewUrl(material: Material) {
  return (
    material.preview_url
    ?? material.public_url
    ?? material.source_url
    ?? ""
  );
}

function materialDownloadUrl(material: Material) {
  return (
    material.public_url
    ?? material.source_url
    ?? material.preview_url
    ?? ""
  );
}

function linkedIdsFromForm(form: HTMLFormElement) {
  const ids = new Set<string>();

  for (const anchor of Array.from(
    form.querySelectorAll<HTMLAnchorElement>(".linkedMaterialList a"),
  )) {
    const match = anchor.href.match(/\/api\/materials\/([^/]+)\/file/);
    if (match?.[1]) ids.add(decodeURIComponent(match[1]));
  }

  return ids;
}

function syncLegacySelect(
  select: HTMLSelectElement,
  selected: Set<string>,
) {
  const first = selected.values().next().value ?? "";
  select.value = first;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function enhanceSelect(select: HTMLSelectElement) {
  if (select.dataset.multiEnhanced === "true") return;

  const form = select.closest("form");
  if (!form) return;

  select.dataset.multiEnhanced = "true";

  const initial = linkedIdsFromForm(form);
  if (select.value) initial.add(select.value);

  const selected = selectedByForm.get(form) ?? initial;
  selectedByForm.set(form, selected);
  touchedByForm.set(form, false);

  const label = select.closest("label");
  if (label) label.style.display = "none";

  const root = document.createElement("div");
  root.className = "taskMultiMaterialPicker";
  root.innerHTML = `
    <div class="taskMultiMaterialHead">
      <div>
        <strong>Materiales de la actividad</strong>
        <small>Selecciona uno o varios archivos del bucket.</small>
      </div>
      <span class="taskMultiMaterialCount">0 seleccionados</span>
    </div>
    <label class="taskMultiMaterialSearch">
      <span>Buscar en materiales</span>
      <input type="search" placeholder="Nombre del archivo o carpeta" />
    </label>
    <div class="taskMultiMaterialStatus">Cargando materiales...</div>
    <div class="taskMultiMaterialOptions"></div>
  `;

  const search = root.querySelector<HTMLInputElement>(
    ".taskMultiMaterialSearch input",
  )!;
  const status = root.querySelector<HTMLDivElement>(
    ".taskMultiMaterialStatus",
  )!;
  const optionsRoot = root.querySelector<HTMLDivElement>(
    ".taskMultiMaterialOptions",
  )!;
  const count = root.querySelector<HTMLSpanElement>(
    ".taskMultiMaterialCount",
  )!;

  let materials: Material[] = [];
  let requestToken = 0;

  function render() {
    count.textContent =
      `${selected.size} ${
        selected.size === 1 ? "seleccionado" : "seleccionados"
      }`;
    optionsRoot.replaceChildren();

    for (const material of materials) {
      const row = document.createElement("label");
      row.className = "taskMultiMaterialOption";
      row.innerHTML = `
        <input type="checkbox" />
        <span>
          <strong></strong>
          <small></small>
        </span>
      `;

      const checkbox = row.querySelector<HTMLInputElement>("input")!;
      const title = row.querySelector<HTMLElement>("strong")!;
      const detail = row.querySelector<HTMLElement>("small")!;

      checkbox.value = material.id;
      checkbox.checked = selected.has(material.id);
      title.textContent = material.title;
      detail.textContent =
        material.section?.name
        ?? material.file_name
        ?? "Material";

      checkbox.addEventListener("change", () => {
        touchedByForm.set(form, true);

        if (checkbox.checked) selected.add(material.id);
        else selected.delete(material.id);

        syncLegacySelect(select, selected);
        render();
      });

      optionsRoot.appendChild(row);
    }

    status.textContent = materials.length
      ? `${materials.length} materiales disponibles`
      : "No se encontraron materiales en el bucket.";
  }

  async function loadMaterials(query = "") {
    const token = ++requestToken;
    status.textContent = "Cargando materiales...";

    try {
      const params = new URLSearchParams({ limit: "500" });
      if (query.trim()) params.set("q", query.trim());

      const response = await fetch(
        `/api/materials/library?${params.toString()}`,
        { credentials: "include" },
      );
      const body = await response.json().catch(() => ({})) as MaterialPayload;

      if (!response.ok || body.error) {
        throw new Error(
          body.error ?? "No se pudieron cargar los materiales.",
        );
      }

      if (token !== requestToken) return;
      materials = body.materials ?? [];
      render();
    } catch (error) {
      if (token !== requestToken) return;
      materials = [];
      optionsRoot.replaceChildren();
      status.textContent =
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los materiales.";
    }
  }

  let searchTimer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(
      () => void loadMaterials(search.value),
      250,
    );
  });

  select.insertAdjacentElement("afterend", root);
  void loadMaterials();
}

function isImage(contentType: string | null | undefined, url: string) {
  return contentType?.startsWith("image/")
    || /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url);
}

export function TaskMaterialExperience() {
  const [preview, setPreview] = useState<PreviewState>(null);

  useEffect(() => {
    installFetchPatch();

    const enhanceAllMaterialSelectors = () => {
      for (const select of Array.from(
        document.querySelectorAll<HTMLSelectElement>(
          'select[aria-label="Agregar archivo de materiales del bucket"]',
        ),
      )) {
        enhanceSelect(select);
      }
    };

    enhanceAllMaterialSelectors();

    const observer = new MutationObserver(
      enhanceAllMaterialSelectors,
    );

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      const selected = selectedByForm.get(form);
      const touched = touchedByForm.get(form);

      if (selected && (selected.size > 0 || touched)) {
        pendingMaterialIds = Array.from(selected);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>(
        ".linkedMaterialList a",
      );
      if (!anchor || !anchor.href) return;

      event.preventDefault();

      const previewUrl = anchor.href.replace(
        /mode=download\b/,
        "mode=preview",
      );

      setPreview({
        title: anchor.textContent?.trim() || "Material",
        previewUrl,
        downloadUrl: anchor.href,
      });
    };

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return preview ? (
    <div
      className="taskMaterialPreviewBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setPreview(null);
        }
      }}
    >
      <section
        className="taskMaterialPreview"
        role="dialog"
        aria-modal="true"
        aria-label={preview.title}
      >
        <header>
          <div>
            <small>Vista previa</small>
            <strong>{preview.title}</strong>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setPreview(null)}
          >
            <X size={18} />
          </button>
        </header>

        <div className="taskMaterialPreviewBody">
          {isImage(preview.contentType, preview.previewUrl) ? (
            <img
              src={preview.previewUrl}
              alt={preview.title}
            />
          ) : (
            <iframe
              src={preview.previewUrl}
              title={preview.title}
            />
          )}
        </div>

        <footer ~
          <a href={preview.downloadUrl} download>
            <FileDown size={16} />
            Descargar
          </a>
          <a href={preview.previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Abrir en otra pestaña
          </a>
        </footer>
      </section>
    </div>
  ) : null;
}
