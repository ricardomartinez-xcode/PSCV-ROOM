import { NextResponse } from "next/server";
import { z } from "zod";
import { getD1 } from "@/lib/server/cloudflare";
import { listNativeR2Objects, type NativeR2ListedObject } from "@/lib/server/r2-native";
import {
  MATERIALS_R2_BUCKET_NAME,
  MATERIALS_R2_ROOT,
  materialSectionPathFromR2Key,
  normalizeMaterialImportRoot,
} from "@/lib/server/r2-paths";
import { errorResponse, HttpError, requirePermission } from "@/lib/server/authz";
import { d1All, d1Run } from "@/lib/server/d1-data";

type ImportRequest = {
  dryRun?: boolean;
  root?: string;
  maxItems?: number;
  batchSize?: number;
  reset?: boolean;
  resetScope?: "r2" | "all";
  confirm?: string;
};

const importRequestSchema = z.object({
  dryRun: z.boolean().optional(),
  root: z.string().trim().max(1024).optional(),
  maxItems: z.number().int().min(1).max(50_000).optional(),
  batchSize: z.number().int().min(1).max(100).optional(),
  reset: z.boolean().optional(),
  resetScope: z.enum(["r2", "all"]).optional(),
  confirm: z.string().max(64).optional(),
}).strict();

type SectionRow = { id: string; path: string };
type MaterialRow = { id: string; r2_key: string | null };
type ImportableObject = NativeR2ListedObject & {
  fileName: string;
  sectionPath: string;
  title: string;
  contentType: string;
  materialType: string;
  publicUrl: string | null;
};

const RESET_CONFIRMATION = "REIMPORTAR_R2";
const RESET_ALL_CONFIRMATION = "REIMPORTAR_TODO";
const SKIP_FILE_RE = /(^|\/)(\.(DS_Store|keep)$|Thumbs\.db$)/i;
const DEFAULT_IMPORT_BATCH_SIZE = 40;
const MAX_IMPORT_BATCH_SIZE = 100;
const DATABASE_LOOKUP_BATCH_SIZE = 100;
const IMPORT_BATCH_DELAY_MS = 75;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function cleanPath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function basename(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "seccion";
}

function ext(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[a-z0-9]{2,8}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || fileName;
}

function inferContentType(fileName: string) {
  switch (ext(fileName)) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "ppt": return "application/vnd.ms-powerpoint";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xls": return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

function inferMaterialType(fileName: string) {
  const extension = ext(fileName);
  if (extension === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "Imagen";
  if (["doc", "docx"].includes(extension)) return "Documento";
  if (["ppt", "pptx"].includes(extension)) return "Presentación";
  if (["xls", "xlsx"].includes(extension)) return "Hoja de cálculo";
  return "Archivo";
}

function isImportableObject(object: NativeR2ListedObject) {
  const fileName = basename(object.key);
  return Boolean(fileName && fileName.includes(".") && !SKIP_FILE_RE.test(object.key));
}

function toImportable(object: NativeR2ListedObject): ImportableObject {
  const fileName = basename(object.key);
  return {
    ...object,
    fileName,
    sectionPath: materialSectionPathFromR2Key(object.key) || MATERIALS_R2_ROOT,
    title: titleFromFileName(fileName),
    contentType: inferContentType(fileName),
    materialType: inferMaterialType(fileName),
    publicUrl: null,
  };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function boundedPositiveInt(value: unknown, fallback: number, maximum: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(numeric, maximum));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function loadSectionMap() {
  const rows = await d1All<SectionRow>("SELECT id, path FROM material_sections");
  return new Map(rows.map((row) => [cleanPath(row.path), row.id]));
}

async function ensureSectionPath(sectionMap: Map<string, string>, sectionPath: string) {
  const parts = cleanPath(sectionPath).split("/").filter(Boolean);
  let parentId: string | null = null;
  let currentPath = "";

  for (const [index, part] of parts.entries()) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existingId = sectionMap.get(currentPath);
    if (existingId) {
      parentId = existingId;
      continue;
    }

    const row: SectionRow = { id: crypto.randomUUID(), path: currentPath };
    await d1Run(
      `INSERT INTO material_sections (id, parent_id, name, slug, path, active, sort_order)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [row.id, parentId, part, slugify(index === 0 ? currentPath : part), currentPath, sectionMap.size],
    );

    sectionMap.set(cleanPath(row.path), row.id);
    parentId = row.id;
  }

  return parentId;
}

async function loadExistingMaterials(keys: string[]) {
  const map = new Map<string, string>();
  const keyChunks = chunk(keys, DATABASE_LOOKUP_BATCH_SIZE);

  for (const [index, keysChunk] of keyChunks.entries()) {
    if (!keysChunk.length) continue;
    const rows = await d1All<MaterialRow>(
      `SELECT id, r2_key FROM materials WHERE r2_key IN (${keysChunk.map(() => "?").join(",")})`,
      keysChunk,
    );
    for (const row of rows) if (row.r2_key) map.set(row.r2_key, row.id);

    if (index < keyChunks.length - 1) await delay(IMPORT_BATCH_DELAY_MS);
  }

  return map;
}

async function resetMaterials(scope: "r2" | "all", batchSize: number) {
  let selectSql: string;
  switch (scope) {
    case "r2":
      selectSql = "SELECT id FROM materials WHERE provider = 'r2'";
      break;
    case "all":
      selectSql = "SELECT id FROM materials";
      break;
    default:
      throw new HttpError(400, "Alcance de reinicio inválido.");
  }
  const ids = (await d1All<{ id: string }>(
    selectSql,
  )).map((row) => row.id);
  const idChunks = chunk(ids, batchSize);

  for (const [index, idsChunk] of idChunks.entries()) {
    if (!idsChunk.length) continue;
    const placeholders = idsChunk.map(() => "?").join(",");
    const db = await getD1();
    await db.batch([
      db.prepare(`DELETE FROM task_materials WHERE material_id IN (${placeholders})`).bind(...idsChunk),
      db.prepare(`DELETE FROM materials WHERE id IN (${placeholders})`).bind(...idsChunk),
    ]);

    if (index < idChunks.length - 1) await delay(IMPORT_BATCH_DELAY_MS);
  }

  return ids.length;
}

async function runImport(request: Request, fallbackBody: ImportRequest) {
  try {
    await requirePermission(request, "r2:manage");

    const rawBody = request.method === "POST"
      ? await request.json().catch(() => { throw new HttpError(400, "El cuerpo JSON no es válido."); })
      : fallbackBody;
    const parsed = importRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Solicitud de importación inválida.");
    const body = parsed.data;
    const dryRun = body.dryRun ?? request.method !== "POST";
    const reset = body.reset ?? false;
    const resetScope = body.resetScope ?? "r2";
    const root = normalizeMaterialImportRoot(body.root ?? MATERIALS_R2_ROOT);
    const maxItems = boundedPositiveInt(body.maxItems, 10_000, 50_000);
    const batchSize = boundedPositiveInt(body.batchSize, DEFAULT_IMPORT_BATCH_SIZE, MAX_IMPORT_BATCH_SIZE);

    const expectedConfirmation = resetScope === "all" ? RESET_ALL_CONFIRMATION : RESET_CONFIRMATION;
    if (reset && body.confirm !== expectedConfirmation) {
      return json({ error: `Envía confirm: "${expectedConfirmation}".`, destructiveScope: resetScope }, 400);
    }

    const prefix = root ? `${root}/` : "";
    const listedObjects = await listNativeR2Objects(prefix, maxItems);
    const objects = listedObjects
      .filter(isImportableObject)
      .map(toImportable);
    const sectionPaths = Array.from(new Set(objects.map((object) => object.sectionPath))).sort((a, b) => a.localeCompare(b, "es"));
    const plannedBatches = Math.ceil(objects.length / batchSize);

    if (dryRun) {
      return json({
        dryRun: true,
        bucket: MATERIALS_R2_BUCKET_NAME,
        root,
        scannedObjects: objects.length,
        sectionsToEnsure: sectionPaths.length,
        batchSize,
        plannedBatches,
        sampleSections: sectionPaths.slice(0, 12),
        sampleMaterials: objects.slice(0, 12).map((object) => ({
          title: object.title,
          key: object.key,
          sectionPath: object.sectionPath,
          size: object.size,
          publicUrl: object.publicUrl,
        })),
      });
    }

    const deletedMaterials = reset ? await resetMaterials(resetScope, batchSize) : 0;
    const sectionMap = await loadSectionMap();
    const sectionIdByPath = new Map<string, string>();

    for (const sectionPath of sectionPaths) {
      const sectionId = await ensureSectionPath(sectionMap, sectionPath);
      if (sectionId) sectionIdByPath.set(cleanPath(sectionPath), sectionId);
    }

    const existingMaterials = reset ? new Map<string, string>() : await loadExistingMaterials(objects.map((object) => object.key));
    const objectBatches = chunk(objects, batchSize);
    const importedAt = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    for (const [batchIndex, objectBatch] of objectBatches.entries()) {
      for (const object of objectBatch) {
        const payload = {
          section_id: sectionIdByPath.get(cleanPath(object.sectionPath)) ?? null,
          title: object.title,
          material_type: object.materialType,
          visibility: "visible",
          provider: "r2",
          source_url: object.publicUrl,
          preview_url: object.publicUrl,
          r2_bucket: MATERIALS_R2_BUCKET_NAME,
          r2_key: object.key,
          file_name: object.fileName,
          content_type: object.contentType,
          size_bytes: object.size,
          observations: `Importado automáticamente desde R2 (${root}).`,
          updated_at: importedAt,
        };

        const existingId = existingMaterials.get(object.key);
        if (existingId) {
          await d1Run(
            `UPDATE materials SET section_id = ?, title = ?, material_type = ?, visibility = ?, provider = ?,
              source_url = ?, preview_url = ?, r2_bucket = ?, r2_key = ?, file_name = ?, content_type = ?,
              size_bytes = ?, observations = ?, updated_at = ?
             WHERE id = ?`,
            [
              payload.section_id,
              payload.title,
              payload.material_type,
              payload.visibility,
              payload.provider,
              payload.source_url,
              payload.preview_url,
              payload.r2_bucket,
              payload.r2_key,
              payload.file_name,
              payload.content_type,
              payload.size_bytes,
              payload.observations,
              payload.updated_at,
              existingId,
            ],
          );
          updated += 1;
        } else {
          await d1Run(
            `INSERT INTO materials (id, section_id, title, material_type, visibility, provider, source_url,
              preview_url, r2_bucket, r2_key, file_name, content_type, size_bytes, observations, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              payload.section_id,
              payload.title,
              payload.material_type,
              payload.visibility,
              payload.provider,
              payload.source_url,
              payload.preview_url,
              payload.r2_bucket,
              payload.r2_key,
              payload.file_name,
              payload.content_type,
              payload.size_bytes,
              payload.observations,
              payload.updated_at,
            ],
          );
          inserted += 1;
        }
      }

      if (batchIndex < objectBatches.length - 1) await delay(IMPORT_BATCH_DELAY_MS);
    }

    return json({
      dryRun: false,
      bucket: MATERIALS_R2_BUCKET_NAME,
      root,
      reset,
      resetScope: reset ? resetScope : null,
      deletedMaterials,
      importedObjects: objects.length,
      ensuredSections: sectionPaths.length,
      batchSize,
      processedBatches: objectBatches.length,
      throttleMs: IMPORT_BATCH_DELAY_MS,
      inserted,
      updated,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return runImport(request, {
    dryRun: true,
    root: url.searchParams.get("root") ?? MATERIALS_R2_ROOT,
    maxItems: Number(url.searchParams.get("maxItems")) || 10_000,
    batchSize: Number(url.searchParams.get("batchSize")) || DEFAULT_IMPORT_BATCH_SIZE,
  });
}

export async function POST(request: Request) {
  return runImport(request, { dryRun: false });
}
