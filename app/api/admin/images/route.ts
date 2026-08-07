import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import { createDirectImageUpload, type ImageCategory } from "@/lib/server/cloudflare-images";

const schema = z.object({ category: z.enum(["task", "event", "announcement"]) });

function permission(category: ImageCategory) {
  return category === "announcement" ? "notifications:manage" as const : "tasks:edit" as const;
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const profile = await requirePermission(request, permission(input.category));
    const result = await createDirectImageUpload({ creatorId: profile.id, category: input.category });
    return NextResponse.json({ ok: true, id: result.id, uploadURL: result.uploadURL });
  } catch (error) {
    return errorResponse(error);
  }
}
