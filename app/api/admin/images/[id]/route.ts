import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { deleteCloudflareImage, getCloudflareImage, type ImageCategory } from "@/lib/server/cloudflare-images";

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
    const image = await getCloudflareImage(id);
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
    await deleteCloudflareImage(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
