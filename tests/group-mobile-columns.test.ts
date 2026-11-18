import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const style = readFileSync(new URL("../app/pscv-unified.css", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/server/d1-data.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_pscv_room.sql", import.meta.url), "utf8");

test("group column creation has visible feedback, duplicate protection and explicit D1 persistence", () => {
  assert.match(shell, /className="groupColumnManager"/);
  assert.match(shell, /className="groupColumnCreateForm"/);
  assert.match(shell, /onSubmit=\{\(event\) => void addColumn\(event\)\}/);
  assert.match(shell, /const \[columnBusy, setColumnBusy\] = useState\(false\)/);
  assert.match(shell, /columns\.some\(\(column\) => column\.label\.trim\(\)/);
  assert.match(shell, /if \(d1Client && !usingRemote\)/);
  assert.match(shell, /No se pudo conectar con las columnas de D1/);
  assert.match(shell, /\.from\("group_columns"\)[\s\S]*?\.insert\(/);
  assert.match(shell, /Columna «" \+ label \+ "» creada y guardada en D1/);
  assert.match(shell, /role="status" className="groupColumnMessage"/);
  assert.match(shell, /Reintentar conexión/);
});

test("column metadata and changes can be administered from card mode, not only hidden headers", () => {
  assert.match(shell, /className="groupColumnManagementList"/);
  assert.match(shell, /editingColumnSource === "header"/);
  assert.match(shell, /editingColumnSource === "manager"/);
  assert.match(shell, /className="groupColumnManagementRow"/);
  assert.match(shell, /onClick=\{\(\) => startEditing\(column, "manager"\)\}>Renombrar/);
  assert.match(shell, /onClick=\{\(\) => void saveColumnLabel\(column.id\)\}>Guardar nombre/);
  assert.match(shell, /onClick=\{\(\) => void removeColumn\(column.id\)\}>Eliminar/);
  assert.match(shell, /¿Eliminar la columna/);
  assert.match(style, /\.groupColumnManagementRow strong \{[^}]*overflow-wrap:anywhere/);
});

test("mobile and iOS desktop-layout portrait offers cards and native scrolling table", () => {
  assert.match(shell, /useState<"cards" \| "table">\("cards"\)/);
  assert.match(shell, /aria-pressed=\{groupMobileView === "cards"\}/);
  assert.match(shell, /aria-pressed=\{groupMobileView === "table"\}/);
  assert.match(shell, /groupViewCards/);
  assert.match(shell, /groupViewTable/);
  assert.match(style, /@media \(max-width:760px\), \(hover:none\) and \(pointer:coarse\) and \(orientation:portrait\) and \(max-width:1100px\)/);
  assert.match(style, /\.groupViewCards \.memberTable td::before \{[^}]*content:attr\(data-label\)/);
  assert.match(style, /\.groupTableWrap\.groupViewTable \{[^}]*overflow-x:auto!important/);
  assert.match(style, /\.groupViewTable \.memberTable thead \{[^}]*display:table-header-group!important/);
  assert.match(style, /\.groupTableWrap \.groupColumnHeader span \{[^}]*text-overflow:clip/);
});

test("readers cannot change remote group columns or student values from the UI", () => {
  assert.match(shell, /if \(role !== "admin" \|\| columnBusy\) return/);
  assert.match(shell, /if \(role !== "admin"\) return/);
  assert.match(shell, /disabled=\{role !== "admin"\}/);
  assert.match(shell, /role === "admin" \? \(/);
  assert.match(server, /if \(table === "group_columns" \|\| table === "group_column_values"\)/);
  assert.match(server, /can\(profile, "can_manage_group"\)/);
});

test("database schema stores extensible columns; no numeric max-column rule introduced", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS group_columns/);
  assert.match(migration, /label TEXT NOT NULL/);
  assert.match(migration, /sort_order INTEGER NOT NULL/);
  assert.match(server, /group_columns:\s*\{/);
  assert.doesNotMatch(shell, /MAX_GROUP_COLUMNS|columns\.length\s*>=\s*[0-9]+/);
});
