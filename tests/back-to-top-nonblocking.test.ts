import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const calendarStyles = readFileSync(new URL("../app/calendar-responsive.css", import.meta.url), "utf8");

test("back-to-top control sits in the sticky header, never over tables", () => {
  const start = shell.indexOf('<header className="topAppBar"');
  const end = shell.indexOf("</header>", start);
  assert.ok(start >= 0 && end > start);
  assert.ok(shell.slice(start, end).includes("<ScrollToTopButton />"));
  assert.equal(shell.split("<ScrollToTopButton />").length, 2);
  assert.ok(shell.includes('aria-label="Volver arriba"'));
  assert.ok(styles.includes("position: static;"));
  assert.ok(styles.includes(".scrollTopHeaderButton {"));
  assert.ok(!styles.includes(".scrollToTop {"));
  assert.ok(!calendarStyles.includes(".calendarScrollToTop"));
});

test("header reserves click space for the control on mobile", () => {
  assert.ok(styles.includes(".barTitleContent {"));
  assert.ok(styles.includes("flex: 0 0 36px;"));
  assert.ok(styles.includes("flex-basis: 32px;"));
  assert.ok(styles.includes("min-width: 0;"));
});
