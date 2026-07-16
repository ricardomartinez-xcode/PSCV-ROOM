import { NextResponse } from "next/server";
import { getCloudflareEnv, getMaterialsBucket } from "@/lib/server/cloudflare";
import { createNativePublicR2Url, listNativeR2FolderPrefixes, listNativeR2Objects } from "@/lib/server/r2-native";
import { MATERIALS_R2_BUCKET_NAME, MATERIALS_R2_ROOT } from "@/lib/server/r2-paths";
import { errorResponse, requirePermission } from "@/lib/server/authz";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "r2:manage");

    const env = await getCloudflareEnv();
    await getMaterialsBucket();
    const diagnostics = {
      bucket: MATERIALS_R2_BUCKET_NAME,
      root: MATERIALS_R2_ROOT,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? "",
      variables: {
        MATERIALS_BUCKET: true,
        R2_PUBLIC_BASE_URL: Boolean(env.R2_PUBLIC_BASE_URL),
      },
    };

    const samplePrefix = MATERIALS_R2_ROOT ? `${MATERIALS_R2_ROOT}/` : "";
    const [folders, sampleObjects] = await Promise.all([
      listNativeR2FolderPrefixes(MATERIALS_R2_ROOT),
      listNativeR2Objects(samplePrefix, 5),
    ]);

    const sample = await Promise.all(sampleObjects.map(async (object) => ({
      key: object.key,
      size: object.size,
      lastModified: object.lastModified?.toISOString() ?? null,
      publicUrl: await createNativePublicR2Url(object.key),
    })));

    return NextResponse.json({
      ok: true,
      configured: true,
      ...diagnostics,
      folders,
      sampleObjects: sample,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
