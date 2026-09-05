import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBodyScrollLockManager } from "../lib/body-scroll-lock.ts";

const accessibility = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const diagnostics = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const materials = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");

test("nested overlays keep the body locked until the last overlay closes", () => {
  const style = { overflow: "auto" };
  const manager = createBodyScrollLockManager(() => style);
  const releaseFirst = manager.acquire();
  const releaseSecond = manager.acquire();

  assert.equal(style.overflow, "hidden");
  releaseFirst();
  assert.equal(style.overflow, "hidden");
  releaseSecond();
  assert.equal(style.overflow, "auto");

  releaseSecond();
  assert.equal(style.overflow, "auto");
});

test("the page remains the primary vertical scroll container", () => {
  assert.match(accessibility, /html,\s*\nbody\s*\{[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*auto;/s);
  assert.match(accessibility, /\.mobileApp,\s*\n\.screen\s*\{[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s);
  assert.match(accessibility, /body\s*\{[^}]*overscroll-behavior-y:\s*auto;/s);
});

test("nested data panels let vertical trackpad gestures chain to their parent", () => {
  assert.match(materials, /\.taskMaterialOptions\s*\{[^}]*overscroll-behavior-y:\s*auto;/s);
  assert.doesNotMatch(materials, /\.taskMaterialOptions\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(diagnostics, /\.diagnosticDetailsBody\s*\{[^}]*overscroll-behavior-y:\s*auto;/s);
  assert.doesNotMatch(diagnostics, /\.diagnosticDetailsBody\s*\{[^}]*overscroll-behavior:\s*contain;/s);
});

test("notification content has a dedicated scrollable body", () => {
  assert.match(shell, /className={`notificationTrayBody/);
  assert.match(notifications, /\.notificationTrayBody\.settings\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(notifications, /\.notificationList\s*\{[^}]*overflow-y:\s*auto;/s);
});
