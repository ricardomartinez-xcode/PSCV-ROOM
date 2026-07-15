"use client";

import { ExternalLink, FileDown, X } from "lucide-react";
import { useEffect, useState } from "react";

type PreviewState = {
  title: string;
  url: string;
} | null;

const selectedByForm = new WeakMap<HTMLFormElement, Set<string>>();
let pendingMaterialIds: string[] | null = null;
let fetchPatched = false;

function isTaskWrite(value: string, method: string) {
  return /\/api\/admin\/tasks(?:\/[^/]+)?(?:\?.*)?$/.test(value)
    && !value.includes("/materials")
    && (method === "POST" || method === "PATCH");
}

function taskIdFromRequest(url: string, method: string, payload: unknown) {
  if (method === "POST") {
    const body = payload as { task?: { id?: unknown } };
    return body.task?.id ? String(body.task.id) : null;
  }

  const match = url.match(/\/api\/admin\/tasks\/([^/?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function installFetchPatch() {
  if (fetchPatched) return;
  fetchPatched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const materialIds = pendingMaterialIds?.slice() ?? [];
    const shouldSync = materialIds.length > 0 && isTaskWrite(url, method);

    const response = await originalFetch(input, init);
    if (!shouldSync || !response.ok) return response;

    try {
      const payload = await response.clone().json().catch(() => ({}));
      const taskId = taskIdFromRequest(url, method, payload);
      if (taskId) {
        await originalFetch(`/api/admin/tasks/${encodeURIComponent(taskId)}/materials`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ materialIds }),
        });
      }
    } finally {
      pendingMaterialIds = null;
    }

    return response;
  };
}

function syncLegacySelect(select: HTMLSelectElement, selected: Set<string>) {
  const first = selected.values().next().value ?? "";
  select.value = first;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function enhanceSelect(select: HTMLSelectElement) {
  if (select.dataset.multiEnhanced === "true") return;
  const form = select.closest("form");
  if (!form) return;

  select.dataset.multiEnhanced = "true";
  const selected = selectedByForm.get(form) ?? new Set<string>();
  selectedByForm.set(form, selected);

  const label = select.closest("label");
  if (label) label.style.display = "none";

  const root = document.createElement("div");
  root.className = "taskMultiMaterialPicker";
  root.innerHTML = `
    <div class="taskMultiMaterialHead">
      <div>
        <strong>Materiales de la tarea</strong>
        <small>Selecciona uno o varios archivos.</small>
      </div>
      <span class="taskMultiMaterialCount">0 seleccionados</span>
    </div>
    <div class="taskMultiMaterialOptions"></div>
  `;

  const optionsRoot = root.querySelector<HTMLDivElement>(".taskMultiMaterialOptions")!;
  const count = root.querySelector<HTMLSpanElement>(".taskMultiMaterialCount")!;

  function render() {
    count.textContent = `${selected.size} ${selected.size === 1 ? "seleccionado" : "seleccionados"}`;
    optionsRoot.replaceChildren();

    for (const option of Array.from(select.options)) {
      if (!option.value) continue;

      const row = document.createElement("label");
      row.className = "taskMultiMaterialOption";
      row.innerHTML = `<input type="checkbox" /><span></span>`;

      const checkbox = row.querySelector<HTMLInputElement>("input")!;
      const text = row.querySelector<HTMLSpanElement>("span")!;
      checkbox.value = option.value;
      checkbox.checked = selected.has(option.value);
      text.textContent = option.textContent ?? option.value;

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(option.value);
        else selected.delete(option.value);
        syncLegacySelect(select, selected);
        render();
      });

      optionsRoot.appendChild(row);
    }
  }

  select.insertAdjacentElement("afterend", root);
  render();

  const observer = new MutationObserver(render);
  observer.observe(select, { childList: true });
}

function isImage(url: string) {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url);
}

export function TaskMaterialExperience() {
  const [preview, setPreview] = useState<PreviewState>(null);

  useEffect(() => {
    installFetchPatch();

    const observer = new MutationObserver(() => {
      for (const select of Array.from(
        document.querySelectorAll<HTMLSelectElement>(
          'select[aria-label="Agregar archivo de materiales del bucket"]',
        ),
      )) {
        enhanceSelect(select);
      }
    });

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const selected = selectedByForm.get(form);
      if (selected?.size) pendingMaterialIds = Array.from(selected);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>(".linkedMaterialList a");
      if (!anchor || !anchor.href) return;

      event.preventDefault();
      setPreview({
        title: anchor.textContent?.trim() || "Material",
        url: anchor.href,
      });
    };

    observer.observe(document.body, { childList: true, subtree: true });
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
        if (event.target === event.currentTarget) setPreview(null);
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
          <button type="button" aria-label="Cerrar" onClick={() => setPreview(null)}>
            <X size={18} />
          </button>
        </header>

        <div className="taskMaterialPreviewBody">
          {isImage(preview.url) ? (
            <img src={preview.url} alt={preview.title} />
          ) : (
            <iframe src={preview.url} title={preview.title} />
          )}
        </div>

        <footer>
          <a href={preview.url} download>
            <FileDown size={16} />
            Descargar
          </a>
          <a href={preview.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Abrir en otra pestaña
          </a>
        </footer>
      </section>
    </div>
  ) : null;
}
