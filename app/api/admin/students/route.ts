import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePermission } from "@/lib/server/authz";
import {
  deleteStudent,
  listStudents,
  saveStudent,
  studentInputSchema,
} from "@/lib/server/students";

const studentIdSchema = z.string().trim().min(1).max(128);

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function parseJson(request: Request) {
  return request.json().catch(() => null);
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "users:manage");

    const url = new URL(request.url);
    const students = await listStudents({
      query: url.searchParams.get("q") ?? "",
      includeInactive: url.searchParams.get("includeInactive") === "true",
    });

    return NextResponse.json({ students, total: students.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const parsed = studentInputSchema.safeParse(await parseJson(request));

    if (!parsed.success) {
      return jsonError(
        parsed.error.issues[0]?.message ?? "Revisa los datos del alumno.",
        400,
      );
    }

    const result = await saveStudent(parsed.data, actor.id);
    return NextResponse.json(
      {
        student: result.student,
        created: result.created,
        message: result.created
          ? "Alumno dado de alta."
          : "Alumno actualizado con los datos proporcionados.",
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const body = await parseJson(request);
    const id = studentIdSchema.safeParse(body?.id);
    const { id: _id, ...studentBody } =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const input = studentInputSchema.safeParse(studentBody);

    if (!id.success) {
      return jsonError("Selecciona un alumno válido.", 400);
    }

    if (!input.success) {
      return jsonError(
        input.error.issues[0]?.message ?? "Revisa los datos del alumno.",
        400,
      );
    }

    const result = await saveStudent(input.data, actor.id, id.data);
    return NextResponse.json({
      student: result.student,
      message: "Alumno actualizado.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const body = await parseJson(request);
    const id = studentIdSchema.safeParse(body?.id);

    if (!id.success) {
      return jsonError("Selecciona un alumno válido.", 400);
    }

    const student = await deleteStudent(id.data, actor.id);
    return NextResponse.json({
      id: student.id,
      message: "Alumno eliminado.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
