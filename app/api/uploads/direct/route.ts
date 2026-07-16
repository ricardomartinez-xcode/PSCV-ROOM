import { NextResponse } from "next/server";
import { buildMaterialR2Key, MATERIALS_R2_ROOT } from "@/lib/server/r2-paths";
import { putNativeR2Object } from "@/lib/server/r2-native";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { validateMaterialUpload } from "@/lib/material-file-policy";

export async function POST(request: Request) {
  try {
    await requirePermission(request, "r2:manage");

    const formData = await request.formData();
    const file = formData.get("file");
    const sectionPath = typeof formData.get("sectionPath") === "string" ? String(formData.get("sectionPath")) : undefined;
    const fileName = typeof formData.get("fileName") === "string" ? String(formData.get("fileName")) : undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo no recibido." }, { status: 400 });
    }

    const upload = validateMaterialUpload({
      fileName: fileName || file.name,
      contentType: file.type,
      size: file.size,
    });
    if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 });

    const key = buildMaterialR2Key({ fileName: fileName || file.name, sectionPath });
    const result = await putNativeR2Object({
      key,
      body: await file.arrayBuffer(),
      contentType: upload.contentType,
    });

    return NextResponse.json({
      ...result,
      root: MATERIALS_R2_ROOT,
      contentType: upload.contentType,
      size: file.size,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
