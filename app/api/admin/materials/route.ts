import { NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { d1All } from "@/lib/server/d1-data";

type MaterialRow = {
  id: string; title: string; material_type: string | null; provider: string | null;
  file_name: string | null; content_type: string | null; visibility: string;
  size_bytes: number | null; section_id: string | null; r2_missing_at: string | null;
  observations: string | null; has_r2: number;
  section_name: string | null; section_path: string | null; section_color: string | null;
};
export async function GET(request: Request) {
  try {
    await requirePermission(request, "materials:manage");
    const materials = await d1All<MaterialRow>(
      `SELECT m.id, m.title, m.material_type, m.provider, m.file_name, m.content_type,
        m.visibility, m.size_bytes, m.section_id, m.r2_missing_at, m.observations,
        CASE WHEN m.r2_key IS NULL THEN 0 ELSE 1 END AS has_r2,
        s.name AS section_name, s.path AS section_path, s.color AS section_color
       FROM materials m LEFT JOIN material_sections s ON s.id = m.section_id
       ORDER BY m.title COLLATE NOCASE ASC LIMIT 2000`,
    );
    const sections = await d1All<{ id: string; name: string; path: string }>(
      "SELECT id, name, path FROM material_sections WHERE active = 1 ORDER BY path ASC",
    );
    return NextResponse.json({
      ok: true,
      materials: materials.map((item) => ({
        ...item,
        section: item.section_id
          ? { id: item.section_id, name: item.section_name, path: item.section_path, color: item.section_color }
          : null,
        preview_url: item.has_r2 && !item.r2_missing_at
          ? `/api/materials/${encodeURIComponent(item.id)}/file?mode=preview` : null,
        download_url: item.has_r2 && !item.r2_missing_at
          ? `/api/materials/${encodeURIComponent(item.id)}/file?mode=download` : null,
      })),
      sections,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
