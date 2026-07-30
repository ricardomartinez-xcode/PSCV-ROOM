import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASE = "pscv-room";
const BUCKET = "psicologia";
const execute = process.env.MIGRATION_CONFIRM === "MIGRATE";
const workdir = mkdtempSync(join(tmpdir(), "pscv-r2-migration-"));
const report = {
  mode: execute ? "execute" : "dry-run",
  startedAt: new Date().toISOString(),
  copied: [],
  reused: [],
  failures: [],
  moves: [],
};

function runWrangler(args, options = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: process.env,
    maxBuffer: 1024 * 1024 * 50,
  });
}

function tryWrangler(args) {
  return spawnSync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 50,
  });
}

function parseRows(raw) {
  const parsed = JSON.parse(raw);
  const root = Array.isArray(parsed) ? parsed : parsed.result ?? parsed;
  const block = Array.isArray(root) ? root[0] : root;
  return block?.results ?? block?.result?.[0]?.results ?? [];
}

function basename(key) {
  return key.split("/").filter(Boolean).at(-1) ?? key;
}

function stripUuidPrefix(name) {
  return name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

function normalizeTail(tail) {
  return tail.split("/").filter(Boolean).map((part) => stripUuidPrefix(part.trim())).join("/");
}

function psychometric(name) {
  const value = name.toLocaleLowerCase("es");
  return [
    "test", "prueba", "cuestionario", "escala", "manual", "cuadernillo",
    "protocolo", "wais", "stai", "rosenberg", "hamilton", "psicometr",
    "instrumento", "hoja de respuesta", "plantilla", "nacad",
  ].some((token) => value.includes(token));
}

function mapKey(source) {
  const roots = [
    ["Alteraciones de la conducta/", "Materiales de clase/Sexto cuatrimestre/Alteraciones de la Conducta/"],
    ["Evaluacion Psicológica I/", "Materiales de clase/Sexto cuatrimestre/Evaluación Psicológica I/"],
    ["Evaluación Psicológica I/", "Materiales de clase/Sexto cuatrimestre/Evaluación Psicológica I/"],
    ["Procesos Grupales/", "Materiales de clase/Sexto cuatrimestre/Teoría y Práctica de Procesos Grupales/"],
    ["Teorias del Aprendizaje/", "Materiales de clase/Sexto cuatrimestre/Psicología del Aprendizaje/"],
    ["Teorías del Aprendizaje/", "Materiales de clase/Sexto cuatrimestre/Psicología del Aprendizaje/"],
  ];
  for (const [prefix, target] of roots) {
    if (source.startsWith(prefix)) return target + normalizeTail(source.slice(prefix.length));
  }

  const compendio = "Compendio de Psicología/";
  const relative = source.startsWith(compendio) ? source.slice(compendio.length) : source;
  const cleaned = normalizeTail(relative);
  const file = basename(cleaned);
  if (psychometric(cleaned)) {
    const psychTail = cleaned
      .replace(/^Test, cuestionarios, etc\//i, "")
      .replace(/^Articulos de Investigación\s*\//i, "")
      .replace(/^Psicología Clínica\//i, "");
    return `Recursos Generales/Psicometría/${psychTail}`;
  }
  const mappings = [
    [/^Articulos de Investigación\s*\//i, "Recursos Generales/Investigación y Metodología/Artículos de investigación/"],
    [/^Criminología\//i, "Recursos Generales/Psicología Jurídica y Forense/"],
    [/^Pscopatologías\//i, "Recursos Generales/Psicopatología/"],
    [/^Psicología Clínica\//i, "Recursos Generales/Psicología Clínica/"],
    [/^Psicologia educativa\//i, "Recursos Generales/Psicología Educativa/"],
    [/^Psicología general\//i, "Recursos Generales/Psicología General/"],
    [/^Psicología organizacional\//i, "Recursos Generales/Psicología Organizacional/"],
  ];
  for (const [pattern, target] of mappings) {
    if (pattern.test(cleaned)) return target + cleaned.replace(pattern, "");
  }
  if (/metodolog|\bapa\b|investig/i.test(cleaned)) return `Recursos Generales/Investigación y Metodología/${file}`;
  if (/crimin|forense|jur[ií]d|perfilaci[oó]n|conducta criminal/i.test(cleaned)) return `Recursos Generales/Psicología Jurídica y Forense/${file}`;
  if (/organiz|recursos humanos|talento humano|capital humano/i.test(cleaned)) return `Recursos Generales/Psicología Organizacional/${file}`;
  if (/educa|docente|enseñanza|aprendizaje/i.test(cleaned)) return `Recursos Generales/Psicología Educativa/${file}`;
  if (/psicopat|psicosis|trastorno|psiquiatr/i.test(cleaned)) return `Recursos Generales/Psicopatología/${file}`;
  if (/cl[ií]nic|terapia|psicoterapia|duelo|autismo/i.test(cleaned)) return `Recursos Generales/Psicología Clínica/${file}`;
  return `Recursos Generales/Psicología General/${file}`;
}

function sectionFor(target) {
  const sections = [
    ["Recursos Generales/Psicología General/", "section-resources-general"],
    ["Recursos Generales/Psicología Clínica/", "section-resources-clinical"],
    ["Recursos Generales/Psicopatología/", "section-resources-psychopathology"],
    ["Recursos Generales/Psicología Educativa/", "section-resources-educational"],
    ["Recursos Generales/Psicología Organizacional/", "section-resources-organizational"],
    ["Recursos Generales/Psicología Jurídica y Forense/", "section-resources-legal"],
    ["Recursos Generales/Investigación y Metodología/", "section-resources-research"],
    ["Recursos Generales/Psicometría/", "section-resources-psychometrics"],
    ["Materiales de clase/Sexto cuatrimestre/Alteraciones de la Conducta/", "section-sixth-conduct"],
    ["Materiales de clase/Sexto cuatrimestre/Evaluación Psicológica I/", "section-sixth-assessment"],
    ["Materiales de clase/Sexto cuatrimestre/Teoría y Práctica de Procesos Grupales/", "section-sixth-groups"],
    ["Materiales de clase/Sexto cuatrimestre/Psicología del Aprendizaje/", "section-sixth-learning"],
    ["Materiales de clase/Sexto cuatrimestre/Psicología en la Problemática Social Mexicana/", "section-sixth-social"],
  ];
  return sections.find(([prefix]) => target.startsWith(prefix))?.[1] ?? "section-resources-general";
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

try {
  const raw = runWrangler([
    "d1", "execute", DATABASE, "--remote", "--json",
    "--command", "SELECT id,title,r2_key FROM materials WHERE provider='r2' AND r2_key IS NOT NULL ORDER BY r2_key",
  ]);
  const rows = parseRows(raw);
  if (rows.length !== 153) throw new Error(`Se esperaban 153 materiales R2 y D1 devolvió ${rows.length}.`);

  const destinations = new Map();
  for (const row of rows) {
    const target = mapKey(row.r2_key);
    if (!target || target === row.r2_key) throw new Error(`Ruta sin migrar: ${row.r2_key}`);
    const existing = destinations.get(target);
    if (existing && existing !== row.r2_key) throw new Error(`Colisión: ${existing} y ${row.r2_key} -> ${target}`);
    destinations.set(target, row.r2_key);
    report.moves.push({ id: row.id, source: row.r2_key, target, sectionId: sectionFor(target) });
  }

  if (!execute) {
    writeFileSync("r2-migration-report.json", JSON.stringify(report, null, 2));
    console.log(`Simulacro correcto: ${report.moves.length} objetos, sin colisiones.`);
    process.exit(0);
  }

  for (const [index, move] of report.moves.entries()) {
    const sourceFile = join(workdir, `${index}-source.bin`);
    const targetFile = join(workdir, `${index}-target.bin`);
    runWrangler(["r2", "object", "get", `${BUCKET}/${move.source}`, "--file", sourceFile, "--remote"]);
    const sourceHash = hash(sourceFile);

    const existing = tryWrangler(["r2", "object", "get", `${BUCKET}/${move.target}`, "--file", targetFile, "--remote"]);
    if (existing.status === 0) {
      const targetHash = hash(targetFile);
      if (targetHash !== sourceHash) throw new Error(`Destino existente con contenido distinto: ${move.target}`);
      report.reused.push({ ...move, sha256: sourceHash });
    } else {
      runWrangler(["r2", "object", "put", `${BUCKET}/${move.target}`, "--file", sourceFile, "--remote"]);
      runWrangler(["r2", "object", "get", `${BUCKET}/${move.target}`, "--file", targetFile, "--remote"]);
      const targetHash = hash(targetFile);
      if (targetHash !== sourceHash) throw new Error(`Hash distinto después de copiar: ${move.target}`);
      report.copied.push({ ...move, sha256: sourceHash });
    }
    rmSync(sourceFile, { force: true });
    rmSync(targetFile, { force: true });
    console.log(`[${index + 1}/${report.moves.length}] verificado: ${move.target}`);
  }

  const now = new Date().toISOString();
  const sections = [
    ["section-resources", "Recursos Generales", "Recursos Generales", null, 10],
    ["section-resources-general", "Psicología General", "Recursos Generales/Psicología General", "section-resources", 11],
    ["section-resources-clinical", "Psicología Clínica", "Recursos Generales/Psicología Clínica", "section-resources", 12],
    ["section-resources-psychopathology", "Psicopatología", "Recursos Generales/Psicopatología", "section-resources", 13],
    ["section-resources-educational", "Psicología Educativa", "Recursos Generales/Psicología Educativa", "section-resources", 14],
    ["section-resources-organizational", "Psicología Organizacional", "Recursos Generales/Psicología Organizacional", "section-resources", 15],
    ["section-resources-legal", "Psicología Jurídica y Forense", "Recursos Generales/Psicología Jurídica y Forense", "section-resources", 16],
    ["section-resources-research", "Investigación y Metodología", "Recursos Generales/Investigación y Metodología", "section-resources", 17],
    ["section-resources-psychometrics", "Psicometría", "Recursos Generales/Psicometría", "section-resources", 18],
    ["section-class-materials", "Materiales de clase", "Materiales de clase", null, 30],
    ["section-sixth", "Sexto cuatrimestre", "Materiales de clase/Sexto cuatrimestre", "section-class-materials", 31],
    ["section-sixth-conduct", "Alteraciones de la Conducta", "Materiales de clase/Sexto cuatrimestre/Alteraciones de la Conducta", "section-sixth", 32],
    ["section-sixth-assessment", "Evaluación Psicológica I", "Materiales de clase/Sexto cuatrimestre/Evaluación Psicológica I", "section-sixth", 33],
    ["section-sixth-groups", "Teoría y Práctica de Procesos Grupales", "Materiales de clase/Sexto cuatrimestre/Teoría y Práctica de Procesos Grupales", "section-sixth", 34],
    ["section-sixth-learning", "Psicología del Aprendizaje", "Materiales de clase/Sexto cuatrimestre/Psicología del Aprendizaje", "section-sixth", 35],
    ["section-sixth-social", "Psicología en la Problemática Social Mexicana", "Materiales de clase/Sexto cuatrimestre/Psicología en la Problemática Social Mexicana", "section-sixth", 36],
  ];

  const statements = ["BEGIN TRANSACTION;"];
  for (const [id, name, path, parent, order] of sections) {
    statements.push(`INSERT INTO material_sections (id,name,path,parent_id,sort_order,active,created_at,updated_at) VALUES (${sql(id)},${sql(name)},${sql(path)},${parent ? sql(parent) : "NULL"},${order},1,${sql(now)},${sql(now)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,parent_id=excluded.parent_id,sort_order=excluded.sort_order,active=1,updated_at=excluded.updated_at;`);
  }
  const newIds = sections.map(([id]) => sql(id)).join(",");
  statements.push(`UPDATE material_sections SET active=0,updated_at=${sql(now)} WHERE id NOT IN (${newIds});`);
  for (const move of report.moves) {
    statements.push(`UPDATE materials SET r2_key=${sql(move.target)},section_id=${sql(move.sectionId)},updated_at=${sql(now)} WHERE id=${sql(move.id)} AND r2_key=${sql(move.source)};`);
  }
  statements.push("COMMIT;");
  const sqlFile = join(workdir, "apply.sql");
  writeFileSync(sqlFile, statements.join("\n"));
  runWrangler(["d1", "execute", DATABASE, "--remote", "--file", sqlFile]);

  const verifyRaw = runWrangler([
    "d1", "execute", DATABASE, "--remote", "--json",
    "--command", "SELECT COUNT(*) AS total, COUNT(DISTINCT r2_key) AS unique_keys, SUM(CASE WHEN r2_key LIKE 'Recursos Generales/%' OR r2_key LIKE 'Materiales de clase/%' THEN 1 ELSE 0 END) AS migrated FROM materials WHERE provider='r2' AND r2_key IS NOT NULL",
  ]);
  report.databaseVerification = parseRows(verifyRaw)[0];
  if (Number(report.databaseVerification?.migrated) !== 153) throw new Error("D1 no confirmó las 153 rutas migradas.");
  report.finishedAt = new Date().toISOString();
  writeFileSync("r2-migration-report.json", JSON.stringify(report, null, 2));
  console.log(`Migración no destructiva completada: ${report.copied.length} copiados, ${report.reused.length} reutilizados.`);
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  report.finishedAt = new Date().toISOString();
  writeFileSync("r2-migration-report.json", JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
