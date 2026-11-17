import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const calendar = readFileSync(new URL("../app/calendar-responsive.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/pscv-unified.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("viewport meta remains device-based and iOS portrait touch devices receive mobile layout", () => {
  assert.match(layout, /width:\s*"device-width"/);
  assert.match(layout, /initialScale:\s*1/);
  assert.match(calendar, /@media \(max-width: 760px\), \(hover: none\) and \(pointer: coarse\) and \(orientation: portrait\) and \(max-width: 1100px\)/);
  assert.match(ui, /@media \(max-width: 760px\), \(hover: none\) and \(pointer: coarse\) and \(orientation: portrait\) and \(max-width: 1100px\)/);
  assert.match(calendar, /\.adaptiveCalendar\.showMobileAgenda \.calendarMonthSurface \{\s*display:\s*none/);
  assert.match(shell, /showMobileAgenda/);
  assert.match(shell, /showMobileMonth/);
});

test("short pages do not reserve a second viewport or duplicate fixed navigation spacing", () => {
  assert.match(ui, /\.pscvUnifiedWorkspace \.screen \{\s*min-height:\s*0;\s*padding-bottom:\s*0;/);
  assert.match(ui, /\.pscvUnifiedWorkspace \{\s*min-height:\s*100svh;\s*padding-bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.bottomNav \{/);
  assert.doesNotMatch(ui, /position:\s*fixed/);
});

test("touch layout makes navigation and controls fit narrow phones without squeezing rows", () => {
  assert.match(ui, /\.pscvUnifiedWorkspace \.pscvSectionPrimary,[\s\S]*?grid-column:\s*1 \/ -1/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.workbenchOverview \{\s*grid-template-columns:\s*repeat\(2, minmax\(0,1fr\)\)/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.taskListFilters \{\s*display:\s*grid;/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.taskListFilters > label:first-child/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.taskListWorkspace \.dataRow \{\s*min-height:\s*82px/);
  assert.match(ui, /\.pscvUnifiedWorkspace \.adaptiveCalendar\.showMobileMonth \.calendarPane \.dayCell/);
});
