import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { deleteCloudflareImage, getCloudflareImage, type ImageCategory } from "@/lib/server/cloudflare-images";
import { isR2ImageId, removeTaskImage, fetchTaskImage } from "@/lib/server/task-image-r2";

type RouteContext = { params: Promise<{ id: string }> };
const categorySchema = z.enum(["task", "event", "announcement"]);

function permission(category: ImageCategory) {
  return category === "announcement" ? "notifications:manage" as const : "tasks:edit" as const;
}

function categoryFrom(request: Request) {
  return categorySchema.parse(new URL(request.url).searchParams.get("category"));
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const category = categoryFrom(request);
    await requirePermission(request, permission(category));
    const { id } = await context.params;
    const image = isR2ImageId(id)
      ? { id, draft: !(await fetchTaskImage(id)), url: "/api/media/images/" + encodeURIComponent(id) }
      : await getCloudflareImage(id);
    return NextResponse.json({ ok: true, image });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const category = categoryFrom(request);
    await requirePermission(request, permission(category));
    const { id } = await context.params;
    if (isR2ImageId(id)) await removeTaskImage(id);
    else await deleteCloudflareImage(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
