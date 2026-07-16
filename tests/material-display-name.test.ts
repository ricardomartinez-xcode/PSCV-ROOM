import assert from "node:assert/strict";
import test from "node:test";
import { materialDisplayName } from "../lib/material-display-name.ts";

test("material display names hide Worker UUID prefixes without changing the stored value", () => {
  const storedTitle = "8b24f640 10b0 4346 85df 1d2a695eb293 sesion 17 18 dinamizando los grupos 1";

  assert.equal(materialDisplayName(storedTitle), "sesion 17 18 dinamizando los grupos 1");
  assert.equal(storedTitle, "8b24f640 10b0 4346 85df 1d2a695eb293 sesion 17 18 dinamizando los grupos 1");
});

test("material display names support raw R2 filenames and safe empty fallbacks", () => {
  assert.equal(
    materialDisplayName("cae89917-9bf2-417c-8831-5ae34bec71eb-sesion-21-tecnicas-grupales.pdf"),
    "sesion-21-tecnicas-grupales.pdf",
  );
  assert.equal(materialDisplayName("cae89917-9bf2-417c-8831-5ae34bec71eb.pdf"), "Documento sin nombre");
  assert.equal(materialDisplayName("Sesion 21 tecnicas grupales"), "Sesion 21 tecnicas grupales");
});
