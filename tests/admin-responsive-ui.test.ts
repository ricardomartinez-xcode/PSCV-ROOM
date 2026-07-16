import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportsCss = readFileSync(new URL("../app/admin-reports.css", import.meta.url), "utf8");
const diagnosticsCss = readFileSync(new URL("../app/admin-diagnostics.css", import.meta.url), "utf8");
const workspacesCss = readFileSync(new URL("../app/admin-workspaces.css", import.meta.url), "utf8");

test("report tables and admin tabs remain operable at narrow widths", () => {
  assert.match(reportsCss, /\.adminTabs[\s\S]*overflow/);
  assert.match(reportsCss, /\.adminTabs button[\s\S]*min-height: 44px/);
  assert.match(reportsCss, /\.reportTableWrap[\s\S]*overflow: auto/);
  assert.match(reportsCss, /\.reportTableWrap table[\s\S]*min-width: 720px/);
  assert.match(reportsCss, /@media \(max-width: 760px\)/);
  assert.match(reportsCss, /@media \(max-width: 420px\)/);
  assert.match(reportsCss, /\.reportToolbar[\s\S]*grid-template-columns: 1fr/);
  assert.match(reportsCss, /prefers-reduced-motion: reduce/);
});

test("diagnostic controls keep touch targets and collapse without clipping", () => {
  assert.match(diagnosticsCss, /\.diagnosticDetails summary[\s\S]*min-height: 44px/);
  assert.match(diagnosticsCss, /\.diagnosticActions button,[\s\S]*min-height: 44px/);
  assert.match(diagnosticsCss, /\.diagnosticDetailsBody[\s\S]*overflow: auto/);
  assert.match(diagnosticsCss, /@media \(max-width: 860px\)/);
  assert.match(diagnosticsCss, /@media \(max-width: 420px\)/);
  assert.match(diagnosticsCss, /\.diagnosticPills[\s\S]*grid-template-columns: 1fr/);
});

test("tasks, calendar and materials share responsive controls and mobile agenda", () => {
  assert.match(workspacesCss, /\.adminWorkspaceToolbar[\s\S]*grid-template-columns/);
  assert.match(workspacesCss, /\.adminWorkspaceToolbar select,[\s\S]*min-height: 44px/);
  assert.match(workspacesCss, /\.adminCalendarScroll[\s\S]*overflow: auto/);
  assert.match(workspacesCss, /\.adminCalendarGrid[\s\S]*min-width: 770px/);
  assert.match(workspacesCss, /\.adminCalendarAgenda[\s\S]*display: none/);
  assert.match(workspacesCss, /@media \(max-width: 700px\)[\s\S]*\.adminCalendarScroll[\s\S]*display: none/);
  assert.match(workspacesCss, /@media \(max-width: 700px\)[\s\S]*\.adminCalendarAgenda[\s\S]*display: grid/);
  assert.match(workspacesCss, /\.adminMaterialActions a[\s\S]*min-height: 40px/);
  assert.match(workspacesCss, /@media \(max-width: 700px\)[\s\S]*\.adminMaterialActions a[\s\S]*min-height: 44px/);
  assert.match(workspacesCss, /@media \(max-width: 420px\)/);
});
