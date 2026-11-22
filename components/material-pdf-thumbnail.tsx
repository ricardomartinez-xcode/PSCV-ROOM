"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_SIMULTANEOUS_PDFS = 2;

let activeRenders = 0;
const pendingRenders: Array<() => void> = [];

function runWithLimit<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let queued = false;
    const cancelled = () => {
      if (!queued) return;
      const index = pendingRenders.indexOf(start);
      if (index >= 0) pendingRenders.splice(index, 1);
      queued = false;
      reject(new DOMException("Miniatura cancelada", "AbortError"));
    };
    const start = () => {
      queued = false;
      signal.removeEventListener("abort", cancelled);
      if (signal.aborted) {
        reject(new DOMException("Miniatura cancelada", "AbortError"));
        return;
      }
      activeRenders += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        activeRenders -= 1;
        const next = pendingRenders.shift();
        next?.();
      });
    };
    if (signal.aborted) {
      reject(new DOMException("Miniatura cancelada", "AbortError"));
    } else if (activeRenders < MAX_SIMULTANEOUS_PDFS) {
      start();
    } else {
      queued = true;
      pendingRenders.push(start);
      signal.addEventListener("abort", cancelled, { once: true });
    }
  });
}

async function readPdfWithLimit(response: Response): Promise<Uint8Array> {
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_PREVIEW_BYTES) throw new Error("PDF demasiado grande para miniatura");
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_PREVIEW_BYTES) throw new Error("PDF demasiado grande para miniatura");
    return new Uint8Array(data);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PREVIEW_BYTES) throw new Error("PDF demasiado grande para miniatura");
      chunks.push(value);
    }
    const data = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.byteLength;
    }
    return data;
  } finally {
    reader.releaseLock();
  }
}

export function MaterialPdfThumbnail({ url, fileName, fileSize }: {
  url: string;
  fileName: string;
  fileSize: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  // Never fetch hundreds of documents when the library is opened.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "180px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || (fileSize !== null && fileSize > MAX_PREVIEW_BYTES)) return;
    // Public external files cannot be read cross-origin. R2 stays behind the
    // authenticated same-origin endpoint and is never sent to third parties.
    if (!url.startsWith("/api/materials/")) return;
    const controller = new AbortController();
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    let cancelRender: (() => void) | null = null;

    void runWithLimit(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/pdf" },
        signal: controller.signal,
      });
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/pdf")) {
        throw new Error("No se pudo leer la vista previa PDF");
      }
      const bytes = await readPdfWithLimit(response);
      if (controller.signal.aborted) return;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc =
        new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
      loadingTask = task;
      try {
        const document = await task.promise;
        if (controller.signal.aborted) return;
        const page = await document.getPage(1);
        const initialViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 240 / initialViewport.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(viewport.width * ratio));
        canvas.height = Math.max(1, Math.round(viewport.height * ratio));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        cancelRender = () => renderTask.cancel();
        await renderTask.promise;
        if (!controller.signal.aborted) setRendered(true);
      } finally {
        // Keep only painted canvas pixels; free PDF pages and worker memory.
        if (loadingTask === task) {
          loadingTask = null;
          await task.destroy().catch(() => undefined);
        }
      }
    }, controller.signal).catch(() => {
      // A PDF may be encrypted, damaged or beyond the device memory budget.
      // Keep the neutral icon instead of misrepresenting the actual content.
    });

    return () => {
      controller.abort();
      cancelRender?.();
      const toDestroy = loadingTask;
      loadingTask = null;
      void toDestroy?.destroy();
    };
  }, [visible, url, fileSize]);

  return (
    <div className={"materialThumb pdfRenderedThumb" + (rendered ? " hasPreview" : "")}
      ref={containerRef}>
      <canvas ref={canvasRef} aria-label={"Primera página de " + fileName}
        role="img" className={rendered ? "pdfCanvasReady" : "pdfCanvasLoading"} />
      {!rendered ? <span className="pdfThumbnailFallback" aria-hidden="true">
        <FileText size={20} /><span>PDF</span>
      </span> : null}
    </div>
  );
}
