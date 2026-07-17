import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

test("task notes are presented as prominent instructions", () => {
  const source = fs.readFileSync(path.join(root, "components/app-shell-v5.tsx"), "utf8");
  assert.match(source, /className="taskInstructions"/);
  assert.match(source, />Instrucciones<\/h3>/);
  assert.doesNotMatch(source, /label="Notas"/);
  assert.doesNotMatch(source, />Notas<textarea/);
});

test("mobile styles prevent detail overflow", () => {
  const css = fs.readFileSync(path.join(root, "app/workspace.css"), "utf8");
  assert.match(css, /\.taskInstructions\s*\{/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.taskDetailScreen,[\s\S]*?max-width:\s*100%/);
});
