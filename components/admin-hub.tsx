"use client";

import { useEffect, useMemo, useState } from "react";
import { createD1BrowserClient } from "@/lib/d1/client";
import { canAccessAdminTab, getSessionCapabilities } from "@/lib/auth-permissions";

type D1Browser = NonNullable<ReturnType<typeof createD1BrowserClient>>;
type AdminTab = "general" | "tasks" | "courses" | "sections" | "materials" | "users" | "notifications" | "reports" | "diagnostics";
type CardSize = "compact" | "medium" | "large";

type CourseConfig = { id: string; name: string; shortName: string; color: string; icon: string; cardSize: CardSize; active: boolean };
type SectionConfig = { id: string; name: string; path: string; color: string; icon: string; cardSize: CardSize; previewStyle: string; active: boolean };
type AdminTaskRow = { id: string; title: string; due_date: string; due_time: string | null; status: string; priority: string; visible_to_students: boolean; material_url: string | null; platform_url: string | null; courses: { name: string; color: string | null } | { name: string; color: string | null }[] | null; task_types: { name: string; color: string | null } | { name: string; color: string | null }[] | null };
type AppProfileRow = { id: string; email: string; full_name: string | null; control_number: string | null; role: "student" | "admin" | "owner"; active: boolean; can_edit_tasks: boolean; can_delete_tasks: boolean; can_manage_materials: boolean; can_manage_users: boolean; can_manage_settings: boolean; can_manage_group: boolean; can_manage_notifications: boolean; can_view_reports: boolean; can_manage_r2: boolean };
type CourseDraft = Pick<CourseConfig, "name" | "shortName" | "color" | "icon" | "cardSize">;
type StudentDraft = { controlNumber: string; email: string; fullName: string };
type UploadDestination = { id: string; sectionId: string | null; name: string; path: string; source: "d1" | "r2" };
type AdminProfile = { role: "student" | "admin" | "owner"; canEditTasks: boolean; canDeleteTasks: boolean; canManageMaterials: boolean; canManageUsers: boolean; canManageSettings: boolean; canManageGroup: boolean; canManageNotifications: boolean; canViewReports: boolean; canManageR2: boolean } | null;
type HealthPayload = { ok?: boolean; mode?: string; auth?: { configured?: boolean }; integrations?: Record<string, boolean> };
type DestinationsPayload = { ok?: boolean; root?: string; destinations?: UploadDestination[]; error?: string };
type LibraryPayload = { ok?: boolean; summary?: { sections: number; materials: number; providers: Record<string, number> }; error?: string };
type R2StatusPayload = {
  ok?: boolean;
  configured?: boolean;
  endpoint?: string;
  bucket?: string;
  root?: string;
  publicBaseUrl?: string;
  variables?: Record<string, boolean>;
  folders?: string[];
  sampleObjects?: Array<{ key: string; size: number; lastModified: string | null }>;
  error?: string;
};
type DiagnosticCounts = { profiles: number | null; tasks: number | null; materials: number | null; sections: number | null; groupColumns: number | null };
type DiagnosticsSnapshot = {
  checkedAt: string;
  health: HealthPayload | null;
  healthError: string | null;
  destinations: DestinationsPayload | null;
  destinationsError: string | null;
  library: LibraryPayload | null;
  libraryError: string | null;
  r2Status: R2StatusPayload | null;
  r2StatusError: string | null;
  counts: DiagnosticCounts;
  countErrors: string[];
};
type ImportResult = {
  dryRun?: boolean;
  bucket?: string;
  root?: string;
  scannedObjects?: number;
  sectionsToEnsure?: number;
  sampleSections?: string[];
  importedObjects?: number;
  ensuredSections?: number;
  inserted?: number;
  updated?: number;
  error?: string;
};
type AdminNotification = { id: string; profile_id: string | null; kind: string; priority: string; title: string; body: string; read_at: string | null; dismissed_at: string | null; created_at: string; recipient_count: number; read_count: number; dismissed_count: number };
type EmailDispatchResult = { configured: boolean; considered: number; delivered: number; skipped: number; failed: number; errors: string[] };
type ReportPayload = { ok?: boolean; tasks?: ReportRow[]; materials?: ReportRow[]; students?: ReportRow[]; audit?: ReportRow[]; error?: string };
type ReportRow = Record<string, string | number | boolean | null>;

type AdminHubProps = { courses: CourseConfig[]; sections: SectionConfig[]; columns?: unknown[]; profile?: AdminProfile; d1Client: D1Browser | null; reload: () => Promise<void>; onCourses: (courses: CourseConfig[]) => void; onSections: (sections: SectionConfig[]) => void; onError: (error: string | null) => void };

const tabs: Array<{ id: AdminTab; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "▣" },
  { id: "tasks", label: "Tareas", icon: "✓" },
  { id: "courses", label: "Materias", icon: "◉" },
  { id: "sections", label: "Secciones", icon: "▤" },
  { id: "materials", label: "Materiales", icon: "⬡" },
  { id: "users", label: "Usuarios", icon: "☷" },
  { id: "notifications", label: "Avisos", icon: "◌" },
  { id: "reports", label: "Reportes", icon: "▥" },
  { id: "diagnostics", label: "Diagnóstico", icon: "◎" },
];

export function AdminHub({ courses, sections, profile = null, d1Client, reload, onCourses, onSections, onError }: AdminHubProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("general");
  const [profiles, setProfiles] = useState<AppProfileRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [adminTasks, setAdminTasks] = useState<AdminTaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const capabilities = useMemo(() => getSessionCapabilities(profile), [profile]);
  const visibleTabs = useMemo(() => tabs.filter((tab) => canAccessAdminTab(capabilities, tab.id)), [capabilities]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab("general");
  }, [activeTab, visibleTabs]);

  // Tab-driven loads intentionally run only when the active admin module changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "users") void loadProfiles(); }, [activeTab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "tasks") void loadTaskAdminData(); }, [activeTab]);

  async function loadProfiles() {
    if (!d1Client) return;
    setLoadingUsers(true);
    const { data, error } = await d1Client.from("app_profiles").select("id,email,full_name,control_number,role,active,can_edit_tasks,can_delete_tasks,can_manage_materials,can_manage_users,can_manage_settings,can_manage_group,can_manage_notifications,can_view_reports,can_manage_r2").order("role").order("full_name");
    if (error) onError(error.message); else setProfiles((data ?? []) as AppProfileRow[]);
    setLoadingUsers(false);
  }

  async function loadTaskAdminData() {
    if (!d1Client) return;
    setLoadingTasks(true);
    const { data, error } = await d1Client.from("tasks").select("id,title,due_date,due_time,status,priority,visible_to_students,material_url,platform_url,courses(name,color),task_types(name,color)").is("archived_at", null).order("due_date", { ascending: true }).order("due_time", { ascending: true }).limit(80);
    if (error) onError(error.message); else setAdminTasks((data ?? []) as AdminTaskRow[]);
    setLoadingTasks(false);
  }

  async function createCourse(input: CourseDraft) {
    const name = input.name.trim();
    const shortName = input.shortName.trim() || name;
    if (!name) return false;

    if (!d1Client) {
      onCourses([...courses, { ...input, id: `local-course-${Date.now()}`, name, shortName, active: true }]);
      return true;
    }

    const { data, error } = await d1Client
      .from("courses")
      .insert({
        name,
        short_name: shortName,
        color: input.color,
        icon: input.icon.trim() || "book",
        card_size: input.cardSize,
        sort_order: courses.length * 10 + 10,
        active: true,
      })
      .select("id,name,short_name,color,icon,card_size,active")
      .single();

    if (error) {
      onError(error.message);
      return false;
    }

    onCourses([...courses, toCourseConfig(data as Record<string, unknown>)].sort((a, b) => a.name.localeCompare(b.name, "es")));
    await reload();
    return true;
  }

  async function updateCourse(id: string, patch: Partial<CourseConfig>) {
    const previous = courses;
    onCourses(courses.map((course) => course.id === id ? { ...course, ...patch } : course));
    if (!d1Client) return true;
    const { error } = await d1Client.from("courses").update(toDbPatch(patch)).eq("id", id);
    if (error) {
      onCourses(previous);
      onError(error.message);
      return false;
    }
    await reload();
    return true;
  }

  async function updateSection(id: string, patch: Partial<SectionConfig>) {
    onSections(sections.map((section) => section.id === id ? { ...section, ...patch } : section));
    if (!d1Client) return;
    const { error } = await d1Client.from("material_sections").update(toDbPatch(patch)).eq("id", id);
    if (error) onError(error.message);
  }

  async function createStudent(input: StudentDraft) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const controlNumber = input.controlNumber.trim();
    if (!email || !fullName) return false;

    const nextProfile: Partial<AppProfileRow> = {
      email,
      full_name: fullName,
      control_number: controlNumber || null,
      role: "student",
      active: true,
      can_edit_tasks: false,
      can_delete_tasks: false,
      can_manage_materials: false,
      can_manage_users: false,
      can_manage_settings: false,
      can_manage_group: false,
      can_manage_notifications: false,
      can_view_reports: false,
      can_manage_r2: false,
    };

    if (!d1Client) {
      setProfiles((current) => [...current, { ...(nextProfile as AppProfileRow), id: `local-student-${Date.now()}` }]);
      return true;
    }

    const { data, error } = await d1Client
      .from("app_profiles")
      .insert(nextProfile)
      .select("id,email,full_name,control_number,role,active,can_edit_tasks,can_delete_tasks,can_manage_materials,can_manage_users,can_manage_settings,can_manage_group,can_manage_notifications,can_view_reports,can_manage_r2")
      .single();

    if (error) {
      onError(error.message);
      return false;
    }

    setProfiles((current) => [...current, data as AppProfileRow].sort(sortProfiles));
    await reload();
    return true;
  }

  async function updateProfile(id: string, patch: Partial<AppProfileRow>) {
    const previous = profiles;
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
    if (!d1Client) return true;
    const { error } = await d1Client.from("app_profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setProfiles(previous);
      onError(error.message);
      return false;
    }
    await reload();
    return true;
  }

  async function updateTask(id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) {
    setAdminTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
    if (!d1Client) return;
    const response = await fetch(`/api/admin/tasks/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) onError(body.error ?? "No se pudo actualizar la tarea.");
    else await reload();
  }

  const stats = useMemo(() => ({ courses: courses.length, sections: sections.length, activeSections: sections.filter((section) => section.active).length, tasks: adminTasks.length }), [courses, sections, adminTasks]);

  return (
    <div className="adminHub">
      <section className="adminHero"><div><p className="eyebrow">Admin 2.0</p><h2>Centro de configuración</h2><p>Administra tareas, materiales, usuarios y estructura sin tocar código.</p></div><button type="button" onClick={() => void reload()}>Actualizar datos</button></section>
      <nav className="adminTabs" aria-label="Módulos de administración">{visibleTabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}</nav>
      {activeTab === "general" ? <GeneralPanel stats={stats} /> : null}
      {activeTab === "tasks" ? <TasksPanel tasks={adminTasks} loading={loadingTasks} onReload={() => void loadTaskAdminData()} onUpdate={(id, patch) => void updateTask(id, patch)} /> : null}
      {activeTab === "courses" ? <CoursesPanel courses={courses} onCreate={(input) => createCourse(input)} onUpdate={(id, patch) => updateCourse(id, patch)} /> : null}
      {activeTab === "sections" ? <SectionsPanel sections={sections} onUpdate={(id, patch) => void updateSection(id, patch)} /> : null}
      {activeTab === "materials" ? <MaterialUploadPanel canManageR2={capabilities.canManageR2} d1Client={d1Client} reload={reload} onError={onError} /> : null}
      {activeTab === "users" ? <UsersPanel profiles={profiles} loading={loadingUsers} canManagePermissions={profile?.role === "owner"} onCreate={(input) => createStudent(input)} onReload={() => void loadProfiles()} onUpdate={(id, patch) => updateProfile(id, patch)} /> : null}
      {activeTab === "notifications" ? <NotificationsPanel onError={onError} /> : null}
      {activeTab === "reports" ? <ReportsPanel onError={onError} /> : null}
      {activeTab === "diagnostics" ? <DiagnosticsPanel canManageR2={capabilities.canManageR2} d1Client={d1Client} reload={reload} onError={onError} /> : null}
    </div>
  );
}

function GeneralPanel({ stats }: { stats: { courses: number; sections: number; activeSections: number; tasks: number } }) {
  return <section className="adminPanelGrid"><MetricCard label="Tareas" value={stats.tasks} help="Últimas tareas cargadas" /><MetricCard label="Materias" value={stats.courses} help="Catálogo visual" /><MetricCard label="Secciones" value={stats.sections} help={`${stats.activeSections} visibles`} /><MetricCard label="Storage" value="R2" help="Subidas directas" /></section>;
}

function MetricCard({ label, value, help }: { label: string; value: string | number; help: string }) { return <article className="metricCard"><span>{label}</span><strong>{value}</strong><small>{help}</small></article>; }

function notificationResultLabel(inserted: number, email?: EmailDispatchResult) {
  if (!email) return `${inserted} avisos creados`;
  if (!email.configured) return `${inserted} avisos creados · correo no configurado`;
  const failed = email.failed ? ` · ${email.failed} fallidos` : "";
  return `${inserted} avisos creados · ${email.delivered} correos enviados${failed}`;
}

function NotificationsPanel({ onError }: { onError: (error: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [priority, setPriority] = useState("normal");
  const [kind, setKind] = useState("system");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<AdminNotification[]>([]);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRecent() {
    try {
      const response = await fetch("/api/admin/notifications", { credentials: "include", cache: "no-store" });
      const payload = await response.json() as { notifications?: AdminNotification[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron cargar avisos.");
      setRecent(payload.notifications ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudieron cargar avisos.");
    }
  }

  async function sendNotification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, audience, priority, kind }),
      });
      const payload = await response.json() as { inserted?: number; email?: EmailDispatchResult; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar el aviso.");
      setResult(notificationResultLabel(payload.inserted ?? 0, payload.email));
      setTitle("");
      setBody("");
      await loadRecent();
      window.dispatchEvent(new CustomEvent("pscv:notifications-changed"));
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo enviar el aviso.");
    } finally {
      setBusy(false);
    }
  }

  async function generateDueNotifications() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/notifications/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays: 3 }),
      });
      const payload = await response.json() as { inserted?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron generar recordatorios.");
      setResult(`${payload.inserted ?? 0} recordatorios de los próximos 3 días creados`);
      await loadRecent();
      window.dispatchEvent(new CustomEvent("pscv:notifications-changed"));
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudieron generar recordatorios.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adminCard">
      <div className="adminCardHead">
        <div><h3>Avisos</h3><p>Crea avisos persistentes y recordatorios para tareas próximas.</p></div>
        <button type="button" onClick={() => void generateDueNotifications()} disabled={busy}>{busy ? "Procesando..." : "Crear recordatorios (3 días)"}</button>
      </div>
      <div className="adminNoticeHelp">
        <p><strong>Recordatorios:</strong> crea un aviso para cada alumno y cada tarea visible, pendiente y con vencimiento entre hoy y los próximos 3 días. No duplica un recordatorio ya creado.</p>
        <p><strong>Nueva tarea / Tarea actualizada:</strong> son avisos automáticos dirigidos a alumnos. Por eso no aparecen en la campana del administrador. El historial inferior agrupa las filas individuales por entrega.</p>
        <p><strong>Entrega:</strong> la campana funciona dentro de PSCV Room; navegador y sonido requieren permiso y la app abierta. El correo se envía actualmente para avisos manuales cuando el alumno lo activó.</p>
      </div>
      <form className="adminNoticeForm" onSubmit={sendNotification}>
        <label className="wide">Título<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aviso para el grupo" required /></label>
        <label className="wide">Mensaje<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Detalle opcional" /></label>
        <label>Audiencia<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="all">Todos</option><option value="students">Alumnos</option><option value="admins">Administradores</option></select></label>
        <label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="system">Sistema</option><option value="reminder">Recordatorio</option><option value="material_added">Material</option><option value="task_updated">Tarea</option></select></label>
        <label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
        <button className="primaryAction" type="submit" disabled={busy || !title.trim()}>{busy ? "Enviando..." : "Enviar aviso"}</button>
      </form>
      {result ? <p className="adminResult">{result}</p> : null}
      <div className="adminNoticeList">
        {recent.slice(0, 8).map((notice) => <article key={notice.id}><strong>{notice.title}</strong><span>{notice.kind} · {notice.priority} · {notice.recipient_count} destinatarios · {notice.read_count} leídos · {notice.dismissed_count} ocultos · {formatDateTime(notice.created_at)}</span></article>)}
        {!recent.length ? <p className="muted">Sin avisos recientes.</p> : null}
      </div>
    </section>
  );
}

function ReportsPanel({ onError }: { onError: (error: string | null) => void }) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ReportPayload | null>(null);

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReports() {
    setLoading(true);
    try {
      const response = await fetch("/api/reports/operations", { credentials: "include" });
      const body = await response.json() as ReportPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "No se pudieron cargar reportes.");
      setPayload(body);
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudieron cargar reportes.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="reportsGrid">
      <article className="adminCard">
        <div className="adminCardHead"><div><h3>Reportes</h3><p>Tareas, materiales, seguimiento y auditoría operativa.</p></div><button type="button" onClick={() => void loadReports()}>{loading ? "Cargando..." : "Recargar"}</button></div>
        <ReportTable title="Tareas" rows={payload?.tasks ?? []} />
      </article>
      <article className="adminCard"><ReportTable title="Materiales" rows={payload?.materials ?? []} /></article>
      <article className="adminCard"><ReportTable title="Seguimiento alumnos" rows={payload?.students ?? []} /></article>
      <article className="adminCard"><ReportTable title="Auditoría reciente" rows={payload?.audit ?? []} /></article>
    </section>
  );
}

function ReportTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  const columns = rows[0] ? Object.keys(rows[0]).slice(0, 6) : [];
  return (
    <div className="reportTableBlock">
      <h4>{title}</h4>
      <div className="reportTableWrap">
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 12).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatReportValue(row[column])}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {!rows.length ? <p className="muted">Sin datos.</p> : null}
    </div>
  );
}

function DiagnosticsPanel({ canManageR2, d1Client, reload, onError }: { canManageR2: boolean; d1Client: D1Browser | null; reload: () => Promise<void>; onError: (error: string | null) => void }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    void loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d1Client]);

  async function loadDiagnostics() {
    setLoading(true);
    const [health, destinations, library, r2Status, counts] = await Promise.all([
      safeJson<HealthPayload>("/api/health"),
      safeJson<DestinationsPayload>("/api/uploads/destinations"),
      safeJson<LibraryPayload>("/api/materials/library?limit=25"),
      canManageR2 ? safeJson<R2StatusPayload>("/api/admin/r2/status") : Promise.resolve({ data: null, error: null }),
      loadDiagnosticCounts(d1Client),
    ]);

    setSnapshot({
      checkedAt: new Date().toISOString(),
      health: health.data,
      healthError: health.error,
      destinations: destinations.data,
      destinationsError: destinations.error,
      library: library.data,
      libraryError: library.error,
      r2Status: r2Status.data,
      r2StatusError: r2Status.error,
      counts: counts.counts,
      countErrors: counts.errors,
    });
    setLoading(false);
  }

  async function runImport(dryRun: boolean) {
    setImportBusy(true);
    try {
      const response = await fetch("/api/admin/r2/import-materials", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, reset: false, maxItems: 50000 }),
      });
      const body = await response.json().catch(() => ({})) as ImportResult;
      setImportResult(body);
      if (!response.ok || body.error) throw new Error(body.error ?? "No se pudo ejecutar el importador R2.");
      if (!dryRun) await reload();
      await loadDiagnostics();
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo ejecutar el importador R2.");
    } finally {
      setImportBusy(false);
    }
  }

  const destinations = snapshot?.destinations?.destinations ?? [];
  const r2Destinations = destinations.filter((destination) => destination.source === "r2").length;
  const d1Destinations = destinations.filter((destination) => destination.source === "d1").length;
  const providers = snapshot?.library?.summary?.providers ?? {};
  const r2Status = snapshot?.r2Status;
  const healthOk = Boolean(snapshot?.health?.ok && snapshot.health.auth?.configured && snapshot.health.integrations?.d1 && snapshot.health.integrations?.r2);

  return (
    <section className="diagnosticsLayout">
      <article className="adminCard diagnosticCard">
        <div className="adminCardHead">
          <div><h3>Estado operativo</h3><p>{snapshot ? `Revisado ${formatDateTime(snapshot.checkedAt)}` : "Sin revisión cargada"}</p></div>
          <button type="button" onClick={() => void loadDiagnostics()}>{loading ? "Revisando..." : "Revisar"}</button>
        </div>
        <div className="diagnosticPills">
          <DiagnosticPill label="App" ok={!snapshot?.healthError && Boolean(snapshot?.health?.ok)} />
          <DiagnosticPill label="Auth" ok={!snapshot?.healthError && Boolean(snapshot?.health?.auth?.configured)} />
          <DiagnosticPill label="D1" ok={!snapshot?.healthError && Boolean(snapshot?.health?.integrations?.d1)} />
          <DiagnosticPill label="R2" ok={!snapshot?.healthError && Boolean(snapshot?.health?.integrations?.r2)} />
        </div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Modo" value={snapshot?.health?.mode ?? "sin dato"} />
          <DiagnosticRow label="BD" value={snapshot?.health?.integrations?.d1 ? "D1 activo" : "sin D1"} />
          <DiagnosticRow label="Resultado" value={snapshot?.healthError ?? (healthOk ? "listo" : "requiere revisión")} />
        </div>
      </article>

      <article className="adminCard diagnosticCard">
        <div className="adminCardHead"><div><h3>R2 y biblioteca</h3><p>Destinos visibles para subida y materiales indexados.</p></div></div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Bucket" value={r2Status?.bucket ?? "psicologia"} />
          <DiagnosticRow label="Endpoint" value={r2Status?.endpoint ?? "sin dato"} />
          <DiagnosticRow label="URL pública" value={r2Status?.publicBaseUrl ?? "sin dato"} />
          <DiagnosticRow label="Raíz R2" value={snapshot?.destinations?.root ?? r2Status?.root ?? "bucket root"} />
          <DiagnosticRow label="Destinos totales" value={destinations.length} />
          <DiagnosticRow label="Desde R2" value={r2Destinations} />
          <DiagnosticRow label="Desde D1" value={d1Destinations} />
          <DiagnosticRow label="Materiales visibles" value={snapshot?.library?.summary?.materials ?? 0} />
          <DiagnosticRow label="Secciones visibles" value={snapshot?.library?.summary?.sections ?? 0} />
        </div>
        {r2Status?.variables ? <div className="diagnosticSample">{Object.entries(r2Status.variables).map(([name, ok]) => <span key={name}>{name}: {ok ? "ok" : "falta"}</span>)}</div> : null}
        {r2Status?.folders?.length ? <div className="diagnosticSample">{r2Status.folders.slice(0, 10).map((path) => <span key={path}>{path || "bucket root"}</span>)}</div> : null}
        {r2Status?.sampleObjects?.length ? <div className="diagnosticSample">{r2Status.sampleObjects.map((object) => <span key={object.key}>{object.key}</span>)}</div> : null}
        {snapshot?.r2StatusError ? <p className="diagnosticError">{snapshot.r2StatusError}</p> : null}
        {r2Status?.error ? <p className="diagnosticError">{r2Status.error}</p> : null}
        {snapshot?.destinationsError ? <p className="diagnosticError">{snapshot.destinationsError}</p> : null}
        {snapshot?.libraryError ? <p className="diagnosticError">{snapshot.libraryError}</p> : null}
        <div className="diagnosticSample">{destinations.slice(0, 7).map((destination) => <span key={destination.id}>{destination.path}</span>)}</div>
      </article>

      <article className="adminCard diagnosticCard">
        <div className="adminCardHead"><div><h3>D1</h3><p>Conteos rápidos para detectar tablas vacías o permisos mal aplicados.</p></div></div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Perfiles" value={formatCount(snapshot?.counts.profiles)} />
          <DiagnosticRow label="Tareas activas" value={formatCount(snapshot?.counts.tasks)} />
          <DiagnosticRow label="Materiales" value={formatCount(snapshot?.counts.materials)} />
          <DiagnosticRow label="Secciones activas" value={formatCount(snapshot?.counts.sections)} />
          <DiagnosticRow label="Columnas grupo" value={formatCount(snapshot?.counts.groupColumns)} />
        </div>
        {snapshot?.countErrors.map((error) => <p className="diagnosticError" key={error}>{error}</p>)}
      </article>

      <article className="adminCard diagnosticCard importer">
        <div className="adminCardHead"><div><h3>Importador R2</h3><p>Sincroniza carpetas y archivos del bucket con D1.</p></div></div>
        {canManageR2 ? (
          <div className="diagnosticActions">
            <button type="button" onClick={() => void runImport(true)} disabled={importBusy}>{importBusy ? "Ejecutando..." : "Simular"}</button>
            <button className="primaryAction" type="button" onClick={() => void runImport(false)} disabled={importBusy}>Sincronizar R2</button>
          </div>
        ) : <p className="muted">Tu perfil no tiene permiso para ejecutar sincronización R2.</p>}
        {importResult ? (
          <div className="importResult">
            <strong>{importResult.dryRun ? "Simulación" : "Sincronización"}</strong>
            <span>Raíz: {importResult.root ?? "psicologia"}</span>
            <span>Objetos: {importResult.scannedObjects ?? importResult.importedObjects ?? 0}</span>
            <span>Secciones: {importResult.sectionsToEnsure ?? importResult.ensuredSections ?? 0}</span>
            {!importResult.dryRun ? <span>Insertados/actualizados: {importResult.inserted ?? 0}/{importResult.updated ?? 0}</span> : null}
            {importResult.sampleSections?.length ? <small>{importResult.sampleSections.slice(0, 8).join(" · ")}</small> : null}
            {importResult.error ? <p className="diagnosticError">{importResult.error}</p> : null}
          </div>
        ) : null}
        <div className="diagnosticSample">{Object.entries(providers).map(([provider, count]) => <span key={provider}>{provider}: {count}</span>)}</div>
      </article>
    </section>
  );
}

function TasksPanel({ tasks, loading, onReload, onUpdate }: { tasks: AdminTaskRow[]; loading: boolean; onReload: () => void; onUpdate: (id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) => void }) {
  return <section className="adminCard"><div className="adminCardHead"><div><h3>Tareas próximas</h3><p>Actualiza estado y visibilidad sin abrir la base.</p></div><button type="button" onClick={onReload}>{loading ? "Cargando..." : "Recargar"}</button></div><div className="adminTaskList">{tasks.map((task) => <TaskAdminRow key={task.id} task={task} onUpdate={onUpdate} />)}{!tasks.length && !loading ? <p className="muted">No hay tareas cargadas.</p> : null}</div></section>;
}

function TaskAdminRow({ task, onUpdate }: { task: AdminTaskRow; onUpdate: (id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) => void }) {
  const course = first(task.courses);
  const type = first(task.task_types);
  return <article className="adminTaskRow" style={{ borderLeftColor: course?.color ?? type?.color ?? "#4285dc" }}><div><strong>{task.title}</strong><small>{course?.name ?? "Sin materia"} · {type?.name ?? "Tarea"} · {task.due_date} {task.due_time?.slice(0, 5) ?? ""}</small></div><select value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value })}><option>Pendiente</option><option>Se entrega hoy</option><option>Entregado</option><option>Reprogramado</option><option>Cancelado</option></select><select value={task.priority} onChange={(event) => onUpdate(task.id, { priority: event.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select><label><input type="checkbox" checked={task.visible_to_students} onChange={(event) => onUpdate(task.id, { visible_to_students: event.target.checked })} />Visible</label></article>;
}

function CoursesPanel({ courses, onCreate, onUpdate }: { courses: CourseConfig[]; onCreate: (input: CourseDraft) => Promise<boolean>; onUpdate: (id: string, patch: Partial<CourseConfig>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<CourseDraft>(() => emptyCourseDraft());
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const created = await onCreate(draft);
    if (created) setDraft(emptyCourseDraft());
    setBusy(false);
  }

  return (
    <section className="adminCard">
      <div className="adminCardHead"><div><h3>Materias</h3><p>Agrega materias y controla cuáles aparecen para alumnos.</p></div></div>
      <form className="adminInlineForm courseCreateForm" onSubmit={submit}>
        <label className="wide">Nombre<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre de la materia" required /></label>
        <label>Nombre corto<input value={draft.shortName} onChange={(event) => setDraft((current) => ({ ...current, shortName: event.target.value }))} placeholder="Corto" /></label>
        <label>Color<input type="color" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} /></label>
        <label>Icono<input value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))} placeholder="book" /></label>
        <label>Tamaño<select value={draft.cardSize} onChange={(event) => setDraft((current) => ({ ...current, cardSize: event.target.value as CardSize }))}><option value="compact">Compacta</option><option value="medium">Media</option><option value="large">Grande</option></select></label>
        <button className="primaryAction" type="submit" disabled={busy || !draft.name.trim()}>{busy ? "Agregando..." : "Agregar materia"}</button>
      </form>
      <div className="adminRows">
        {courses.map((course) => <CourseAdminRow key={course.id} course={course} onUpdate={onUpdate} />)}
        {!courses.length ? <p className="muted">No hay materias cargadas.</p> : null}
      </div>
    </section>
  );
}

function CourseAdminRow({ course, onUpdate }: { course: CourseConfig; onUpdate: (id: string, patch: Partial<CourseConfig>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<CourseDraft>(() => courseToDraft(course));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(courseToDraft(course));
  }, [course]);

  const dirty = draft.name !== course.name || draft.shortName !== course.shortName || draft.color !== course.color || draft.icon !== course.icon || draft.cardSize !== course.cardSize;

  async function save() {
    setSaving(true);
    const saved = await onUpdate(course.id, {
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || draft.name.trim(),
      color: draft.color,
      icon: draft.icon.trim() || "book",
      cardSize: draft.cardSize,
    });
    if (!saved) setDraft(courseToDraft(course));
    setSaving(false);
  }

  return (
    <div className={`adminEditRow course ${course.active ? "" : "inactive"}`}>
      <span className="swatch" style={{ background: draft.color }} />
      <input aria-label="Nombre de materia" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
      <input aria-label="Nombre corto" value={draft.shortName} onChange={(event) => setDraft((current) => ({ ...current, shortName: event.target.value }))} />
      <input aria-label="Color" type="color" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} />
      <input aria-label="Icono" value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))} />
      <select aria-label="Tamaño" value={draft.cardSize} onChange={(event) => setDraft((current) => ({ ...current, cardSize: event.target.value as CardSize }))}><option value="compact">Compacta</option><option value="medium">Media</option><option value="large">Grande</option></select>
      <button type="button" onClick={() => void save()} disabled={saving || !dirty || !draft.name.trim()}>{saving ? "Guardando..." : "Guardar"}</button>
      <button type="button" onClick={() => void onUpdate(course.id, { active: !course.active })}>{course.active ? "Desactivar" : "Activar"}</button>
    </div>
  );
}

function SectionsPanel({ sections, onUpdate }: { sections: SectionConfig[]; onUpdate: (id: string, patch: Partial<SectionConfig>) => void }) { return <section className="adminCard"><div className="adminCardHead"><div><h3>Secciones de materiales</h3><p>Personaliza carpetas y subsecciones del asset R2.</p></div></div><div className="adminRows">{sections.map((section) => <div className="adminEditRow section" key={section.id}><span className="swatch" style={{ background: section.color }} /><div className="adminNameBlock"><strong>{section.name}</strong><small>{section.path}</small></div><input aria-label="Color" type="color" value={section.color} onChange={(event) => onUpdate(section.id, { color: event.target.value })} /><input aria-label="Icono" value={section.icon} onChange={(event) => onUpdate(section.id, { icon: event.target.value })} /><select aria-label="Preview" value={section.previewStyle} onChange={(event) => onUpdate(section.id, { previewStyle: event.target.value })}><option value="none">Sin preview</option><option value="icon">Icono</option><option value="thumbnail">Miniatura</option><option value="embedded">Embebido</option></select></div>)}</div></section>; }

function MaterialUploadPanel({ canManageR2, d1Client, reload, onError }: { canManageR2: boolean; d1Client: D1Browser | null; reload: () => Promise<void>; onError: (error: string | null) => void }) {
  const [destinations, setDestinations] = useState<UploadDestination[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingDestinations, setLoadingDestinations] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadDestinations() {
      if (!canManageR2) return;
      setLoadingDestinations(true);
      try {
        const response = await fetch("/api/uploads/destinations", { credentials: "include" });
        const body = await response.json() as { destinations?: UploadDestination[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar destinos R2.");
        if (!cancelled) setDestinations(bucketDestinations(body.destinations ?? []));
      } catch (error) {
        if (!cancelled) setDestinations([]);
        if (!cancelled && error instanceof Error) onError(error.message);
      } finally {
        if (!cancelled) setLoadingDestinations(false);
      }
    }
    void loadDestinations();
    return () => { cancelled = true; };
  }, [canManageR2, onError]);

  useEffect(() => {
    if (!destinations.length) {
      if (destinationId) setDestinationId("");
      return;
    }
    if (!destinationId || !destinations.some((destination) => destination.id === destinationId)) {
      setDestinationId(destinations[0].id);
    }
  }, [destinationId, destinations]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const destination = destinations.find((item) => item.id === destinationId);
    if (!canManageR2) {
      onError("Tu perfil no tiene permiso para subir archivos a R2.");
      return;
    }
    if (!file || !destination || destination.source !== "r2" || !d1Client) {
      onError("Selecciona un archivo y una carpeta válida del bucket.");
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("fileName", file.name);
      formData.set("sectionPath", destination.path);

      const response = await fetch("/api/uploads/direct", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const body = await response.json() as { key?: string; publicUrl?: string | null; error?: string };
      if (!response.ok || !body.key) throw new Error(body.error ?? "No se pudo subir el archivo.");

      const { error } = await d1Client.from("materials").insert({
        section_id: destination.sectionId,
        title: title || file.name,
        file_name: file.name,
        material_type: file.type.includes("pdf") ? "PDF" : "Archivo",
        provider: "r2",
        r2_key: body.key,
        source_url: body.publicUrl,
        preview_url: body.publicUrl,
        content_type: file.type || null,
        size_bytes: file.size,
      });
      if (error) throw new Error(error.message);

      setTitle("");
      setFile(null);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo subir el material.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManageR2) return <section className="adminCard"><div className="adminCardHead"><div><h3>Subir material</h3><p>Tu perfil puede administrar materiales, pero no tiene permiso para crear cargas R2.</p></div></div></section>;

  return (
    <section className="adminCard">
      <div className="adminCardHead"><div><h3>Subir material</h3><p>Guarda el archivo en R2 y registra la metadata en D1.</p></div></div>
      <form className="adminUpload" onSubmit={submit}>
        <label>
          Destino
          <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} disabled={loadingDestinations || !destinations.length}>
            {destinations.length ? destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>{destination.path}</option>
            )) : <option value="">{loadingDestinations ? "Cargando carpetas del bucket..." : "Sin carpetas del bucket"}</option>}
          </select>
        </label>
        <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Opcional" /></label>
        <label>Archivo<input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="primaryAction" disabled={busy || loadingDestinations || !destinations.length} type="submit">{busy ? "Subiendo..." : "Subir a R2"}</button>
      </form>
    </section>
  );
}

function UsersPanel({ profiles, loading, canManagePermissions, onCreate, onReload, onUpdate }: { profiles: AppProfileRow[]; loading: boolean; canManagePermissions: boolean; onCreate: (input: StudentDraft) => Promise<boolean>; onReload: () => void; onUpdate: (id: string, patch: Partial<AppProfileRow>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<StudentDraft>(() => emptyStudentDraft());
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const created = await onCreate(draft);
    if (created) setDraft(emptyStudentDraft());
    setBusy(false);
  }

  return (
    <section className="adminCard">
      <div className="adminCardHead"><div><h3>Usuarios</h3><p>Agrega alumnos y mantén sus datos de acceso escolar.</p></div><button type="button" onClick={onReload}>{loading ? "Cargando..." : "Recargar"}</button></div>
      <form className="adminInlineForm studentCreateForm" onSubmit={submit}>
        <label>No. Control<input value={draft.controlNumber} onChange={(event) => setDraft((current) => ({ ...current, controlNumber: event.target.value }))} placeholder="28699" /></label>
        <label>Correo<input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="alumno@univdep.edu.mx" required /></label>
        <label className="wide">Nombre completo<input value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} placeholder="Nombre completo" required /></label>
        <button className="primaryAction" type="submit" disabled={busy || !draft.email.trim() || !draft.fullName.trim()}>{busy ? "Agregando..." : "Agregar alumno"}</button>
      </form>
      <div className="adminUserList">
        {profiles.map((profile) => (
          <UserAdminRow key={profile.id} profile={profile} canManagePermissions={canManagePermissions} onUpdate={onUpdate} />
        ))}
        {!profiles.length && !loading ? <p className="muted">No se pudieron cargar usuarios o no hay permisos RLS para leerlos.</p> : null}
      </div>
    </section>
  );
}

function UserAdminRow({ profile, canManagePermissions, onUpdate }: { profile: AppProfileRow; canManagePermissions: boolean; onUpdate: (id: string, patch: Partial<AppProfileRow>) => Promise<boolean> }) {
  const [draft, setDraft] = useState(() => profileToDraft(profile));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(profileToDraft(profile));
  }, [profile]);

  const dirty = draft.fullName !== (profile.full_name ?? "") || draft.email !== profile.email || draft.controlNumber !== (profile.control_number ?? "");

  async function save() {
    setSaving(true);
    const saved = await onUpdate(profile.id, {
      full_name: draft.fullName.trim() || profile.email,
      email: draft.email.trim().toLowerCase(),
      control_number: draft.controlNumber.trim() || null,
    });
    if (!saved) setDraft(profileToDraft(profile));
    setSaving(false);
  }

  return (
    <article className={`adminUserRow permissions ${profile.active ? "" : "inactive"}`}>
      <div className="adminUserFields">
        <input aria-label="Nombre completo" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} />
        <input aria-label="Correo" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />
        <input aria-label="No. Control" value={draft.controlNumber} onChange={(event) => setDraft((current) => ({ ...current, controlNumber: event.target.value }))} placeholder="sin control" />
      </div>
      <select value={profile.role} disabled={!canManagePermissions} onChange={(event) => void onUpdate(profile.id, { role: event.target.value as AppProfileRow["role"] })}><option value="student">Alumno</option><option value="admin">Admin</option><option value="owner">Owner</option></select>
      <div className="adminUserActions">
        <button type="button" onClick={() => void save()} disabled={saving || !dirty || !draft.email.trim() || !draft.fullName.trim()}>{saving ? "Guardando..." : "Guardar"}</button>
        <button type="button" onClick={() => void onUpdate(profile.id, { active: !profile.active })}>{profile.active ? "Desactivar" : "Activar"}</button>
      </div>
      <div className="adminPermissionGrid">
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_edit_tasks} onChange={(event) => void onUpdate(profile.id, { can_edit_tasks: event.target.checked })} />Tareas</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_delete_tasks} onChange={(event) => void onUpdate(profile.id, { can_delete_tasks: event.target.checked })} />Eliminar</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_materials} onChange={(event) => void onUpdate(profile.id, { can_manage_materials: event.target.checked })} />Materiales</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_users} onChange={(event) => void onUpdate(profile.id, { can_manage_users: event.target.checked })} />Usuarios</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_settings} onChange={(event) => void onUpdate(profile.id, { can_manage_settings: event.target.checked })} />Ajustes</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_group} onChange={(event) => void onUpdate(profile.id, { can_manage_group: event.target.checked })} />Grupo</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_notifications} onChange={(event) => void onUpdate(profile.id, { can_manage_notifications: event.target.checked })} />Avisos</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_view_reports} onChange={(event) => void onUpdate(profile.id, { can_view_reports: event.target.checked })} />Reportes</label>
        <label><input type="checkbox" disabled={!canManagePermissions} checked={profile.can_manage_r2} onChange={(event) => void onUpdate(profile.id, { can_manage_r2: event.target.checked })} />R2</label>
      </div>
    </article>
  );
}

function emptyCourseDraft(): CourseDraft {
  return { name: "", shortName: "", color: "#2f77d0", icon: "book", cardSize: "medium" };
}

function courseToDraft(course: CourseConfig): CourseDraft {
  return { name: course.name, shortName: course.shortName, color: course.color, icon: course.icon, cardSize: course.cardSize };
}

function emptyStudentDraft(): StudentDraft {
  return { controlNumber: "", email: "", fullName: "" };
}

function profileToDraft(profile: AppProfileRow): StudentDraft {
  return { controlNumber: profile.control_number ?? "", email: profile.email, fullName: profile.full_name ?? "" };
}

function sortProfiles(a: AppProfileRow, b: AppProfileRow) {
  return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, "es");
}

function toCourseConfig(row: Record<string, unknown>): CourseConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name ?? row.name),
    color: String(row.color ?? "#2f77d0"),
    icon: String(row.icon ?? "book"),
    cardSize: row.card_size === "compact" || row.card_size === "large" ? row.card_size : "medium",
    active: Boolean(row.active ?? true),
  };
}

async function safeJson<T>(url: string) {
  try {
    const response = await fetch(url, { credentials: "include" });
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok || body.error) throw new Error(body.error ?? `No se pudo leer ${url}.`);
    return { data: body as T, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : `No se pudo leer ${url}.` };
  }
}

async function loadDiagnosticCounts(d1Client: D1Browser | null): Promise<{ counts: DiagnosticCounts; errors: string[] }> {
  const counts: DiagnosticCounts = { profiles: null, tasks: null, materials: null, sections: null, groupColumns: null };
  if (!d1Client) return { counts, errors: ["D1 no está configurado en el navegador."] };

  const queries = [
    { key: "profiles", label: "Perfiles", query: d1Client.from("app_profiles").select("id", { count: "exact", head: true }) },
    { key: "tasks", label: "Tareas", query: d1Client.from("tasks").select("id", { count: "exact", head: true }).is("archived_at", null) },
    { key: "materials", label: "Materiales", query: d1Client.from("materials").select("id", { count: "exact", head: true }) },
    { key: "sections", label: "Secciones", query: d1Client.from("material_sections").select("id", { count: "exact", head: true }).eq("active", true) },
    { key: "groupColumns", label: "Columnas grupo", query: d1Client.from("group_columns").select("id", { count: "exact", head: true }).eq("active", true) },
  ] as const;

  const results = await Promise.all(queries.map(async (item) => ({ ...item, result: await item.query })));
  const errors: string[] = [];

  for (const item of results) {
    if (item.result.error) {
      errors.push(`${item.label}: ${item.result.error.message}`);
      continue;
    }
    counts[item.key] = item.result.count ?? 0;
  }

  return { counts, errors };
}

function DiagnosticPill({ label, ok }: { label: string; ok: boolean }) {
  return <span className={ok ? "diagnosticPill ok" : "diagnosticPill"}>{label}</span>;
}

function DiagnosticRow({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatCount(value: number | null | undefined) {
  return value == null ? "sin permiso" : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatReportValue(value: string | number | boolean | null | undefined) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  return String(value);
}

function bucketDestinations(destinations: UploadDestination[]) {
  const map = new Map<string, UploadDestination>();
  for (const destination of destinations) {
    if (destination.source !== "r2") continue;
    const key = destination.path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (!key) continue;
    map.set(key, {
      ...destination,
      path: destination.path.trim().replace(/\\/g, "/").replace(/\/+$/, ""),
    });
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path, "es"));
}

function first<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function toDbPatch(patch: Partial<CourseConfig> | Partial<SectionConfig>) { const out: Record<string, unknown> = { updated_at: new Date().toISOString() }; if ("name" in patch) out.name = patch.name; if ("shortName" in patch) out.short_name = patch.shortName; if ("color" in patch) out.color = patch.color; if ("icon" in patch) out.icon = patch.icon; if ("cardSize" in patch) out.card_size = patch.cardSize; if ("previewStyle" in patch) out.preview_style = patch.previewStyle; if ("active" in patch) out.active = patch.active; return out; }
