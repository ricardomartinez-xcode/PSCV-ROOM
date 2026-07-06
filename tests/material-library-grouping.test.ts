import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/material-library.css", import.meta.url), "utf8");

test("library groups the all-areas screen by academic section", () => {
  assert.match(source, /const shouldGroup = sectionId === ALL_SECTIONS && !query\.trim\(\) && sectionGroups\.length > 1;/);
  assert.match(source, /librarySectionGroup/);
  assert.match(source, /SECTION_PREVIEW_LIMIT = 6/);
  assert.match(source, /Ver todos/);
});

test("library keeps a direct category view for focused browsing", () => {
  assert.match(source, /function openSection\(id: string\)/);
  assert.match(source, /setSectionId\(id\)/);
  assert.match(source, /sectionRail/);
});

test("library UI has responsive grouped-section styling", () => {
  assert.match(styles, /\.librarySectionGroup/);
  assert.match(styles, /\.librarySectionHeading/);
  assert.match(styles, /\.materialGrid\.compact/);
});
