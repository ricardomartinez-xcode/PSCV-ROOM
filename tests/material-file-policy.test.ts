import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DIRECT_MATERIAL_BYTES,
  validateMaterialUpload,
} from "../lib/material-file-policy.ts";

test("material uploads accept known educational formats", () => {
  assert.deepEqual(validateMaterialUpload({
    fileName: "lectura.pdf",
    contentType: "application/pdf",
    size: 1024,
  }), { ok: true, contentType: "application/pdf" });
  assert.equal(validateMaterialUpload({
    fileName: "datos.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 2048,
  }).ok, true);
});

test("material uploads reject active content, mismatched MIME and oversized bodies", () => {
  assert.equal(validateMaterialUpload({ fileName: "ataque.html", contentType: "text/html", size: 10 }).ok, false);
  assert.equal(validateMaterialUpload({ fileName: "ataque.svg", contentType: "image/svg+xml", size: 10 }).ok, false);
  assert.equal(validateMaterialUpload({ fileName: "falso.pdf", contentType: "text/html", size: 10 }).ok, false);
  assert.equal(validateMaterialUpload({
    fileName: "grande.pdf",
    contentType: "application/pdf",
    size: MAX_DIRECT_MATERIAL_BYTES + 1,
  }).ok, false);
});
