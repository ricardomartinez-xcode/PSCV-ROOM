import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const style = readFileSync(new URL("../app/materials-explorer.css", import.meta.url), "utf8");

test("the initial library displays documents without a mandatory category selection", () => {
  assert.match(source, /browsingRoot \? "Recursos disponibles"/);
  assert.match(source, /!loading && !error && filteredMaterials\.length > 0 && !shouldGroup/);
  assert.match(source, /filteredMaterials\.slice\(0, visibleCount\)/);
  assert.match(source, /setVisibleCount\(\(count\) => count \+ 24\)/);
});

test("the explorer supports keyboard-accessible navigation and returning to all documents", () => {
  assert.match(source, /libraryBreadcrumbs/);
  assert.match(source, /libraryExplorerNav/);
  assert.match(source, /libraryMobileNav/);
  assert.match(source, /function resetNavigation\(\)/);
  assert.match(source, /function selectCategory\(id: string\)/);
  assert.match(source, /aria-current=/);
  assert.match(source, /aria-pressed=/);
});

test("filters, sorting and actions are usable without modifying any material data", () => {
  assert.match(source, /function materialFileType\(material: LibraryMaterial\)/);
  assert.match(source, /fileType === "all" \|\| materialFileType\(material\) === fileType/);
  assert.match(source, /size-desc/);
  assert.match(source, /Detalles del archivo/);
  assert.match(source, /noopener noreferrer/);
  assert.match(source, /fetch\(\x60\/api\/materials\/library\?/);
  assert.doesNotMatch(source, /fetch\(\x60\/api\/admin\/materials\//);
});

test("responsive library styles support a desktop collection rail and mobile navigation", () => {
  assert.match(style, /\.libraryWorkbench/);
  assert.match(style, /\.libraryExplorerNav/);
  assert.match(style, /\.libraryMobileNav/);
  assert.match(style, /@media \(max-width: 760px\)/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)/);
});

test("upload and management entrypoint is restricted to authorized users", () => {
  const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
  assert.match(source, /onManage\?: \(\) => void/);
  assert.match(source, /onClick=\{onManage\}/);
  assert.match(shell, /capabilities\.canAccessAdmin && capabilities\.canManageMaterials/);
  assert.match(shell, /setInitialAdminTab\("materials"\)/);
  assert.match(shell, /go\("admin"\)/);
});
