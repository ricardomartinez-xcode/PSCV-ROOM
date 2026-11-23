import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_IOS_FILE_BYTES,
  isIOSDownloadPlatform,
  safeMaterialFileName,
} from "../lib/material-mobile-download.ts";

const library = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../components/material-download-action.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/materials-explorer.css", import.meta.url), "utf8");
const fileRoute = readFileSync(new URL("../app/api/materials/[id]/file/route.ts", import.meta.url), "utf8");

test("file names retain educational accents, extensions and block path/control characters", () => {
  assert.equal(safeMaterialFileName("Raven/PROTOCOLO RAVEN.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "PROTOCOLO RAVEN.docx");
  assert.equal(safeMaterialFileName("Test de Matrices Progresivas", "application/pdf"), "Test de Matrices Progresivas.pdf");
  assert.equal(safeMaterialFileName("a<>:b.pdf", "application/pdf"), "a___b.pdf");
  assert.equal(safeMaterialFileName("../../trabajo", "application/pdf"), "trabajo.pdf");
  assert.equal(safeMaterialFileName("", "application/pdf"), "material.pdf");
});

test("correctly identifies iPhone, iPad and desktop-mode iPad without touching normal desktops", () => {
  assert.equal(isIOSDownloadPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)", "iPhone", 5), true);
  assert.equal(isIOSDownloadPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad", 5), true);
  assert.equal(isIOSDownloadPlatform("Mozilla/5.0 Macintosh", "MacIntel", 5), true);
  assert.equal(isIOSDownloadPlatform("Mozilla/5.0 Macintosh", "MacIntel", 0), false);
  assert.equal(isIOSDownloadPlatform("Mozilla/5.0 Android", "Linux armv8l", 5), false);
  assert.equal(MAX_IOS_FILE_BYTES, 30 * 1024 * 1024);
});

test("action uses authenticated File sharing only from an explicit second user click", () => {
  assert.match(library, /<MaterialDownloadAction url=\{downloadUrl\}/);
  assert.match(mobile, /download=\{name\}/);
  assert.match(mobile, /if \(!isIOSDownloadPlatform/);
  assert.match(mobile, /event\.preventDefault\(\)/);
  assert.match(mobile, /fetch\(url, \{/);
  assert.match(mobile, /credentials: "include"/);
  assert.match(mobile, /cache: "no-store"/);
  assert.match(mobile, /const file = new File\(\[blob\], name/);
  assert.match(mobile, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(mobile, /onClick=\{sharePreparedFile\}/);
  assert.match(mobile, /void navigator\.share\(\{ files: \[file\], title: file\.name \}\)/);
  assert.match(mobile, /controllerRef\.current\?\.abort\(\)/);
  assert.match(mobile, /reader\.cancel\(\)/);
});

test("mobile action offers a real Safari fallback and displays errors instead of silent failure", () => {
  assert.match(mobile, /role="status"/);
  assert.match(mobile, /Descargar desde el navegador/);
  assert.match(mobile, /Guardar en Archivos/);
  assert.match(mobile, /setShowFallback\(true\)/);
  assert.match(fileRoute, /mode === "download" \? "attachment" : "inline"/);
  assert.match(fileRoute, /await requireProfile\(request\)/);
});

test("responsive buttons do not inherit icon-only 36px span width", () => {
  assert.match(css, /\.materialsExplorer \.materialCardV2 \.materialActions a span \{[^}]*width: auto;[^}]*min-width: 0/);
  assert.match(css, /\.materialsExplorer \.materialCardV2 \.materialActions a\.materialDownloadAction \{[^}]*flex: 1 1 103px/);
  assert.match(css, /\.materialsExplorer \.materialCardV2 \.materialActions \{[^}]*flex-wrap: wrap/);
});
