import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const mobileDownload = readFileSync(new URL("../components/material-download-action.tsx", import.meta.url), "utf8");
const thumbnail = readFileSync(new URL("../components/material-pdf-thumbnail.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/materials-explorer.css", import.meta.url), "utf8");
const fileRoute = readFileSync(new URL("../app/api/materials/[id]/file/route.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../app/api/materials/library/route.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("opening is inline, downloading is attachment, not two visually identical links", () => {
  assert.match(library, /const previewUrl = safeMaterialUrl\(material\.preview_url/);
  assert.match(library, /const downloadUrl = material\.r2_key/);
  assert.match(library, /className="materialOpenAction" href=\{openUrl\}/);
  assert.match(library, /<MaterialDownloadAction url=\{downloadUrl\}/);
  assert.match(mobileDownload, /className="materialDownloadAction" href=\{url\}/);
  assert.match(library, /<span>Abrir<\/span>/);
  assert.match(mobileDownload, /<span>Descargar<\/span>/);
  assert.doesNotMatch(library, /<span>Vista previa<\/span>/);
  assert.match(fileRoute, /mode === "download" \? "attachment" : "inline"/);
  assert.match(catalog, /download_url: signedDownloadUrl/);
  assert.match(catalog, /preview_url: signedPreviewUrl/);
});

test("PDF thumbnail uses the real first page and authenticated lazy fetching", () => {
  assert.match(library, /return <MaterialPdfThumbnail key=\{material\.id\}/);
  assert.match(thumbnail, /new IntersectionObserver/);
  assert.match(thumbnail, /MAX_SIMULTANEOUS_PDFS = 2/);
  assert.match(thumbnail, /MAX_PREVIEW_BYTES = 20 \* 1024 \* 1024/);
  assert.match(thumbnail, /url\.startsWith\("\/api\/materials\/"\)/);
  assert.match(thumbnail, /credentials: "include"/);
  assert.match(thumbnail, /cache: "no-store"/);
  assert.match(thumbnail, /await document\.getPage\(1\)/);
  assert.match(thumbnail, /page\.render\(\{/);
  assert.match(thumbnail, /controller\.abort\(\)/);
  assert.match(thumbnail, /cancelRender\?\.\(\)/);
  assert.match(styles, /\.materialThumb\.pdfRenderedThumb canvas/);
  assert.equal(packageJson.dependencies["pdfjs-dist"], "5.7.284");
});

test("PDF.js worker is self-hosted by the application build rather than external CDN", () => {
  assert.match(thumbnail, /await import\("pdfjs-dist"\)/);
  assert.match(thumbnail, /new URL\("pdfjs-dist\/build\/pdf\.worker\.min\.mjs", import\.meta\.url\)/);
  assert.doesNotMatch(thumbnail, /unpkg|cdnjs|jsdelivr/);
});

test("PDF fallback and source URL validation remain safe for private libraries", () => {
  assert.match(library, /function safeMaterialUrl/);
  assert.match(library, /parsed\.protocol === "https:" \|\| parsed\.protocol === "http:"/);
  assert.match(library, /const openUrl = previewUrl && \(!material\.r2_key \|\| isPdf \|\| isImage\)/);
  assert.match(thumbnail, /pdfThumbnailFallback/);
  assert.match(fileRoute, /const profile = await requireProfile\(request\)/);
  assert.match(fileRoute, /data\.visibility !== "visible"/);
  assert.match(fileRoute, /"cache-control", "private, no-store"/);
});
