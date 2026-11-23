"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Download, Share2, X } from "lucide-react";

import { MAX_IOS_FILE_BYTES, isIOSDownloadPlatform, safeMaterialFileName } from "@/lib/material-mobile-download";

export function MaterialDownloadAction({ url, fileName, contentType, fileSize }: {
  url: string;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
}) {
  const [pending, setPending] = useState(false);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const name = safeMaterialFileName(fileName, contentType ?? "application/octet-stream");

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (readyFile) saveButtonRef.current?.focus();
  }, [readyFile]);

  async function prepareIOSDownload(event: MouseEvent<HTMLAnchorElement>) {
    if (!isIOSDownloadPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return; // Desktop / Android keeps native attachment response.
    event.preventDefault();
    if (pending) return;

    // A user gesture is required for navigator.share. Fetch the protected file
    // first, then offer a SECOND explicit tap to invoke the native iOS share sheet.
    setReadyFile(null);
    setShowFallback(false);
    setMessage(null);

    if (fileSize !== null && fileSize > MAX_IOS_FILE_BYTES) {
      setShowFallback(true);
      setMessage("Este archivo supera el límite de 30 MB para compartir desde la app. Usa la descarga alternativa en Safari.");
      return;
    }
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
      setShowFallback(true);
      setMessage("Este navegador no permite compartir archivos. Puedes intentar la descarga desde Safari.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setPending(true);
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/octet-stream,application/pdf,*/*" },
      });
      if (!response.ok) throw new Error(
        response.status === 401 || response.status === 403
          ? "Tu sesión expiró. Inicia sesión de nuevo."
          : "No se pudo obtener el documento. Inténtalo de nuevo.",
      );
      const responseType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (responseType === "text/html" || responseType === "application/json") {
        throw new Error("El servidor devolvió una página en lugar del archivo.");
      }
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (declaredSize > MAX_IOS_FILE_BYTES) {
        setShowFallback(true);
        setMessage("Archivo grande: utiliza la descarga alternativa desde Safari.");
        return;
      }
      // R2 size_bytes is known for indexed materials; bound the in-memory read
      // to avoid exhausting RAM on iPhone while fetching an untrusted stream.
      const reader = response.body?.getReader();
      let blob: Blob;
      if (reader) {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > MAX_IOS_FILE_BYTES) {
              await reader.cancel();
              throw new Error("El archivo supera 30 MB. Abre el enlace alternativo en Safari.");
            }
            chunks.push(Uint8Array.from(value));
          }
        } finally {
          reader.releaseLock();
        }
        blob = new Blob(chunks, { type: responseType || contentType || "application/octet-stream" });
      } else {
        blob = await response.blob();
        if (blob.size > MAX_IOS_FILE_BYTES) throw new Error("El archivo supera 30 MB.");
      }
      if (controller.signal.aborted) return;
      const file = new File([blob], name, {
        type: responseType || contentType || "application/octet-stream",
      });
      if (!navigator.canShare({ files: [file] })) {
        setShowFallback(true);
        setMessage("iOS no admite compartir este tipo de archivo desde la app.");
        return;
      }
      setReadyFile(file);
      setMessage("Archivo preparado. Toca «Guardar en Archivos» y elige esa opción en el menú de iOS.");
    } catch (error) {
      if (controller.signal.aborted) return;
      setShowFallback(true);
      setMessage(error instanceof Error ? error.message : "No fue posible preparar el archivo.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setPending(false);
    }
  }

  function sharePreparedFile() {
    // IMPORTANT: invoke share synchronously from this click; do not await an
    // upload or fetch here (iOS would reject lost transient user activation).
    if (!readyFile || !navigator.share) return;
    const file = readyFile;
    void navigator.share({ files: [file], title: file.name }).then(() => {
      // Release the potentially large PDF after iOS hands it to the chosen app.
      setReadyFile(null);
      setMessage("Se envió el archivo al destino elegido. Si seleccionaste «Guardar en Archivos», búscalo en la app Archivos.");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("iOS no pudo abrir el menú. Prueba la descarga alternativa desde Safari.");
      setShowFallback(true);
    });
  }

  const showPanel = pending || message !== null || readyFile !== null || showFallback;
  return (
    <>
      <a className="materialDownloadAction" href={url} download={name}
        aria-label={"Descargar " + fileName}
        onClick={(event) => { void prepareIOSDownload(event); }}>
        <Download size={15} aria-hidden="true" /><span>Descargar</span>
      </a>
      {showPanel ? (
        <div className="materialDownloadPanel" role="group" aria-label={"Guardar " + name}>
          <div className="materialDownloadPanelHeading">
            <strong>{pending ? "Preparando archivo…" : "Guardar documento"}</strong>
            {!pending ? <button type="button" className="materialDownloadClose"
              onClick={() => { setReadyFile(null); setMessage(null); setShowFallback(false); }}
              aria-label="Cerrar opciones de descarga"><X size={16} /></button> : null}
          </div>
          {message ? <p role="status">{message}</p> : null}
          {pending ? <p role="status">Obteniendo el documento de forma segura…</p> : null}
          {readyFile ? (
            <button ref={saveButtonRef} type="button" className="materialSaveIOS"
              onClick={sharePreparedFile}>
              <Share2 size={17} aria-hidden="true" /> Guardar en Archivos
            </button>
          ) : null}
          {showFallback || readyFile ? (
            <a className="materialDownloadFallback" href={url} download={name}
              target="_blank" rel="noopener noreferrer">
              Descargar desde el navegador
            </a>
          ) : null}
          {showFallback ? <p className="materialDownloadHint">Si usas PSCV-ROOM desde la pantalla de inicio, abre el enlace en Safari y guarda el archivo en Archivos.</p> : null}
        </div>
      ) : null}
    </>
  );
}
