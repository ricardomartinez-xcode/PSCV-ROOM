import { materialDisplayName } from "@/lib/material-display-name";
import { MATERIALS_R2_BUCKET_NAME, materialR2KeyLookupCandidates, materialSectionPathFromR2Key } from "@/lib/server/r2-paths";

// The bucket is authoritative; D1 remains a searchable, non-destructive index.
// Always finish the entire paginated R2 listing before changing D1.
const MAX_OBJECTS = 50_000;
const WRITE_BATCH_SIZE = 60;
const SKIP_FILE_RE = /(^|\\/)(\\.(DS_Store|keep)$|Thumbs\\.db$)/i;

type BucketFile = { key: string; size: number };
type MaterialIndexRow = {
  id: string;
  r2_key: string;
  r2_missing_at: string | null;
  size_bytes: number | null;
};
type SectionRow = { id: string; path: string };

function isDocument(key: string) {
  const fileName = key.split("/").pop() ?? "";
  return fileName.includes(".") && !SKIP_FILE_RE.test(key);
}

export async function readCompleteR2Inventory(bucket: R2Bucket): Promise<BucketFile[]> {
  const objects: BucketFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    objects.push(...page.objects.map((object) => ({ key: object.key, size: object.size })));
    if (objects.length > MAX_OBJECTS) {
      throw new Error("El inventario R2 excede el límite seguro; no se modificó D1.");
    }
    if (page.truncated && (!page.cursor || page.cursor === cursor)) {
      throw new Error("La paginación R2 no pudo completarse; no se modificó D1.");
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects.filter((object) => isDocument(object.key));
}

function fileProperties(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };
  const materialType = extension === "pdf" ? "PDF"
    : ["png", "jpg", "jpeg", "webp"].includes(extension) ? "Imagen"
    : ["doc", "docx"].includes(extension) ? "Documento"
    : ["ppt", "pptx"].includes(extension) ? "Presentación"
    : ["xls", "xlsx"].includes(extension) ? "Hoja de cálculo" : "Archivo";
  return { contentType: contentTypes[extension] ?? "application/octet-stream", materialType };
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "seccion";
}

async function ensureSection(
  db: D1Database,
  sectionPath: string,
  known: Map<string, string>,
) {
  let parent: string | null = null;
  let path = "";
  for (const [index, part] of sectionPath.split("/").filter(Boolean).entries()) {
    path = path ? `${path}/${part}` : part;
    if (!known.has(path)) {
      const id = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO material_sections (id, parent_id, name, slug, path, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING",
      ).bind(id, parent, part, slug(part), path, index * 100).run();
      const row = await db.prepare("SELECT id FROM material_sections WHERE path = ?").bind(path).first<{ id: string }>();
      if (!row) throw new Error("No se pudo crear la sección de un documento R2.");
      known.set(path, row.id);
    }
    parent = known.get(path) ?? null;
  }
  return parent;
}

async function runStatements(db: D1Database, statements: D1PreparedStatement[]) {
  for (let offset = 0; offset < statements.length; offset += WRITE_BATCH_SIZE) {
    await db.batch(statements.slice(offset, offset + WRITE_BATCH_SIZE));
  }
}

export async function reconcileR2Materials(
  db: D1Database,
  bucket: R2Bucket,
) {
  const objects = await readCompleteR2Inventory(bucket);
  const live = new Map(objects.map((object) => [object.key, object]));
  const existingResult = await db.prepare(
    "SELECT id, r2_key, r2_missing_at, size_bytes FROM materials WHERE provider = 'r2' AND r2_key IS NOT NULL AND (r2_bucket IS NULL OR r2_bucket = ?)",
  ).bind(MATERIALS_R2_BUCKET_NAME).all<MaterialIndexRow>();
  const existing = existingResult.results ?? [];
  const sectionsResult = await db.prepare("SELECT id, path FROM material_sections").all<SectionRow>();
  const sections = new Map((sectionsResult.results ?? []).map((row) => [row.path, row.id]));
  const now = new Date().toISOString();
  const matched = new Set<string>();
  const updates: D1PreparedStatement[] = [];
  let markedMissing = 0;
  let restored = 0;
  let resized = 0;
  let inserted = 0;

  for (const row of existing) {
    const actualKey = materialR2KeyLookupCandidates(row.r2_key)
      .find((candidate) => live.has(candidate));
    if (!actualKey) {
      if (row.r2_missing_at === null) {
        updates.push(db.prepare(
          "UPDATE materials SET r2_missing_at = ?, updated_at = ? WHERE id = ? AND r2_missing_at IS NULL",
        ).bind(now, now, row.id));
        markedMissing += 1;
      }
      continue;
    }
    matched.add(actualKey);
    const size = live.get(actualKey)!.size;
    if (row.r2_missing_at !== null || row.size_bytes !== size) {
      updates.push(db.prepare(
        "UPDATE materials SET r2_missing_at = NULL, size_bytes = ?, updated_at = ? WHERE id = ?",
      ).bind(size, now, row.id));
      if (row.r2_missing_at !== null) restored += 1;
      else resized += 1;
    }
  }

  // Never remove an object from R2, delete a material row, or destroy task links.
  // A missing key is recorded separately from the administrator's visibility choice.
  await runStatements(db, updates);

  for (const object of objects) {
    if (matched.has(object.key)) continue;
    const fileName = object.key.split("/").pop() ?? object.key;
    const folder = materialSectionPathFromR2Key(object.key);
    const sectionId = folder ? await ensureSection(db, folder, sections) : null;
    const { contentType, materialType } = fileProperties(fileName);
    const title = materialDisplayName(
      fileName.replace(/\\.[a-z0-9]{2,8}$/i, "").replace(/[_-]+/g, " ").replace(/\\s+/g, " ").trim(),
    );
    const result = await db.prepare(
      `INSERT INTO materials (id, section_id, title, material_type, visibility, provider,
        r2_bucket, r2_key, file_name, content_type, size_bytes, observations, updated_at)
       VALUES (?, ?, ?, ?, 'visible', 'r2', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(r2_key) DO NOTHING`,
    ).bind(crypto.randomUUID(), sectionId, title, materialType, MATERIALS_R2_BUCKET_NAME,
      object.key, fileName, contentType, object.size, "Sincronizado automáticamente desde R2.", now).run();
    if ((result.meta.changes ?? 0) > 0) inserted += 1;
  }

  return { bucket: MATERIALS_R2_BUCKET_NAME, scanned: objects.length,
    inserted, markedMissing, restored, resized };
}
