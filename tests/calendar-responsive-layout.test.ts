import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/calendar-responsive.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("calendar prevents event tiles expanding to fill oversized month cells", () => {
  assert.match(source, /adaptiveCalendar/);
  assert.match(css, /\.adaptiveCalendar \.calendarPane \.dayCell\s*\{[\s\S]*?height:\s*127px/);
  assert.match(css, /max-height:\s*127px/);
  assert.match(css, /grid-auto-rows:\s*max-content/);
  assert.match(css, /align-content:\s*start/);
  assert.match(css, /\.calendarEvent\.calendarEventItem::before/);
  assert.match(layout, /import "\.\/calendar-responsive\.css"/);
});

test("calendar limits visible day events by breakpoint and opens the complete day dialog", () => {
  assert.match(source, /dayTasks\.slice\(0, 3\)/);
  assert.match(source, /\(\[3, 2, 1\] as const\)\.map/);
  assert.match(source, /setExpandedDay\(key\)/);
  assert.match(source, /openDay\.dayTasks\.map/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /useContainedDialogFocus\(Boolean\(expandedDay\)/);
  assert.match(css, /moreEvents-3/);
  assert.match(css, /moreEvents-2/);
  assert.match(css, /moreEvents-1/);
  assert.match(css, /max-width:\s*1100px/);
  assert.match(css, /max-width:\s*760px/);
});

test("mobile agenda is usable and month mode remains available", () => {
  assert.match(source, /useState<"agenda" \| "month">\("agenda"\)/);
  assert.match(source, /showMobileAgenda/);
  assert.match(source, /showMobileMonth/);
  assert.match(source, /aria-pressed=\{mobileView === "agenda"\}/);
  assert.match(source, /calendarMobileAgenda/);
  assert.match(source, /eventIncludesDate\(task, key\)/);
  assert.match(css, /\.adaptiveCalendar\.showMobileAgenda \.calendarMonthSurface\s*\{\s*display:\s*none/);
});

test("back-to-top navigation stays in the header without covering month entries", () => {
  const start = source.indexOf('<header className="topAppBar"');
  const end = source.indexOf("</header>", start);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.slice(start, end).includes("<ScrollToTopButton />"));
  assert.ok(source.includes('aria-label="Volver arriba"'));
  assert.ok(!css.includes(".calendarScrollToTop"));
});
