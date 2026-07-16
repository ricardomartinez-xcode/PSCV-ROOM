import { NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { isGeneratedR2FolderPath, MATERIALS_R2_ROOT, normalizeMaterialR2Key } from "@/lib/server/r2-paths";
import { listNativeR2FolderPrefixes } from "@/lib/server/r2-native";
import { d1All } from "@/lib/server/d1-data";

type SectionRow = {
  id: string;
  name: string;
  path: string;
  sort_order: number | null;
};

type UploadDestination = {
  id: string;
  sectionId: string | null;
  name: string;
  path: string;
  source: "r2";
};

function labelFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function destinationKey(path: string) {
  return normalizeMaterialR2Key(path).toLowerCase();
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "r2:manage");
  const sectionsByPath = new Map<string, SectionRow>();
  const destinations = new Map<string, UploadDestination>();

  try {
    const sections = await d1All<SectionRow>(
      "SELECT id, name, path, sort_order FROM material_sections WHERE active = 1 ORDER BY sort_order ASC",
    );
    for (const section of sections) {
      const key = destinationKey(section.path);
      if (key) {
        sectionsByPath.set(key, section);
        destinations.set(key, {
          id: `r2:${section.path}`,
          sectionId: section.id,
          name: section.name,
          path: section.path,
          source: "r2",
        });
      }
    }
  } catch {
    // Demo/local mode can run without D1; bucket folders still drive destinations.
  }

  try {
    const folders = await listNativeR2FolderPrefixes(MATERIALS_R2_ROOT);
    for (const folder of folders) {
      const path = normalizeMaterialR2Key(folder);
      if (!path || isGeneratedR2FolderPath(path)) continue;
      const key = destinationKey(path);
      const section = sectionsByPath.get(key);
      destinations.set(key, {
        id: `r2:${path}`,
        sectionId: section?.id ?? null,
        name: section?.name ?? labelFromPath(path),
        path,
        source: "r2",
      });
    }
  } catch {
    // D1 sections remain valid upload destinations even when the bucket is empty.
  }

    return NextResponse.json({
      ok: true,
      root: MATERIALS_R2_ROOT,
      destinations: Array.from(destinations.values()).sort((a, b) => a.path.localeCompare(b.path, "es")),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
