import { NextResponse } from "next/server";
import { errorResponse, HttpError, requirePermission } from "@/lib/server/authz";
import {
  saveStudent,
  studentInputSchema,
  validateStudentSave,
  type StudentInput,
} from "@/lib/server/students";

const MAX_CSV_BYTES = 15 * 1024 * 1024;
const MAX_STUDENTS_PER_IMPORT = 1_000;
const MAX_REPORTED_ERRORS = 100;

type ImportRecord = {
  row: number;
  input: StudentInput;
};

type ImportError = {
  row: number;
  message: string;
};

type ParsedImport = {
  records: ImportRecord[];
  sourceRows: number;
  blankRows: number;
  invalidRows: number;
  externalEmailRows: number;
  errors: ImportError[];
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findHeaderIndex(headers: string[], accepted: string[]) {
  return headers.findIndex((header) => accepted.includes(normalizeHeader(header)));
}

function pushError(errors: ImportError[], row: number, message: string) {
  if (errors.length < MAX_REPORTED_ERRORS) {
    errors.push({ row, message });
  }
}

function parseCsv(text: string, onRow: (row: string[]) => void) {
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  const finishRow = () => {
    if (cell.endsWith("\r")) {
      cell = cell.slice(0, -1);
    }

    row.push(cell);
    onRow(row);
    row = [];
    cell = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      finishRow();
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new HttpError(400, "El CSV contiene comillas sin cerrar.");
  }

  if (cell.length > 0 || row.length > 0) {
    finishRow();
  }
}

function decodeCsv(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function parseStudentCsv(text: string): ParsedImport {
  const records: ImportRecord[] = [];
  const errors: ImportError[] = [];
  const seenEmails = new Set<string>();
  const seenControlNumbers = new Set<string>();
  let headers: string[] | null = null;
  let emailIndex = -1;
  let nameIndex = -1;
  let controlIndex = -1;
  let sourceRows = 0;
  let blankRows = 0;
  let invalidRows = 0;
  let externalEmailRows = 0;
  let rowNumber = 0;

  parseCsv(text, (row) => {
    rowNumber += 1;

    if (!headers) {
      const parsedHeaders = row;
      headers = parsedHeaders;
      emailIndex = findHeaderIndex(parsedHeaders, [
        "correo electronico",
        "correo",
        "email",
        "e-mail",
      ]);
      nameIndex = findHeaderIndex(parsedHeaders, ["nombre completo", "nombre"]);
      controlIndex = findHeaderIndex(parsedHeaders, [
        "no de control",
        "numero de control",
        "no control",
        "control",
      ]);

      if (emailIndex === -1 || nameIndex === -1 || controlIndex === -1) {
        throw new HttpError(
          400,
          "El CSV debe incluir las columnas Correo electrónico, Nombre completo y No de control.",
        );
      }

      return;
    }

    const email = (row[emailIndex] ?? "").trim();
    const fullName = (row[nameIndex] ?? "").trim();
    const controlNumber = (row[controlIndex] ?? "").trim();

    if (!email && !fullName && !controlNumber) {
      blankRows += 1;
      return;
    }

    sourceRows += 1;
    const parsed = studentInputSchema.safeParse({
      email,
      fullName,
      controlNumber,
      active: true,
    });

    if (!parsed.success) {
      invalidRows += 1;
      pushError(
        errors,
        rowNumber,
        parsed.error.issues[0]?.message ?? "Fila con datos inválidos.",
      );
      return;
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const normalizedControl = parsed.data.controlNumber?.trim() ?? "";

    if (seenEmails.has(normalizedEmail)) {
      invalidRows += 1;
      pushError(errors, rowNumber, "Correo repetido dentro del archivo.");
      return;
    }

    if (normalizedControl && seenControlNumbers.has(normalizedControl)) {
      invalidRows += 1;
      pushError(errors, rowNumber, "Número de control repetido dentro del archivo.");
      return;
    }

    if (records.length >= MAX_STUDENTS_PER_IMPORT) {
      invalidRows += 1;
      pushError(
        errors,
        rowNumber,
        `El archivo excede el límite de ${MAX_STUDENTS_PER_IMPORT} alumnos por importación.`,
      );
      return;
    }

    seenEmails.add(normalizedEmail);
    if (normalizedControl) seenControlNumbers.add(normalizedControl);
    if (!normalizedEmail.endsWith("@univdep.edu.mx")) externalEmailRows += 1;

    records.push({ row: rowNumber, input: parsed.data });
  });

  if (!headers) {
    throw new HttpError(400, "El archivo CSV está vacío.");
  }

  return {
    records,
    sourceRows,
    blankRows,
    invalidRows,
    externalEmailRows,
    errors,
  };
}

function buildPayload(parsed: ParsedImport) {
  return {
    stats: {
      sourceRows: parsed.sourceRows,
      validRows: parsed.records.length,
      blankRows: parsed.blankRows,
      invalidRows: parsed.invalidRows,
      externalEmailRows: parsed.externalEmailRows,
    },
    errors: parsed.errors,
    preview: parsed.records.slice(0, 10).map(({ row, input }) => ({
      row,
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      controlNumber: input.controlNumber?.trim() || null,
    })),
  };
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission(request, "users:manage");
    const form = await request.formData();
    const action = form.get("action") === "apply" ? "apply" : "preview";
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new HttpError(400, "Selecciona un archivo CSV.");
    }

    if (file.size === 0) {
      throw new HttpError(400, "El archivo CSV está vacío.");
    }

    if (file.size > MAX_CSV_BYTES) {
      throw new HttpError(
        413,
        `El archivo excede el límite de ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const parsed = parseStudentCsv(decodeCsv(await file.arrayBuffer()));
    const payload = buildPayload(parsed);

    if (parsed.invalidRows > 0) {
      return NextResponse.json(
        {
          error: "Corrige las filas inválidas antes de aplicar la importación.",
          ...payload,
        },
        { status: 400 },
      );
    }

    if (action === "preview") {
      return NextResponse.json({
        action: "preview",
        message: "Archivo validado. Confirma la importación para guardar los cambios.",
        ...payload,
      });
    }

    for (const record of parsed.records) {
      try {
        await validateStudentSave(record.input);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "No se pudo validar el alumno.";
        pushError(parsed.errors, record.row, message);
      }
    }

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        {
          error: "La importación no se aplicó porque hay conflictos con perfiles existentes.",
          ...buildPayload(parsed),
        },
        { status: 409 },
      );
    }

    let created = 0;
    let updated = 0;
    for (const record of parsed.records) {
      const result = await saveStudent(record.input, actor.id);
      if (result.created) created += 1;
      else updated += 1;
    }

    return NextResponse.json({
      action: "apply",
      message: "Lista de alumnos actualizada.",
      created,
      updated,
      ...buildPayload(parsed),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
