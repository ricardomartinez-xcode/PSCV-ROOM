"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./student-directory.module.css";

type Student = {
  id: string;
  email: string;
  full_name: string;
  control_number: string | null;
  active: number;
  updated_at: string;
};

type StudentForm = {
  id: string | null;
  email: string;
  fullName: string;
  controlNumber: string;
  active: boolean;
};

type ImportState = {
  error?: string;
  message?: string;
  created?: number;
  updated?: number;
  stats?: {
    sourceRows: number;
    validRows: number;
    blankRows: number;
    invalidRows: number;
    externalEmailRows: number;
  };
  errors?: Array<{ row: number; message: string }>;
};

const EMPTY_FORM: StudentForm = {
  id: null,
  email: "",
  fullName: "",
  controlNumber: "",
  active: true,
};

async function responseMessage(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return payload.error ?? payload.message ?? "No se pudo completar la operación.";
}

function formattedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function StudentDirectory() {
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [importing, setImporting] = useState(false);

  const activeCount = useMemo(
    () => students.filter((student) => student.active === 1).length,
    [students],
  );

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (includeInactive) params.set("includeInactive", "true");

      const response = await fetch(`/api/admin/students?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await responseMessage(response));

      const payload = (await response.json()) as { students?: Student[] };
      setStudents(payload.students ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la lista.");
    } finally {
      setLoading(false);
    }
  }, [includeInactive, query]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function beginEdit(student: Student) {
    setForm({
      id: student.id,
      email: student.email,
      fullName: student.full_name,
      controlNumber: student.control_number ?? "",
      active: student.active === 1,
    });
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/students", {
        method: form.id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(form.id ? { id: form.id } : {}),
          email: form.email,
          fullName: form.fullName,
          controlNumber: form.controlNumber,
          active: form.active,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));

      setNotice(await responseMessage(response));
      resetForm();
      await loadStudents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el alumno.");
    } finally {
      setSaving(false);
    }
  }

  async function removeStudent(student: Student) {
    if (!window.confirm(`Eliminar a ${student.full_name}. Esta acción no se puede deshacer.`)) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/students", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: student.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));

      setNotice(await responseMessage(response));
      if (form.id === student.id) resetForm();
      await loadStudents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar el alumno.");
    } finally {
      setSaving(false);
    }
  }

  async function importCsv(action: "preview" | "apply") {
    if (!file) {
      setError("Selecciona un archivo CSV para continuar.");
      return;
    }

    setImporting(true);
    setNotice(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("action", action);

      const response = await fetch("/api/admin/students/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as ImportState;
      setImportState(payload);

      if (!response.ok) throw new Error(payload.error ?? "No se pudo procesar el archivo.");

      if (action === "apply") {
        setNotice(`Importación aplicada: ${payload.created ?? 0} altas y ${payload.updated ?? 0} actualizaciones.`);
        await loadStudents();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo procesar el CSV.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administración</p>
          <h1>Alumnos y usuarios</h1>
          <p className={styles.subtitle}>
            Administra los perfiles de alumno. La política de inicio de sesión se controla en
            Cloudflare Access y Microsoft Entra.
          </p>
        </div>
        <Link className={styles.backLink} href="/">
          Volver a PSCV Room
        </Link>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.importCard} aria-labelledby="csv-title">
        <div>
          <p className={styles.eyebrow}>Actualización masiva</p>
          <h2 id="csv-title">Importar padrón CSV</h2>
          <p>
            El archivo debe incluir Correo electrónico, Nombre completo y No de control. Primero
            valida el padrón y después aplica la importación.
          </p>
        </div>
        <div className={styles.importActions}>
          <input
            accept=".csv,text/csv"
            aria-label="Seleccionar padrón CSV"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setImportState(null);
            }}
            type="file"
          />
          <div className={styles.buttonRow}>
            <button
              className={styles.secondaryButton}
              disabled={!file || importing}
              onClick={() => void importCsv("preview")}
              type="button"
            >
              {importing ? "Procesando…" : "Validar archivo"}
            </button>
            <button
              className={styles.primaryButton}
              disabled={!file || importing || !importState || Boolean(importState.error)}
              onClick={() => void importCsv("apply")}
              type="button"
            >
              Aplicar importación
            </button>
          </div>
        </div>
        {importState?.stats ? (
          <div className={styles.importSummary}>
            <span>{importState.stats.validRows} alumnos válidos</span>
            <span>{importState.stats.blankRows} filas vacías ignoradas</span>
            <span>{importState.stats.externalEmailRows} correos externos</span>
            <span>{importState.stats.invalidRows} filas inválidas</span>
          </div>
        ) : null}
        {importState?.errors?.length ? (
          <ul className={styles.importErrors}>
            {importState.errors.slice(0, 8).map((item) => (
              <li key={`${item.row}-${item.message}`}>
                Fila {item.row}: {item.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className={styles.workspace}>
        <section className={styles.formCard} aria-labelledby="student-form-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{form.id ? "Edición" : "Alta individual"}</p>
              <h2 id="student-form-title">{form.id ? "Editar alumno" : "Agregar alumno"}</h2>
            </div>
            {form.id ? (
              <button className={styles.textButton} onClick={resetForm} type="button">
                Cancelar edición
              </button>
            ) : null}
          </div>

          <form className={styles.form} onSubmit={saveStudent}>
            <label>
              Correo electrónico
              <input
                autoComplete="email"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
                type="email"
                value={form.email}
              />
            </label>
            <label>
              Nombre completo
              <input
                autoComplete="name"
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                required
                value={form.fullName}
              />
            </label>
            <label>
              Número de control
              <input
                onChange={(event) => setForm((current) => ({ ...current, controlNumber: event.target.value }))}
                value={form.controlNumber}
              />
            </label>
            <label className={styles.checkbox}>
              <input
                checked={form.active}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                type="checkbox"
              />
              Perfil activo
            </label>
            <button className={styles.primaryButton} disabled={saving} type="submit">
              {saving ? "Guardando…" : form.id ? "Guardar cambios" : "Dar de alta"}
            </button>
          </form>
        </section>

        <section className={styles.listCard} aria-labelledby="students-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Directorio</p>
              <h2 id="students-title">Alumnos registrados</h2>
              <p>{activeCount} activos de {students.length} mostrados</p>
            </div>
          </div>
          <div className={styles.filters}>
            <input
              aria-label="Buscar alumno"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre, correo o control"
              type="text"
              value={query}
            />
            <label className={styles.checkbox}>
              <input
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
                type="checkbox"
              />
              Mostrar inactivos
            </label>
            <button className={styles.secondaryButton} onClick={() => void loadStudents()} type="button">
              Buscar
            </button>
          </div>
          {loading ? <p className={styles.muted}>Cargando alumnos…</p> : null}
          {!loading && students.length === 0 ? (
            <p className={styles.muted}>No hay alumnos que coincidan con la búsqueda.</p>
          ) : null}
          <div className={styles.studentList}>
            {students.map((student) => (
              <article className={styles.studentRow} key={student.id}>
                <div className={styles.studentIdentity}>
                  <strong>{student.full_name}</strong>
                  <span>{student.email}</span>
                  <span>
                    Control: {student.control_number || "Sin número"} · {student.active === 1 ? "Activo" : "Inactivo"}
                  </span>
                  <small>Actualizado: {formattedDate(student.updated_at)}</small>
                </div>
                <div className={styles.rowActions}>
                  <button className={styles.textButton} onClick={() => beginEdit(student)} type="button">
                    Editar
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={saving}
                    onClick={() => void removeStudent(student)}
                    type="button"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
