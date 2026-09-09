import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/material-library.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");

test("library starts from semantic collections and groups focused collection screens by section", () => {
  assert.match(source, /const browsingRoot = categoryId === ALL_SECTIONS && sectionId === ALL_SECTIONS && !query\.trim\(\);/);
  assert.match(source, /const shouldGroup = !browsingRoot && sectionId === ALL_SECTIONS && !query\.trim\(\) && sectionGroups\.length > 1;/);
  assert.match(source, /librarySectionGroup/);
  assert.match(source, /SECTION_PREVIEW_LIMIT = 4/);
  assert.match(source, /group\.materials\.slice\(0, SECTION_PREVIEW_LIMIT\)/);
  assert.match(source, /Elige una colección para comenzar/);
  assert.match(source, /Ver todos/);
});

test("library supports semantic collection and full-path section browsing", () => {
  assert.match(source, /const \[categoryId, setCategoryId\] = useState\(ALL_SECTIONS\)/);
  assert.match(source, /buildCategories\(data\?\.materials \?\? \[\]\)/);
  assert.match(source, /categoryKey\(material\.section\)/);
  assert.match(source, /parts\.join\("\/"\)/);
  assert.match(source, /function openSection\(id: string\)/);
  assert.match(source, /setSectionId\(id\)/);
  assert.match(source, /Colección/);
  assert.match(source, /sectionRail/);
});

test("library UI has responsive grouped-section styling", () => {
  assert.match(styles, /\.librarySectionGroup/);
  assert.match(styles, /\.librarySectionHeading/);
  assert.match(styles, /\.materialGrid\.compact/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
