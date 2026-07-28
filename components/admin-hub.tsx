"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  FolderSync,
  FolderTree,
  Gauge,
  HardDrive,
  Layers3,
  LayoutDashboard,
  ListTodo,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { MATERIAL_UPLOAD_ACCEPT, MAX_DIRECT_MATERIAL_BYTES } from "@/lib/material-file-policy";
import { materialDisplayName } from "@/lib/material-display-name";
import { createD1BrowserClient } from "@/lib/d1/client";
import { canAccessAdminTab, getSessionCapabilities } from "@/lib/auth-permissions";

type D1Browser = NonNullable<ReturnType<typeof createD1BrowserClient>>;
type AdminTab = "general" | "tasks" | "calendar" | "courses" | "sections" | "materials" | "users" | "notifications" | "reports" | "diagnostics";
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
type ReportDatasetId = "tasks" | "materials" | "students" | "audit";
type SortDirection = "ascending" | "descending";
type ReportSummaryItem = { label: string; value: string | number; help: string; icon: LucideIcon; tone?: "default" | "warning" };
type AdminLibraryMaterial = {
  id: string;
  title: string;
  material_type: string | null;
  provider: string | null;
  source_url: string | null;
  preview_url: string | null;
  download_url: string | null;
  size_bytes: number | null;
  section_id: string | null;
  section: { id: string; name: string; path: string; color: string | null } | null;
};
type AdminLibrarySection = { id: string; name: string; path: string; material_count?: number };
type AdminLibraryPayload = { materials?: AdminLibraryMaterial[]; sections?: AdminLibrarySection[]; summary?: { materials: number; sections: number; providers: Record<string, number> }; error?: string };

type AdminHubProps = { courses: CourseConfig[]; sections: SectionConfig[]; columns?: unknown[]; profile?: AdminProfile; d1Client: D1Browser | null; reload: () => Promise<void>; onCourses: (courses: CourseConfig[]) => void; onSections: (sections: SectionConfig[]) => void; onError: (error: string | null) => void };

const tabs: Array<{ id: AdminTab; label: string; icon: LucideIcon }> = [
  { id: "general", label: "General", icon: LayoutDashboard },
  { id: "tasks", label: "Tareas", icon: ListTodo },
  { id: "calendar", label: "Calendario", icon: CalendarDays },
  { id: "courses", label: "Materias", icon: BookOpen },
  { id: "sections", label: "Secciones", icon: FolderTree },
  { id: "materials", label: "Materiales", icon: FolderOpen },
  { id: "users", label: "Usuarios", icon: Users },
  { id: "notifications", label: "Avisos", icon: Bell },
  { id: "reports", label: "Reportes", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: Activity },
];

export function AdminHub({ courses, sections, profile = null, d1Client, reload, onCourses, onSections, onError }: AdminHubProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("general");
  const [profiles, setProfiles] = useState<AppProfileRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [adminTasks, setAdminTasks] = useState<AdminTaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const tabRefs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});
  const capabilities = useMemo(() => getSessionCapabilities(profile), [profile]);
  const visibleTabs = useMemo(() => tabs.filter((tab) => canAccessAdminTab(capabilities, tab.id === "calendar" ? "tasks" : tab.id)), [capabilities]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab("general");
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    tabRefs.current[activeTab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  function moveAdminTab(event: KeyboardEvent<HTMLButtonElement>, currentTab: AdminTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = visibleTabs.findIndex((tab) => tab.id === currentTab);
    if (currentIndex < 0) return;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? visibleTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    const nextTab = visibleTabs[nextIndex];
    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => tabRefs.current[nextTab.id]?.focus());
  }

  // Tab-driven loads intentionally run only when the active admin module changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "users") void loadProfiles(); }, [activeTab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === "general" || activeTab === "tasks" || activeTab === "calendar") void loadTaskAdminData(); }, [activeTab]);

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

    const response = await fetch("/api/admin/students", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: nextProfile.email,
        fullName: nextProfile.full_name,
        controlNumber: nextProfile.control_number ?? "",
        active: true,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      onError(typeof payload.error === "string" ? payload.error : "No se pudo crear el alumno.");
      return false;
    }

    await reload();
    return true;
  }

  async function updateProfile(id: string, patch: Partial<AppProfileRow>) {
    const previous = profiles;
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
    if (!d1Client) return true;
    const response = await fetch("/api/admin/students", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        email: patch.email,
        fullName: patch.full_name,
        controlNumber: patch.control_number ?? "",
        active: patch.active ?? true,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setProfiles(previous);
      onError(typeof payload.error === "string" ? payload.error : "No se pudo actualizar el usuario.");
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
      <nav className="adminTabs" aria-label="Módulos de administración" role="tablist">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[tab.id] = node; }}
              id={`admin-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`admin-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => moveAdminTab(event, tab.id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <div
        className="adminTabPanel"
        id={`admin-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "general" ? <GeneralPanel stats={stats} onNavigate={setActiveTab} /> : null}
        {activeTab === "tasks" ? <TasksPanel tasks={adminTasks} loading={loadingTasks} onReload={() => void loadTaskAdminData()} onUpdate={(id, patch) => void updateTask(id, patch)} /> : null}
        {activeTab === "calendar" ? <AdminCalendarPanel tasks={adminTasks} loading={loadingTasks} onReload={() => void loadTaskAdminData()} onUpdate={(id, patch) => void updateTask(id, patch)} /> : null}
        {activeTab === "courses" ? <CoursesPanel courses={courses} onCreate={(input) => createCourse(input)} onUpdate={(id, patch) => updateCourse(id, patch)} /> : null}
        {activeTab === "sections" ? <SectionsPanel sections={sections} onUpdate={(id, patch) => void updateSection(id, patch)} /> : null}
        {activeTab === "materials" ? <MaterialUploadPanel canManageR2={capabilities.canManageR2} d1Client={d1Client} reload={reload} onError={onError} /> : null}
        {activeTab === "users" ? <UsersPanel profiles={profiles} loading={loadingUsers} canManagePermissions={profile?.role === "owner"} onCreate={(input) => createStudent(input)} onReload={() => void loadProfiles()} onUpdate={(id, patch) => updateProfile(id, patch)} /> : null}
        {activeTab === "notifications" ? <NotificationsPanel onError={onError} /> : null}
        {activeTab === "reports" ? <ReportsPanel onError={onError} /> : null}
        {activeTab === "diagnostics" ? <DiagnosticsPanel canManageR2={capabilities.canManageR2} d1Client={d1Client} reload={reload} onError={onError} /> : null}
      </div>
    </div>
  );
}

function GeneralPanel({ stats, onNavigate }: { stats: { courses: number; sections: number; activeSections: number; tasks: number }; onNavigate: (tab: AdminTab) => void }) {
  return <section className="adminPanelGrid" aria-label="Accesos rápidos de administración"><MetricCard icon={ListTodo} label="Tareas" value={stats.tasks} help="Entregas operativas" onClick={() => onNavigate("tasks")} /><MetricCard icon={BookOpen} label="Materias" value={stats.courses} help="Catálogo visual" onClick={() => onNavigate("courses")} /><MetricCard icon={FolderTree} label="Secciones" value={stats.sections} help={`${stats.activeSections} visibles`} onClick={() => onNavigate("sections")} /><MetricCard icon={HardDrive} label="Storage" value="R2" help="Subidas directas" onClick={() => onNavigate("materials")} /></section>;
}

function MetricCard({ icon: Icon, label, value, help, onClick }: { icon: LucideIcon; label: string; value: string | number; help: string; onClick: () => void }) { return <button type="button" className="metricCard" aria-label={`Abrir ${label}`} onClick={onClick}><span className="metricCardIcon"><Icon size={18} aria-hidden="true" /></span><span>{label}</span><strong>{value}</strong><small>{help}</small><ChevronRight className="metricCardChevron" size={18} aria-hidden="true" /></button>; }

function notificationResultLabel(inserted: number, systemDeliveryQueued: boolean, email?: EmailDispatchResult) {
  const system = systemDeliveryQueued ? " · entrega al sistema iniciada" : "";
  if (!email) return `${inserted} avisos creados${system}`;
  if (!email.configured) return `${inserted} avisos creados${system} · correo no configurado`;
  const failed = email.failed ? ` · ${email.failed} fallidos` : "";
  return `${inserted} avisos creados${system} · ${email.delivered} correos enviados${failed}`;
}

function NotificationsPanel({ onError }: { onError: (error: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [priority, setPriority] = useState("normal");
  const [kind, setKind] = useState("system");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
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
        body: JSON.stringify({ title, body, audience, priority, kind, media_url: mediaUrl.trim() || null, media_type: mediaUrl.trim() ? mediaType : null }),
      });
      const payload = await response.json() as { inserted?: number; systemDeliveryQueued?: boolean; email?: EmailDispatchResult; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar el aviso.");
      setResult(notificationResultLabel(payload.inserted ?? 0, Boolean(payload.systemDeliveryQueued), payload.email));
      setTitle("");
      setBody("");
      setMediaUrl("");
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
        body: JSON.stringify({ windowDays: 1 }),
      });
      const payload = await response.json() as { synchronized?: number; created?: number; updated?: number; preserved?: number; dismissed?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron generar recordatorios.");
      setResult(`${payload.synchronized ?? 0} entregas sincronizadas · ${payload.created ?? 0} recordatorios creados`);
      await loadRecent();
      window.dispatchEvent(new CustomEvent("pscv:notifications-changed"));
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudieron generar recordatorios.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adminCard adminModule adminNoticesModule" aria-busy={busy}>
      <div className="adminCardHead">
        <div><p className="adminModuleEyebrow">Comunicación</p><h3>Avisos</h3><p>Crea avisos persistentes y recordatorios para tareas próximas.</p></div>
        <button type="button" onClick={() => void generateDueNotifications()} disabled={busy}><CalendarClock size={16} aria-hidden="true" />{busy ? "Procesando..." : "Sincronizar recordatorios (hoy y mañana)"}</button>
      </div>
      <div className="adminNoticeHelp">
        <p><strong>Recordatorios:</strong> sincroniza avisos para cada alumno y cada tarea visible, pendiente y con vencimiento hoy o mañana. No crea recordatorios de dos o tres días antes ni duplica uno vigente.</p>
        <p><strong>Nueva tarea / Tarea actualizada:</strong> son avisos automáticos dirigidos a alumnos. Por eso no aparecen en la campana del administrador. El historial inferior agrupa las filas individuales por entrega.</p>
        <p><strong>Entrega:</strong> cada aviso y recordatorio intenta enviarse de inmediato como notificación del sistema y también permanece en la campana. Web Push funciona con la app cerrada en Android, Windows e iOS compatibles. En iPhone/iPad debe instalarse en Inicio; el sistema siempre requiere permiso.</p>
      </div>
      <form className="adminNoticeForm" onSubmit={sendNotification}>
        <label className="wide">Título<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aviso para el grupo" required /></label>
        <label className="wide">Mensaje<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Detalle opcional" /></label>
        <label className="wide">Archivo multimedia (URL)<input type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://... imagen, video, audio o archivo" /></label>
        <label>Tipo de archivo<select value={mediaType} onChange={(event) => setMediaType(event.target.value)} disabled={!mediaUrl.trim()}><option value="image">Imagen</option><option value="video">Video</option><option value="audio">Audio</option><option value="file">Archivo</option></select></label>
        <label>Audiencia<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="all">Todos</option><option value="students">Alumnos</option><option value="admins">Administradores</option></select></label>
        <label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="system">Sistema</option><option value="reminder">Recordatorio</option><option value="material_added">Material</option><option value="task_updated">Tarea</option></select></label>
        <label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
        <button className="primaryAction" type="submit" disabled={busy || !title.trim()}>{busy ? "Enviando..." : "Enviar aviso"}</button>
      </form>
      {result ? <p className="adminResult" role="status" aria-live="polite">{result}</p> : null}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<ReportDatasetId>("tasks");
  const [query, setQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReports() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/reports/operations", { credentials: "include" });
      const body = await response.json() as ReportPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "No se pudieron cargar reportes.");
      setPayload(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron cargar reportes.";
      setLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }

  const datasets = useMemo(() => [
    { id: "tasks" as const, label: "Tareas", description: "Estado, vencimientos y próxima entrega", rows: payload?.tasks ?? [] },
    { id: "materials" as const, label: "Materiales", description: "Volumen y almacenamiento por sección", rows: payload?.materials ?? [] },
    { id: "students" as const, label: "Alumnos", description: "Perfiles activos por rol", rows: payload?.students ?? [] },
    { id: "audit" as const, label: "Auditoría", description: "Actividad administrativa reciente", rows: payload?.audit ?? [] },
  ], [payload]);
  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId) ?? datasets[0];
  const columns = selectedDataset.rows[0] ? Object.keys(selectedDataset.rows[0]) : [];
  const displayedRows = useMemo(
    () => filterAndSortReportRows(selectedDataset.rows, query, sortColumn, sortDirection),
    [query, selectedDataset.rows, sortColumn, sortDirection],
  );
  const summary = useMemo(() => reportSummary(payload), [payload]);

  function selectDataset(nextDataset: ReportDatasetId) {
    setDatasetId(nextDataset);
    setQuery("");
    setSortColumn(null);
    setSortDirection("ascending");
  }

  function sortBy(column: string) {
    if (sortColumn === column) {
      setSortDirection((current) => current === "ascending" ? "descending" : "ascending");
      return;
    }
    setSortColumn(column);
    setSortDirection("ascending");
  }

  return (
    <section className="reportsGrid adminModule adminReportsModule" aria-busy={loading}>
      <article className="adminCard adminReportsLead">
        <div className="adminCardHead">
          <div><p className="adminModuleEyebrow">Análisis operativo</p><h3>Reportes</h3><p>Tareas, materiales, seguimiento y auditoría operativa.</p></div>
          <button type="button" onClick={() => void loadReports()} disabled={loading}><RefreshCw className={loading ? "isSpinning" : ""} size={16} aria-hidden="true" />{loading ? "Cargando..." : "Recargar"}</button>
        </div>
        {loadError ? <p className="reportError" role="alert"><CircleAlert size={17} aria-hidden="true" />{loadError}</p> : null}
        <div className="reportSummaryGrid" aria-label="Resumen de reportes">
          {summary.map((item) => <ReportSummaryCard key={item.label} {...item} />)}
        </div>
        <div className="reportToolbar" aria-label="Controles del reporte">
          <label>
            <span>Conjunto de datos</span>
            <select value={datasetId} onChange={(event) => selectDataset(event.target.value as ReportDatasetId)}>
              {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}
            </select>
          </label>
          <label>
            <span>Buscar</span>
            <span className="reportSearchField"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar en ${selectedDataset.label.toLowerCase()}`} /></span>
          </label>
          <button className="reportExportButton" type="button" disabled={!displayedRows.length} onClick={() => exportReportCsv(selectedDataset.label, columns, displayedRows)}><Download size={16} aria-hidden="true" />Exportar CSV</button>
        </div>
        <div className="reportDatasetHead">
          <div><FileSpreadsheet size={19} aria-hidden="true" /><span><strong>{selectedDataset.label}</strong><small>{selectedDataset.description}</small></span></div>
          <span className="reportCounter" role="status" aria-live="polite">{displayedRows.length} de {selectedDataset.rows.length}</span>
        </div>
        <ReportTable
          datasetId={datasetId}
          title={selectedDataset.label}
          rows={displayedRows}
          columns={columns}
          loading={loading && !payload}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={sortBy}
        />
      </article>
    </section>
  );
}

function ReportSummaryCard({ label, value, help, icon: Icon, tone = "default" }: { label: string; value: string | number; help: string; icon: LucideIcon; tone?: "default" | "warning" }) {
  return (
    <article className={`reportSummaryCard ${tone === "warning" ? "warning" : ""}`}>
      <span className="reportSummaryIcon"><Icon size={18} aria-hidden="true" /></span>
      <span><small>{label}</small><strong>{value}</strong><em>{help}</em></span>
    </article>
  );
}

function ReportTable({ datasetId, title, rows, columns, loading, sortColumn, sortDirection, onSort }: { datasetId: ReportDatasetId; title: string; rows: ReportRow[]; columns: string[]; loading: boolean; sortColumn: string | null; sortDirection: SortDirection; onSort: (column: string) => void }) {
  return (
    <div className="reportTableBlock">
      <div className="reportTableWrap" role="region" aria-label={`Tabla de ${title}`} tabIndex={0}>
        <table>
          <caption className="reportSrOnly">{title}. Usa desplazamiento horizontal cuando sea necesario.</caption>
          <thead><tr>{columns.map((column) => (
            <th key={column} scope="col" aria-sort={sortColumn === column ? sortDirection : "none"}>
              <button type="button" onClick={() => onSort(column)}>{reportColumnLabel(column)}<ArrowUpDown size={13} aria-hidden="true" /></button>
            </th>
          ))}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={`${datasetId}-${String(row.id ?? row.entity_id ?? "row")}-${index}`}>
              {columns.map((column) => {
                const value = formatReportValue(row[column], column);
                return <td key={column} title={value}>{value}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {loading ? <p className="reportTableState" role="status">Cargando datos…</p> : !rows.length ? <p className="reportTableState">Sin resultados para los filtros actuales.</p> : null}
    </div>
  );
}

function DiagnosticsPanel({ canManageR2, d1Client, reload, onError }: { canManageR2: boolean; d1Client: D1Browser | null; reload: () => Promise<void>; onError: (error: string | null) => void }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);

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
    if (!dryRun && importResult?.dryRun !== true) {
      onError("Primero ejecuta una simulación correcta antes de sincronizar R2.");
      return;
    }
    onError(null);
    setConfirmSync(false);
    if (dryRun) setImportResult(null);
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
  const canSynchronize = Boolean(importResult?.dryRun && !importResult.error);

  return (
    <section className="diagnosticsLayout adminModule adminDiagnosticsModule" aria-busy={loading || importBusy}>
      <p className="diagnosticLiveStatus" role="status" aria-live="polite">{loading ? "Revisando servicios" : importBusy ? "Procesando cambios de R2" : "Diagnóstico listo"}</p>
      <article className="adminCard diagnosticCard">
        <div className="adminCardHead">
          <div><p className="adminModuleEyebrow">Infraestructura</p><h3>Estado operativo</h3><p>{snapshot ? `Revisado ${formatDateTime(snapshot.checkedAt)}` : "Sin revisión cargada"}</p></div>
          <button type="button" onClick={() => void loadDiagnostics()} disabled={loading}><RefreshCw className={loading ? "isSpinning" : ""} size={16} aria-hidden="true" />{loading ? "Revisando..." : "Revisar"}</button>
        </div>
        <div className="diagnosticPills">
          <DiagnosticPill label="App" icon={Gauge} pending={loading || !snapshot} ok={!snapshot?.healthError && Boolean(snapshot?.health?.ok)} />
          <DiagnosticPill label="Auth" icon={ShieldCheck} pending={loading || !snapshot} ok={!snapshot?.healthError && Boolean(snapshot?.health?.auth?.configured)} />
          <DiagnosticPill label="D1" icon={Database} pending={loading || !snapshot} ok={!snapshot?.healthError && Boolean(snapshot?.health?.integrations?.d1)} />
          <DiagnosticPill label="R2" icon={Cloud} pending={loading || !snapshot} ok={!snapshot?.healthError && Boolean(snapshot?.health?.integrations?.r2)} />
        </div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Modo" value={snapshot?.health?.mode ?? "sin dato"} />
          <DiagnosticRow label="BD" value={snapshot?.health?.integrations?.d1 ? "D1 activo" : "sin D1"} />
          <DiagnosticRow label="Resultado" value={snapshot?.healthError ?? (healthOk ? "listo" : "requiere revisión")} />
        </div>
      </article>

      <article className="adminCard diagnosticCard">
        <div className="adminCardHead"><div><h3 className="diagnosticTitle"><Cloud size={19} aria-hidden="true" />R2 y biblioteca</h3><p>Destinos visibles para subida y materiales indexados.</p></div></div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Bucket" value={nonEmptyValue(r2Status?.bucket, "psicologia")} />
          <DiagnosticRow label="Endpoint" value={nonEmptyValue(r2Status?.endpoint, "sin dato")} />
          <DiagnosticRow label="URL pública" value={nonEmptyValue(r2Status?.publicBaseUrl, "sin dato")} />
          <DiagnosticRow label="Raíz R2" value={nonEmptyValue(snapshot?.destinations?.root ?? r2Status?.root, "bucket root")} />
          <DiagnosticRow label="Destinos totales" value={destinations.length} />
          <DiagnosticRow label="Desde R2" value={r2Destinations} />
          <DiagnosticRow label="Desde D1" value={d1Destinations} />
          <DiagnosticRow label="Materiales visibles" value={snapshot?.library?.summary?.materials ?? 0} />
          <DiagnosticRow label="Secciones visibles" value={snapshot?.library?.summary?.sections ?? 0} />
        </div>
        <div className="diagnosticDetailsStack">
          <DiagnosticDetails title="Variables de entorno" count={Object.keys(r2Status?.variables ?? {}).length}>
            <div className="diagnosticSample diagnosticCodeList">{Object.entries(r2Status?.variables ?? {}).map(([name, ok]) => <span className={ok ? "ok" : "missing"} key={name}><code>{name}</code><strong>{ok ? "Configurada" : "Falta"}</strong></span>)}</div>
          </DiagnosticDetails>
          <DiagnosticDetails title="Carpetas detectadas" count={r2Status?.folders?.length ?? 0}>
            <div className="diagnosticSample">{r2Status?.folders?.length ? r2Status.folders.map((path) => <span key={path}>{path || "bucket root"}</span>) : <span>Sin carpetas detectadas</span>}</div>
          </DiagnosticDetails>
          <DiagnosticDetails title="Objetos de muestra" count={r2Status?.sampleObjects?.length ?? 0}>
            <div className="diagnosticObjectList">{r2Status?.sampleObjects?.length ? r2Status.sampleObjects.map((object) => <div key={object.key}><code>{object.key}</code><span>{formatByteCount(object.size)}{object.lastModified ? ` · ${formatDateTime(object.lastModified)}` : ""}</span></div>) : <p>Sin objetos de muestra.</p>}</div>
          </DiagnosticDetails>
          <DiagnosticDetails title="Destinos de carga" count={destinations.length}>
            <div className="diagnosticSample">{destinations.length ? destinations.map((destination) => <span key={destination.id}>{destination.path}</span>) : <span>Sin destinos disponibles</span>}</div>
          </DiagnosticDetails>
        </div>
        {snapshot?.r2StatusError ? <p className="diagnosticError" role="alert">{snapshot.r2StatusError}</p> : null}
        {r2Status?.error ? <p className="diagnosticError" role="alert">{r2Status.error}</p> : null}
        {snapshot?.destinationsError ? <p className="diagnosticError" role="alert">{snapshot.destinationsError}</p> : null}
        {snapshot?.libraryError ? <p className="diagnosticError" role="alert">{snapshot.libraryError}</p> : null}
      </article>

      <article className="adminCard diagnosticCard">
        <div className="adminCardHead"><div><h3 className="diagnosticTitle"><Database size={19} aria-hidden="true" />D1</h3><p>Conteos rápidos para detectar tablas vacías o permisos mal aplicados.</p></div></div>
        <div className="diagnosticRows">
          <DiagnosticRow label="Perfiles" value={formatCount(snapshot?.counts.profiles)} />
          <DiagnosticRow label="Tareas activas" value={formatCount(snapshot?.counts.tasks)} />
          <DiagnosticRow label="Materiales" value={formatCount(snapshot?.counts.materials)} />
          <DiagnosticRow label="Secciones activas" value={formatCount(snapshot?.counts.sections)} />
          <DiagnosticRow label="Columnas grupo" value={formatCount(snapshot?.counts.groupColumns)} />
        </div>
        {snapshot?.countErrors.map((error) => <p className="diagnosticError" role="alert" key={error}>{error}</p>)}
      </article>

      <article className="adminCard diagnosticCard importer" aria-busy={importBusy}>
        <div className="adminCardHead"><div><h3 className="diagnosticTitle"><FolderSync size={19} aria-hidden="true" />Importador R2</h3><p>Simula primero y sincroniza carpetas y archivos del bucket con D1 cuando el resultado sea correcto.</p></div></div>
        {canManageR2 ? (
          <div className="diagnosticActions">
            <button type="button" onClick={() => void runImport(true)} disabled={importBusy}><FlaskConical size={16} aria-hidden="true" />{importBusy ? "Procesando..." : "Simular cambios"}</button>
            <button className="primaryAction" type="button" onClick={() => setConfirmSync(true)} disabled={importBusy || !canSynchronize}><FolderSync size={16} aria-hidden="true" />Continuar a sincronización</button>
          </div>
        ) : <p className="muted">Tu perfil no tiene permiso para ejecutar sincronización R2.</p>}
        {canManageR2 && !canSynchronize && !importBusy ? <p className="diagnosticHint">Ejecuta una simulación correcta para habilitar la sincronización.</p> : null}
        {confirmSync && canSynchronize ? (
          <div className="diagnosticConfirmation" role="group" aria-labelledby="r2-confirm-title">
            <div><strong id="r2-confirm-title">¿Aplicar los cambios simulados?</strong><p>La sincronización escribirá secciones y materiales en D1 sin eliminar registros existentes.</p></div>
            <div><button type="button" onClick={() => setConfirmSync(false)} disabled={importBusy}>Cancelar</button><button className="primaryAction" type="button" onClick={() => void runImport(false)} disabled={importBusy}>Confirmar sincronización</button></div>
          </div>
        ) : null}
        {importResult ? (
          <div className="importResult" role={importResult.error ? "alert" : "status"} aria-live="polite" aria-atomic="true">
            <strong>{importResult.dryRun ? "Simulación" : "Sincronización"}</strong>
            <span>Raíz: {importResult.root ?? "psicologia"}</span>
            <span>Objetos: {importResult.scannedObjects ?? importResult.importedObjects ?? 0}</span>
            <span>Secciones: {importResult.sectionsToEnsure ?? importResult.ensuredSections ?? 0}</span>
            {!importResult.dryRun ? <span>Insertados/actualizados: {importResult.inserted ?? 0}/{importResult.updated ?? 0}</span> : null}
            {importResult.sampleSections?.length ? <small>{importResult.sampleSections.slice(0, 8).join(" · ")}</small> : null}
            {importResult.error ? <p className="diagnosticError">{importResult.error}</p> : null}
          </div>
        ) : null}
        <DiagnosticDetails title="Proveedores indexados" count={Object.keys(providers).length}>
          <div className="diagnosticSample">{Object.keys(providers).length ? Object.entries(providers).map(([provider, count]) => <span key={provider}>{provider}: {count}</span>) : <span>Sin proveedores indexados</span>}</div>
        </DiagnosticDetails>
      </article>
    </section>
  );
}

function AdminInsightCard({ icon: Icon, label, value, help, tone = "default" }: { icon: LucideIcon; label: string; value: string | number; help: string; tone?: "default" | "warning" | "success" }) {
  return (
    <article className={`adminInsightCard ${tone}`}>
      <span><Icon size={18} aria-hidden="true" /></span>
      <div><small>{label}</small><strong>{value}</strong><em>{help}</em></div>
    </article>
  );
}

function TasksPanel({ tasks, loading, onReload, onUpdate }: { tasks: AdminTaskRow[]; loading: boolean; onReload: () => void; onUpdate: (id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortMode, setSortMode] = useState("due-asc");
  const today = adminTodayKey();
  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    const filtered = tasks.filter((task) => {
      const course = first(task.courses)?.name ?? "";
      const type = first(task.task_types)?.name ?? "";
      const matchesQuery = !normalizedQuery || [task.title, course, type, task.status, task.priority, task.due_date].some((value) => value.toLocaleLowerCase("es").includes(normalizedQuery));
      return matchesQuery && (statusFilter === "all" || task.status === statusFilter) && (priorityFilter === "all" || task.priority === priorityFilter);
    });
    return filtered.sort((firstTask, secondTask) => compareAdminTasks(firstTask, secondTask, sortMode));
  }, [priorityFilter, query, sortMode, statusFilter, tasks]);
  const pendingTasks = tasks.filter((task) => !isTerminalAdminTask(task)).length;
  const overdueTasks = tasks.filter((task) => !isTerminalAdminTask(task) && task.due_date < today).length;
  const dueToday = tasks.filter((task) => !isTerminalAdminTask(task) && task.due_date === today).length;
  const visibleToStudents = tasks.filter((task) => task.visible_to_students).length;

  return (
    <section className="adminModule adminTasksModule" aria-busy={loading}>
      <article className="adminCard">
        <div className="adminCardHead">
          <div><p className="adminModuleEyebrow">Operación académica</p><h3>Tareas</h3><p>Busca, prioriza y actualiza entregas sin perder el contexto.</p></div>
          <button type="button" onClick={onReload} disabled={loading}><RefreshCw className={loading ? "isSpinning" : ""} size={16} aria-hidden="true" />{loading ? "Cargando..." : "Recargar"}</button>
        </div>
        <div className="adminInsightGrid" aria-label="Resumen de tareas">
          <AdminInsightCard icon={ListTodo} label="Pendientes" value={pendingTasks} help="por atender" />
          <AdminInsightCard icon={CircleAlert} label="Vencidas" value={overdueTasks} help="requieren seguimiento" tone={overdueTasks ? "warning" : "default"} />
          <AdminInsightCard icon={CalendarClock} label="Hoy" value={dueToday} help="con vencimiento hoy" />
          <AdminInsightCard icon={Eye} label="Visibles" value={visibleToStudents} help="para alumnos" tone="success" />
        </div>
        <div className="adminWorkspaceToolbar" aria-label="Filtros de tareas">
          <label className="adminWorkspaceSearch"><span>Buscar</span><span><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Título, materia o tipo" /></span></label>
          <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option>Pendiente</option><option>Se entrega hoy</option><option>Entregado</option><option>Reprogramado</option><option>Cancelado</option></select></label>
          <label><span>Prioridad</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">Todas</option><option>Alta</option><option>Media</option><option>Baja</option></select></label>
          <label><span>Orden</span><select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="due-asc">Fecha próxima</option><option value="due-desc">Fecha lejana</option><option value="title">Título</option><option value="priority">Prioridad</option></select></label>
        </div>
        <div className="adminWorkspaceCounter"><strong>Entregas visibles</strong><span role="status" aria-live="polite">{visibleTasks.length} de {tasks.length}</span></div>
        <div className="adminTaskList">
          {visibleTasks.map((task) => <TaskAdminRow key={task.id} task={task} onUpdate={onUpdate} />)}
          {!visibleTasks.length && !loading ? <p className="adminWorkspaceEmpty">No hay tareas para los filtros actuales.</p> : null}
        </div>
      </article>
    </section>
  );
}

function TaskAdminRow({ task, onUpdate }: { task: AdminTaskRow; onUpdate: (id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) => void }) {
  const course = first(task.courses);
  const type = first(task.task_types);
  const TaskIcon = type?.name === "Evento" ? CalendarDays : FileText;
  return (
    <article className="adminTaskRow" style={{ borderLeftColor: course?.color ?? type?.color ?? "#4285dc" }}>
      <div className="adminTaskIdentity"><span className="adminTaskIcon"><TaskIcon size={17} aria-hidden="true" /></span><span><strong>{task.title}</strong><small>{course?.name ?? "Sin materia"} · {type?.name ?? "Tarea"}</small><small><CalendarClock size={13} aria-hidden="true" />{formatAdminTaskDate(task)}</small></span></div>
      <label className="adminTaskControl"><span>Estado</span><select aria-label={`Estado de ${task.title}`} value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value })}><option>Pendiente</option><option>Se entrega hoy</option><option>Entregado</option><option>Reprogramado</option><option>Cancelado</option></select></label>
      <label className="adminTaskControl"><span>Prioridad</span><select aria-label={`Prioridad de ${task.title}`} value={task.priority} onChange={(event) => onUpdate(task.id, { priority: event.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></label>
      <label className="adminTaskVisibility"><input aria-label={`Mostrar ${task.title} a alumnos`} type="checkbox" checked={task.visible_to_students} onChange={(event) => onUpdate(task.id, { visible_to_students: event.target.checked })} />Visible</label>
    </article>
  );
}

function AdminCalendarPanel({ tasks, loading, onReload, onUpdate }: { tasks: AdminTaskRow[]; loading: boolean; onReload: () => void; onUpdate: (id: string, patch: Partial<Pick<AdminTaskRow, "status" | "visible_to_students" | "priority">>) => void }) {
  const [cursor, setCursor] = useState(() => startOfAdminMonth(new Date()));
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const today = adminTodayKey();
  const monthTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return tasks
      .filter((task) => task.due_date.startsWith(monthKey))
      .filter((task) => statusFilter === "all" || task.status === statusFilter)
      .filter((task) => !normalizedQuery || [task.title, first(task.courses)?.name ?? "", first(task.task_types)?.name ?? ""].some((value) => value.toLocaleLowerCase("es").includes(normalizedQuery)))
      .sort((firstTask, secondTask) => compareAdminTasks(firstTask, secondTask, "due-asc"));
  }, [monthKey, query, statusFilter, tasks]);
  const tasksByDate = useMemo(() => monthTasks.reduce<Map<string, AdminTaskRow[]>>((map, task) => map.set(task.due_date, [...(map.get(task.due_date) ?? []), task]), new Map()), [monthTasks]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const pendingInMonth = monthTasks.filter((task) => !isTerminalAdminTask(task)).length;
  const eventsInMonth = monthTasks.filter((task) => first(task.task_types)?.name === "Evento").length;
  const todayInMonth = monthTasks.filter((task) => task.due_date === today).length;
  const cells = adminMonthCells(cursor);

  function moveMonth(offset: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    setSelectedTaskId(null);
  }

  return (
    <section className="adminModule adminCalendarModule" aria-busy={loading}>
      <article className="adminCard">
        <div className="adminCardHead">
          <div><p className="adminModuleEyebrow">Planeación visual</p><h3>Calendario</h3><p>Explora vencimientos por mes y actualiza la entrega seleccionada.</p></div>
          <button type="button" onClick={onReload} disabled={loading}><RefreshCw className={loading ? "isSpinning" : ""} size={16} aria-hidden="true" />{loading ? "Cargando..." : "Recargar"}</button>
        </div>
        <div className="adminInsightGrid" aria-label="Resumen del calendario">
          <AdminInsightCard icon={CalendarDays} label="Programadas" value={monthTasks.length} help="en el mes" />
          <AdminInsightCard icon={ListTodo} label="Pendientes" value={pendingInMonth} help="por completar" />
          <AdminInsightCard icon={CalendarClock} label="Hoy" value={todayInMonth} help="vencen hoy" tone={todayInMonth ? "warning" : "default"} />
          <AdminInsightCard icon={Layers3} label="Eventos" value={eventsInMonth} help="en agenda" />
        </div>
        <div className="adminCalendarControls">
          <div className="adminCalendarNavigation"><button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" onClick={() => { setCursor(startOfAdminMonth(new Date())); setSelectedTaskId(null); }}>Hoy</button><button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button><strong aria-live="polite">{adminMonthLabel(cursor)}</strong></div>
          <div className="adminCalendarFilters"><label className="adminWorkspaceSearch"><span>Buscar</span><span><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en el mes" /></span></label><label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option>Pendiente</option><option>Se entrega hoy</option><option>Entregado</option><option>Reprogramado</option><option>Cancelado</option></select></label></div>
        </div>
        <div className="adminCalendarScroll" role="region" aria-label={`Calendario de ${adminMonthLabel(cursor)}`} tabIndex={0}>
          <div className="adminCalendarGrid" role="grid">
            {adminWeekdays.map((weekday) => <div className="adminCalendarWeekday" role="columnheader" key={weekday}>{weekday}</div>)}
            {cells.map((dateKey, index) => dateKey ? (
              <article className={`adminCalendarDay ${dateKey === today ? "today" : ""}`} role="gridcell" key={dateKey}>
                <time dateTime={dateKey}>{Number(dateKey.slice(-2))}</time>
                <div>{(tasksByDate.get(dateKey) ?? []).slice(0, 3).map((task) => <button className={adminTaskTone(task)} type="button" aria-pressed={selectedTaskId === task.id} onClick={() => setSelectedTaskId(task.id)} key={task.id}>{task.title}</button>)}{(tasksByDate.get(dateKey)?.length ?? 0) > 3 ? <small>+{(tasksByDate.get(dateKey)?.length ?? 0) - 3} más</small> : null}</div>
              </article>
            ) : <div className="adminCalendarDay empty" role="gridcell" aria-label="Fuera del mes" key={`empty-${index}`} />)}
          </div>
        </div>
        <div className="adminCalendarAgenda" aria-label={`Agenda de ${adminMonthLabel(cursor)}`}>
          {monthTasks.map((task) => <button type="button" aria-pressed={selectedTaskId === task.id} onClick={() => setSelectedTaskId(task.id)} key={task.id}><time dateTime={task.due_date}>{formatAdminDate(task.due_date)}</time><span><strong>{task.title}</strong><small>{first(task.courses)?.name ?? "Sin materia"} · {task.status}</small></span><ChevronRight size={16} aria-hidden="true" /></button>)}
          {!monthTasks.length ? <p className="adminWorkspaceEmpty">No hay actividades para este mes y filtros.</p> : null}
        </div>
        {selectedTask ? (
          <aside className="adminCalendarSelection" aria-live="polite">
            <div><span className="adminTaskIcon"><CalendarClock size={17} aria-hidden="true" /></span><span><small>Entrega seleccionada</small><strong>{selectedTask.title}</strong><em>{formatAdminTaskDate(selectedTask)}</em></span></div>
            <label><span>Estado</span><select value={selectedTask.status} onChange={(event) => onUpdate(selectedTask.id, { status: event.target.value })}><option>Pendiente</option><option>Se entrega hoy</option><option>Entregado</option><option>Reprogramado</option><option>Cancelado</option></select></label>
            <label><span>Prioridad</span><select value={selectedTask.priority} onChange={(event) => onUpdate(selectedTask.id, { priority: event.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></label>
            <label className="adminTaskVisibility"><input type="checkbox" checked={selectedTask.visible_to_students} onChange={(event) => onUpdate(selectedTask.id, { visible_to_students: event.target.checked })} />Visible</label>
          </aside>
        ) : <p className="adminCalendarHint">Selecciona una entrega del calendario para editarla.</p>}
      </article>
    </section>
  );
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
    <section className="adminCard adminModule adminCoursesModule">
      <div className="adminCardHead"><div><p className="adminModuleEyebrow">Catálogo académico</p><h3>Materias</h3><p>Agrega materias y controla cuáles aparecen para alumnos.</p></div></div>
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
  const [libraryMaterials, setLibraryMaterials] = useState<AdminLibraryMaterial[]>([]);
  const [librarySections, setLibrarySections] = useState<AdminLibrarySection[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState("all");
  const [librarySort, setLibrarySort] = useState("title");
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [bucketSyncBusy, setBucketSyncBusy] = useState(false);
  const [bucketSyncResult, setBucketSyncResult] = useState<string | null>(null);

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

  useEffect(() => {
    void loadMaterialLibrary();
    // The library loader is intentionally tied to the mounted materials module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMaterialLibrary() {
    setLoadingLibrary(true);
    setLibraryError(null);
    try {
      const response = await fetch("/api/materials/library?limit=500", { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as AdminLibraryPayload;
      if (!response.ok || payload.error) throw new Error(payload.error ?? "No se pudo cargar la biblioteca del bucket.");
      setLibraryMaterials(payload.materials ?? []);
      setLibrarySections(payload.sections ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar la biblioteca del bucket.";
      setLibraryError(message);
      onError(message);
    } finally {
      setLoadingLibrary(false);
    }
  }

  async function synchronizeBucket() {
    if (!canManageR2) return;
    setBucketSyncBusy(true);
    setBucketSyncResult(null);
    onError(null);
    try {
      const response = await fetch("/api/admin/r2/import-materials", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, maxItems: 10000 }),
      });
      const payload = await response.json().catch(() => ({})) as ImportResult;
      if (!response.ok || payload.error) throw new Error(payload.error ?? "No se pudo sincronizar el bucket.");
      setBucketSyncResult(`${payload.importedObjects ?? 0} objetos revisados · ${payload.inserted ?? 0} insertados · ${payload.updated ?? 0} actualizados`);
      await loadMaterialLibrary();
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo sincronizar el bucket.");
    } finally {
      setBucketSyncBusy(false);
    }
  }

  const visibleMaterials = useMemo(() => {
    const normalizedQuery = libraryQuery.trim().toLocaleLowerCase("es");
    return libraryMaterials
      .filter((material) => librarySection === "all" || material.section_id === librarySection)
      .filter((material) => !normalizedQuery || [material.title, material.material_type ?? "", material.provider ?? "", material.section?.name ?? "", material.section?.path ?? ""].some((value) => value.toLocaleLowerCase("es").includes(normalizedQuery)))
      .sort((firstMaterial, secondMaterial) => compareAdminMaterials(firstMaterial, secondMaterial, librarySort));
  }, [libraryMaterials, libraryQuery, librarySection, librarySort]);
  const bucketMaterials = libraryMaterials.filter((material) => material.provider === "r2").length;
  const libraryBytes = libraryMaterials.reduce((total, material) => total + (material.size_bytes ?? 0), 0);

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
    if (file.size > MAX_DIRECT_MATERIAL_BYTES) {
      onError("El archivo supera el límite de 50 MB para carga directa.");
      return;
    }

    setBusy(true);
    setUploadResult(null);
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
      setUploadResult(`${file.name} se guardó en ${destination.path}.`);
      await loadMaterialLibrary();
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo subir el material.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adminMaterialsGrid adminModule adminMaterialsModule" aria-busy={busy || loadingLibrary || bucketSyncBusy}>
      <article className="adminCard adminMaterialUploadCard">
        <div className="adminCardHead"><div><p className="adminModuleEyebrow">Carga segura</p><h3 className="adminWorkspaceTitle"><Upload size={19} aria-hidden="true" />Subir material</h3><p>Guarda el archivo en R2 y registra la metadata en D1.</p></div></div>
        {canManageR2 ? (
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
            <label>Archivo<input type="file" accept={MATERIAL_UPLOAD_ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>PDF, Office, OpenDocument, texto, ZIP o imagen; máximo 50 MB.</small></label>
            <button className="primaryAction" disabled={busy || loadingDestinations || !destinations.length || !file} type="submit"><Upload size={16} aria-hidden="true" />{busy ? "Subiendo..." : "Subir a R2"}</button>
          </form>
        ) : <p className="adminWorkspaceEmpty">Tu perfil puede consultar materiales, pero no crear cargas R2.</p>}
        {uploadResult ? <p className="adminWorkspaceResult" role="status" aria-live="polite">{uploadResult}</p> : null}
      </article>

      <article className="adminCard adminMaterialLibraryCard">
        <div className="adminCardHead"><div><p className="adminModuleEyebrow">Biblioteca conectada</p><h3 className="adminWorkspaceTitle"><FolderOpen size={19} aria-hidden="true" />Materiales del bucket</h3><p>Consulta, filtra y abre cada material indexado de forma independiente.</p></div><div className="adminCardHeadActions"><button type="button" onClick={() => void loadMaterialLibrary()} disabled={loadingLibrary || bucketSyncBusy}><RefreshCw className={loadingLibrary ? "isSpinning" : ""} size={16} aria-hidden="true" />{loadingLibrary ? "Cargando..." : "Recargar"}</button>{canManageR2 ? <button className="primaryAction" type="button" onClick={() => void synchronizeBucket()} disabled={bucketSyncBusy || loadingLibrary}><FolderSync className={bucketSyncBusy ? "isSpinning" : ""} size={16} aria-hidden="true" />{bucketSyncBusy ? "Sincronizando..." : "Sincronizar bucket"}</button> : null}</div></div>
        {libraryError ? <p className="adminWorkspaceError" role="alert"><CircleAlert size={16} aria-hidden="true" />{libraryError}</p> : null}
        {bucketSyncResult ? <p className="adminWorkspaceResult" role="status" aria-live="polite">{bucketSyncResult}</p> : null}
        <div className="adminInsightGrid" aria-label="Resumen de materiales">
          <AdminInsightCard icon={FileText} label="Materiales" value={libraryMaterials.length} help="indexados" />
          <AdminInsightCard icon={FolderTree} label="Secciones" value={librarySections.length} help="disponibles" />
          <AdminInsightCard icon={Cloud} label="En R2" value={bucketMaterials} help="desde el bucket" tone="success" />
          <AdminInsightCard icon={HardDrive} label="Almacenamiento" value={formatByteCount(libraryBytes)} help="en resultados" />
        </div>
        <div className="adminWorkspaceToolbar material" aria-label="Filtros de materiales">
          <label className="adminWorkspaceSearch"><span>Buscar</span><span><Search size={16} aria-hidden="true" /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Título, sección o tipo" /></span></label>
          <label><span>Sección</span><select value={librarySection} onChange={(event) => setLibrarySection(event.target.value)}><option value="all">Todas</option>{librarySections.map((section) => <option value={section.id} key={section.id}>{section.name}</option>)}</select></label>
          <label><span>Orden</span><select value={librarySort} onChange={(event) => setLibrarySort(event.target.value)}><option value="title">Título</option><option value="section">Sección</option><option value="size-desc">Mayor tamaño</option><option value="size-asc">Menor tamaño</option></select></label>
        </div>
        <div className="adminWorkspaceCounter"><strong>Resultados</strong><span role="status" aria-live="polite">{visibleMaterials.length} de {libraryMaterials.length}</span></div>
        <div className="adminMaterialResults">
          {visibleMaterials.map((material) => {
            const previewHref = material.preview_url ?? material.source_url;
            const downloadHref = material.download_url ?? material.source_url;
            return (
              <article className="adminMaterialResult" style={{ borderLeftColor: material.section?.color ?? "#2a79a6" }} key={material.id}>
                <span className="adminMaterialResultIcon"><FileText size={18} aria-hidden="true" /></span>
                <div><strong>{materialDisplayName(material.title)}</strong><small>{material.section?.name ?? "Sin sección"} · {material.material_type ?? "Archivo"} · {formatByteCount(material.size_bytes ?? 0)}</small></div>
                <div className="adminMaterialActions">{previewHref ? <a href={previewHref} target="_blank" rel="noreferrer"><Eye size={15} aria-hidden="true" />Vista previa</a> : null}{downloadHref ? <a href={downloadHref}><Download size={15} aria-hidden="true" />Descargar</a> : null}</div>
              </article>
            );
          })}
          {!visibleMaterials.length && !loadingLibrary ? <p className="adminWorkspaceEmpty">No hay materiales para los filtros actuales. Si el bucket ya tiene archivos, usa “Sincronizar bucket” una vez para indexarlos en D1.</p> : null}
        </div>
      </article>
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
    <section className="adminCard adminModule adminUsersModule">
      <div className="adminCardHead"><div><p className="adminModuleEyebrow">Accesos y permisos</p><h3>Usuarios</h3><p>Agrega alumnos y mantén sus datos de acceso escolar.</p></div><button type="button" onClick={onReload}>{loading ? "Cargando..." : "Recargar"}</button></div>
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

const adminWeekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function adminTodayKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfAdminMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function adminMonthCells(value: Date) {
  const year = value.getFullYear();
  const month = value.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= days; day += 1) cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function adminMonthLabel(value: Date) {
  const label = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(value);
  return label.replace(/^./, (character) => character.toLocaleUpperCase("es"));
}

function formatAdminDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function formatAdminTaskDate(task: Pick<AdminTaskRow, "due_date" | "due_time">) {
  const time = task.due_time?.slice(0, 5);
  return `${formatAdminDate(task.due_date)}${time ? ` · ${time}` : ""}`;
}

function isTerminalAdminTask(task: Pick<AdminTaskRow, "status">) {
  return task.status === "Entregado" || task.status === "Cancelado";
}

function compareAdminTasks(firstTask: AdminTaskRow, secondTask: AdminTaskRow, sortMode: string) {
  if (sortMode === "title") return firstTask.title.localeCompare(secondTask.title, "es", { sensitivity: "base" });
  if (sortMode === "priority") {
    const order: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };
    return (order[firstTask.priority] ?? 3) - (order[secondTask.priority] ?? 3) || firstTask.due_date.localeCompare(secondTask.due_date);
  }
  const comparison = `${firstTask.due_date}T${firstTask.due_time ?? "23:59"}`.localeCompare(`${secondTask.due_date}T${secondTask.due_time ?? "23:59"}`);
  return sortMode === "due-desc" ? -comparison : comparison;
}

function adminTaskTone(task: AdminTaskRow) {
  if (task.status === "Entregado") return "completed";
  if (task.status === "Cancelado") return "cancelled";
  if (task.due_date < adminTodayKey()) return "overdue";
  if (task.due_date === adminTodayKey()) return "today";
  return "upcoming";
}

function compareAdminMaterials(firstMaterial: AdminLibraryMaterial, secondMaterial: AdminLibraryMaterial, sortMode: string) {
  if (sortMode === "section") return (firstMaterial.section?.name ?? "").localeCompare(secondMaterial.section?.name ?? "", "es", { sensitivity: "base" }) || firstMaterial.title.localeCompare(secondMaterial.title, "es");
  if (sortMode === "size-desc") return (secondMaterial.size_bytes ?? 0) - (firstMaterial.size_bytes ?? 0);
  if (sortMode === "size-asc") return (firstMaterial.size_bytes ?? 0) - (secondMaterial.size_bytes ?? 0);
  return firstMaterial.title.localeCompare(secondMaterial.title, "es", { sensitivity: "base" });
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

function DiagnosticPill({ label, ok, pending, icon: Icon }: { label: string; ok: boolean; pending: boolean; icon: LucideIcon }) {
  const StatusIcon = pending ? RefreshCw : ok ? CheckCircle2 : CircleAlert;
  const status = pending ? "Revisando" : ok ? "Operativo" : "Revisar";
  return (
    <span className={`diagnosticPill ${pending ? "pending" : ok ? "ok" : "error"}`}>
      <Icon className="diagnosticServiceIcon" size={18} aria-hidden="true" />
      <span><strong>{label}</strong><small>{status}</small></span>
      <StatusIcon className={pending ? "isSpinning" : ""} size={16} aria-hidden="true" />
    </span>
  );
}

function DiagnosticDetails({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="diagnosticDetails">
      <summary><span>{title}<small>{count}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="diagnosticDetailsBody">{children}</div>
    </details>
  );
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

const reportColumnLabels: Record<string, string> = {
  course: "Materia",
  task_type: "Tipo",
  status: "Estado",
  total: "Total",
  overdue: "Vencidas",
  next_due_date: "Próxima entrega",
  section_path: "Sección",
  provider: "Proveedor",
  total_bytes: "Tamaño",
  last_updated_at: "Última actualización",
  role: "Rol",
  active: "Estado",
  id: "ID",
  actor_id: "Responsable",
  action: "Acción",
  entity: "Entidad",
  entity_id: "ID de entidad",
  created_at: "Fecha",
};

function reportColumnLabel(column: string) {
  return reportColumnLabels[column] ?? column.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function reportSummary(payload: ReportPayload | null): ReportSummaryItem[] {
  const taskRows = payload?.tasks ?? [];
  const materialRows = payload?.materials ?? [];
  const studentRows = payload?.students ?? [];
  const taskTotal = taskRows.reduce((total, row) => total + asReportNumber(row.total), 0);
  const overdueTotal = taskRows.reduce((total, row) => total + asReportNumber(row.overdue), 0);
  const materialTotal = materialRows.reduce((total, row) => total + asReportNumber(row.total), 0);
  const materialBytes = materialRows.reduce((total, row) => total + asReportNumber(row.total_bytes), 0);
  const activeProfiles = studentRows
    .filter((row) => row.active === true || row.active === 1 || row.active === "1")
    .reduce((total, row) => total + asReportNumber(row.total), 0);

  return [
    { label: "Tareas", value: taskTotal, help: "entregas activas", icon: ListTodo },
    { label: "Vencidas", value: overdueTotal, help: overdueTotal === 1 ? "requiere seguimiento" : "requieren seguimiento", icon: CircleAlert, tone: overdueTotal ? "warning" : "default" },
    { label: "Materiales", value: materialTotal, help: formatByteCount(materialBytes), icon: HardDrive },
    { label: "Perfiles activos", value: activeProfiles, help: "con acceso vigente", icon: Users },
    { label: "Actividad", value: payload?.audit?.length ?? 0, help: "eventos recientes", icon: Activity },
  ];
}

function filterAndSortReportRows(rows: ReportRow[], query: string, sortColumn: string | null, direction: SortDirection) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const filtered = normalizedQuery
    ? rows.filter((row) => Object.entries(row).some(([column, value]) => formatReportValue(value, column).toLocaleLowerCase("es").includes(normalizedQuery)))
    : [...rows];

  if (!sortColumn) return filtered;
  const factor = direction === "ascending" ? 1 : -1;
  return filtered.sort((firstRow, secondRow) => compareReportValues(firstRow[sortColumn], secondRow[sortColumn]) * factor);
}

function compareReportValues(firstValue: ReportRow[string], secondValue: ReportRow[string]) {
  if (firstValue == null && secondValue == null) return 0;
  if (firstValue == null) return 1;
  if (secondValue == null) return -1;
  if (typeof firstValue === "number" && typeof secondValue === "number") return firstValue - secondValue;
  if (typeof firstValue === "boolean" && typeof secondValue === "boolean") return Number(firstValue) - Number(secondValue);
  return String(firstValue).localeCompare(String(secondValue), "es", { numeric: true, sensitivity: "base" });
}

function exportReportCsv(title: string, columns: string[], rows: ReportRow[]) {
  if (!columns.length || !rows.length) return;
  const lines = [
    columns.map((column) => escapeCsvCell(reportColumnLabel(column))).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(formatReportValue(row[column], column))).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${title.toLocaleLowerCase("es").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "reporte"}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function asReportNumber(value: ReportRow[string]) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatReportValue(value: string | number | boolean | null | undefined, column?: string) {
  if (value == null || value === "") return "—";
  if (column === "total_bytes") return formatByteCount(asReportNumber(value));
  if (column === "active") return value === true || value === 1 || value === "1" ? "Activo" : "Inactivo";
  if (column === "role") return value === "student" ? "Alumno" : value === "admin" ? "Administrador" : value === "owner" ? "Propietario" : String(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  }
  return String(value);
}

function formatByteCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(value / 1024 ** unitIndex)} ${units[unitIndex]}`;
}

function nonEmptyValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
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
