import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/app-shell-v5.tsx", import.meta.url), "utf8");
const accessibility = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");

test("drawer and notification dialogs contain focus and restore it on close", () => {
  assert.match(shell, /function useContainedDialogFocus/);
  assert.match(shell, /data-dialog-autofocus/);
  assert.match(shell, /previousFocusRef\.current\?\.focus\(\)/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /aria-modal=/);
  assert.match(shell, /inert=\{drawerOpen \|\| notificationOpen/);
});

test("notification refresh announces a concise status instead of the interactive list", () => {
  assert.match(shell, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(shell, /className="notificationList" aria-live/);
  assert.match(accessibility, /\.srOnly/);
});

test("task creation focus initializes once and does not reset while typing", () => {
  assert.match(shell, /useContainedDialogFocus\(open, dialogRef, onClose\)/);
  assert.match(shell, /data-dialog-autofocus value=\{form\.title\}/);
  assert.doesNotMatch(shell, /\}, \[onClose, open\]\);/);
});
