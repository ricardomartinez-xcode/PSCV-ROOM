"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  GraduationCap,
  ListTodo,
  MapPin,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { AdminTab } from "@/components/admin-hub";
import { useAuthSession } from "@/components/auth-session-provider";
import { MaterialLibrary } from "@/components/material-library";
import { NotificationSettingsPanel } from "@/components/providers";
import { CloudflareImageUpload, type UploadedImage } from "@/components/cloudflare-image-upload";
import {
  TaskMaterialGallery,
  TaskMaterialPicker,
  type TaskMaterial,
} from "@/components/task-materials";
import type { DeliveryType, GroupMember, Task, TaskStatus, ViewRole } from "@/lib/domain";
import { deliveryTypes, statuses } from "@/lib/domain";
import { createD1BrowserClient } from "@/lib/d1/client";
import { ACCESS_LOGOUT_PATH, MICROSOFT_LOGOUT_URL, getRoleLabel, getSessionCapabilities } from "@/lib/auth-permissions";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { NOTIFICATION_QUERY_PARAM } from "@/lib/notification-action";
import { calculateDaysRemaining, dateKeyInTimeZone, deriveReaderVisibility, deriveStatus, sortTasks } from "@/lib/task-utils";
import { UiIcon } from "@/lib/ui-icons";

const AdminHub = dynamic(
  () => import("@/components/admin-hub").then((module) => module.AdminHub),
  { ssr: false, loading: () => <div className="adminModule adminLoading" role="status">Cargando administración…</div> },
);

type D1Browser = NonNullable<ReturnType<typeof createD1BrowserClient>>;
type Tab = "calendar" | "tasks" | "materials" | "schedule" | "completed" | "group" | "admin" | "prefs" | "taskDetail";
type CardSize = "compact" | "medium" | "large";
type DetailOrigin = Exclude<Tab, "taskDetail">;

type Props = {
  initialTasks: Task[];
  initialMembers: GroupMember[];
};

type UiGroupMember = GroupMember & {
  profileId?: string;
};

type UserPreferences = {
  calendarView: "month" | "week" | "day";
  taskDensity: CardSize;
  materialPreviewSize: "small" | "medium" | "large";
  showCompleted: boolean;
  theme: "system" | "light" | "dark";
};

type Profile = {
  id: string;
  email: string;
  fullName: string;
  role: "student" | "admin" | "owner";
  preferences: UserPreferences;
  canEditTasks: boolean;
  canDeleteTasks: boolean;
  canManageMaterials: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canManageGroup: boolean;
  canManageNotifications: boolean;
  canViewReports: boolean;
  canManageR2: boolean;
};

type UiTask = Task & {
  courseId?: string;
  taskTypeId?: string;
  priority?: string;
  courseColor?: string;
  taskTypeColor?: string;
  courseCardSize?: CardSize;
  linkedMaterials?: TaskMaterial[];
};

type CourseConfig = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  icon: string;
  cardSize: CardSize;
  active: boolean;
  professorName: string;
  professorEmail: string;
  scheduleText: string;
};

type SectionConfig = {
  id: string;
  name: string;
  path: string;
  color: string;
  icon: string;
  cardSize: CardSize;
  previewStyle: string;
  active: boolean;
};

type TaskTypeConfig = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
};

type TaskForm = {
  itemKind: "task" | "event";
  title: string;
  courseId: string;
  typeId: string;
  taskTypeDraftId: string;
  dueDate: string;
  dueTime: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  status: TaskStatus;
  priority: string;
  visible: boolean;
  materialUrl: string;
  platformUrl: string;
  notes: string;
  materialNeeded: string;
  materialIds: string[];
  image: UploadedImage | null;
};

type TaskFormChange = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => void;

type BooleanGroupColumn = {
  id: string;
  label: string;
  source?: "attended" | "licenseIssue" | "authIssue";
  fixed?: boolean;
  sortOrder?: number;
};

type GroupValueStore = Record<string, Record<string, boolean>>;

type GroupColumnRow = {
  id: string;
  source_key: "attended" | "licenseIssue" | "authIssue" | null;
  label: string;
  fixed: boolean;
  sort_order: number;
};

type GroupValueRow = {
  profile_id: string;
  column_id: string;
  value: boolean;
};

type AppNotification = {
  id: string;
  kind: string;
  priority: "low" | "normal" | "high";
  title: string;
  body: string;
  media_url: string | null;
  media_type: "image" | "video" | "audio" | "file" | null;
  entity: string | null;
  entity_id: string | null;
  action_url: string | null;
  scheduled_for: string;
  read_at: string | null;
  created_at: string;
};

type MaterialOption = TaskMaterial;

const fallbackPrefs: UserPreferences = {
  calendarView: "month",
  taskDensity: "medium",
  materialPreviewSize: "medium",
  showCompleted: false,
  theme: "system",
};

const fixedBooleanColumns: BooleanGroupColumn[] = [
  { id: "attended", label: "Asistencia", source: "attended", fixed: true },
  { id: "licenseIssue", label: "Licencia", source: "licenseIssue", fixed: true },
  { id: "authIssue", label: "Acceso", source: "authIssue", fixed: true },
];

function newTaskForm(defaults: Partial<TaskForm> = {}): TaskForm {
  const today = dateKeyInTimeZone();
  return {
    itemKind: "task",
    title: "",
    courseId: "",
    typeId: "",
    taskTypeDraftId: "",
    dueDate: today,
    dueTime: "23:59",
    startDate: today,
    startTime: "09:00",
    endDate: today,
    endTime: "10:00",
    location: "",
    status: "Pendiente",
    priority: "Media",
    visible: true,
    materialUrl: "",
    platformUrl: "",
    notes: "",
    materialNeeded: "",
    materialIds: [],
    image: null,
    ...defaults,
  };
}

export function AppShellV5({ initialTasks, initialMembers }: Props) {
  const d1Client = useMemo(() => createD1BrowserClient(), []);
  const { profile: sessionProfile, identity, clearSession } = useAuthSession();
  const [profileOverride, setProfileOverride] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");
  const [initialAdminTab, setInitialAdminTab] = useState<AdminTab>("general");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationDetail, setNotificationDetail] = useState<AppNotification | null>(null);
  const [notificationView, setNotificationView] = useState<"notifications" | "settings">("notifications");
  const [tasks, setTasks] = useState<UiTask[]>(initialTasks);
  const [courses, setCourses] = useState<CourseConfig[]>([]);
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskTypeConfig[]>([]);
  const [members, setMembers] = useState<UiGroupMember[]>(initialMembers);
  const [cursor, setCursor] = useState(new Date());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTasks[0]?.id ?? null);
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin>("calendar");
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const taskFormReturnFocusRef = useRef<HTMLElement | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(() => newTaskForm());
  const [taskFormSource, setTaskFormSource] = useState<"calendar" | "tasks">("tasks");
  const [creatingTask, setCreatingTask] = useState(false);

  const profile = profileOverride ?? sessionProfile;
  const email = identity?.email ?? profile?.email ?? null;
  const prefs = profile?.preferences ?? fallbackPrefs;
  const capabilities = useMemo(() => getSessionCapabilities(profile), [profile]);
  const shellRole: ViewRole = capabilities.isAdmin || capabilities.isOwner ? "admin" : "reader";
  const taskActionRole: ViewRole = capabilities.canEditTasks ? "admin" : "reader";
  const roleLabel = getRoleLabel(profile);
  const canViewCompleted = capabilities.isAdmin || capabilities.isOwner;

  useEffect(() => {
    setProfileOverride(null);
  }, [sessionProfile?.id]);

  useEffect(() => {
    if (!profile || !capabilities.canAccessAdmin) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== "admin") return;
    const requestedAdminTab = url.searchParams.get("adminTab");
    const allowedAdminTabs: AdminTab[] = ["general", "tasks", "calendar", "courses", "sections", "materials", "users", "notifications", "reports", "diagnostics"];
    if (requestedAdminTab && allowedAdminTabs.includes(requestedAdminTab as AdminTab)) setInitialAdminTab(requestedAdminTab as AdminTab);
    setTab("admin");
  }, [capabilities.canAccessAdmin, profile]);

  useEffect(() => {
    if (profile) void loadData(d1Client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d1Client, profile?.id]);

  useEffect(() => {
    if (profile) void loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (!profile) return;
    const refreshNotifications = () => {
      void loadNotifications();
    };
    window.addEventListener("pscv:notifications-changed", refreshNotifications);
    const intervalId = window.setInterval(refreshNotifications, 45000);

    return () => {
      window.removeEventListener("pscv:notifications-changed", refreshNotifications);
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (!notifications.length) return;
    const url = new URL(window.location.href);
    const notificationId = url.searchParams.get(NOTIFICATION_QUERY_PARAM);
    if (!notificationId) return;
    const notification = notifications.find((item) => item.id === notificationId);
    if (!notification) return;

    url.searchParams.delete(NOTIFICATION_QUERY_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setNotificationOpen(false);
    setNotificationView("notifications");
    setNotificationDetail(notification);
    void updateNotifications([notification.id], "read");
  }, [notifications]);

  useEffect(() => {
    if (!tasks.length) return;
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get("task");
    if (!taskId || !tasks.some((task) => task.id === taskId)) return;

    url.searchParams.delete("task");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setSelectedTaskId(taskId);
    setDetailOrigin("tasks");
    setTab("taskDetail");
    setDrawerOpen(false);
  }, [tasks]);

  async function loadData(client: D1Browser) {
    setError(null);
    const [coursesRes, sectionsRes, tasksRes, membersRes] = await Promise.all([
      client.from("courses").select("*").order("sort_order"),
      client.from("material_sections").select("*").order("sort_order"),
      client
        .from("tasks")
        .select("*, courses(id,name,color,card_size), task_types(id,name,color,card_size), task_materials(materials(id,title,material_type,provider,source_url,preview_url,thumbnail_url,r2_key,file_name,content_type,size_bytes,section_id,material_sections(id,name,path,color)))")
        .is("archived_at", null)
        .order("due_date")
        .order("due_time"),
      client
        .from("app_profiles")
        .select("id,control_number,email,full_name")
        .eq("role", "student")
        .eq("active", true)
        .order("full_name"),
    ]);

    const failure = coursesRes.error || sectionsRes.error || tasksRes.error;
    if (failure) {
      setError(failure.message);
      return;
    }

    setCourses((coursesRes.data ?? []).map(toCourse));
    setSections((sectionsRes.data ?? []).map(toSection));
    setTasks((tasksRes.data ?? []).map(toTask));
    const taskTypeRes = await client.from("task_types").select("id,name,color,icon").eq("active", true).order("sort_order");
    if (!taskTypeRes.error) setTaskTypes((taskTypeRes.data ?? []) as TaskTypeConfig[]);
    if (!membersRes.error && membersRes.data?.length) {
      setMembers(membersRes.data.map(toGroupMember));
    }
  }

  async function signOut() {
    clearSession();
    setProfileOverride(null);
    setNotifications([]);
    setNotificationOpen(false);
    setDrawerOpen(false);
    try {
      await d1Client.auth.signOut();
    } catch {
      // The browser adapter has no local auth token; Cloudflare Access owns the app session.
    }

    // Revoke Cloudflare Access first without navigating away, then close the
    // Microsoft identity-provider session. This prevents the next login from
    // silently returning to the same Microsoft account through SSO.
    try {
      await fetch(ACCESS_LOGOUT_PATH, {
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
      });
    } catch {
      // Continue with Microsoft logout if the browser hides the manual redirect response.
    }
    window.location.assign(MICROSOFT_LOGOUT_URL);
  }

  async function loadNotifications() {
    try {
      const response = await fetch("/api/notifications", { credentials: "include", cache: "no-store" });
      const body = await response.json() as { notifications?: AppNotification[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar avisos.");
      setNotifications(body.notifications ?? []);
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "No se pudieron cargar avisos.");
    }
  }

  async function updateNotifications(ids: string[], action: "read" | "dismiss") {
    if (!ids.length) return;
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar el aviso.");
      if (action === "dismiss") setNotifications((current) => current.filter((item) => !ids.includes(item.id)));
      else setNotifications((current) => current.map((item) => ids.includes(item.id) ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "No se pudo actualizar el aviso.");
    }
  }

  function openTaskForm(source: "calendar" | "tasks", dueDate?: string) {
    const today = dateKeyInTimeZone();
    const defaultTaskType = taskTypes.find((type) => !isEventTypeName(type.name));
    taskFormReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTaskFormSource(source);
    setTaskForm(newTaskForm({
      dueDate: dueDate || today,
      startDate: dueDate || today,
      endDate: dueDate || today,
      courseId: courses[0]?.id || "",
      typeId: defaultTaskType?.id || "",
      taskTypeDraftId: defaultTaskType?.id || "",
    }));
    setTaskFormOpen(true);
  }

  function closeTaskForm() {
    setTaskFormOpen(false);
    window.requestAnimationFrame(() => taskFormReturnFocusRef.current?.focus());
  }

  function setTaskFormField<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setTaskForm((current) => ({ ...current, [key]: value }));
  }

  async function createTask(form: TaskForm) {
    const title = form.title.trim();
    if (!title) return;

    setCreatingTask(true);
    setError(null);

    if (!d1Client) {
      const course = courses.find((item) => item.id === form.courseId);
      const type = taskTypes.find((item) => item.id === form.typeId);
      const id = `local-${Date.now()}`;
      const dueDate = form.itemKind === "event" ? form.startDate : (form.dueDate || dateKeyInTimeZone());
      const dueTime = form.itemKind === "event" ? form.startTime : (form.dueTime || "23:59");
      const nextTask: UiTask = {
        id,
        courseId: course?.id,
        taskTypeId: type?.id,
        priority: form.priority,
        course: course?.name ?? "Sin materia",
        itemKind: form.itemKind,
        startsAt: form.itemKind === "event" ? `${form.startDate}T${form.startTime}:00` : undefined,
        endsAt: form.itemKind === "event" ? `${form.endDate}T${form.endTime}:00` : undefined,
        location: form.itemKind === "event" ? form.location.trim() : undefined,
        dueDate,
        dueTime,
        title,
        materialNeeded: form.materialNeeded.trim(),
        materialUrl: form.materialUrl.trim(),
        deliveryType: delivery(type?.name),
        status: form.status,
        daysRemaining: calculateDaysRemaining(dueDate),
        notes: form.notes.trim(),
        platformUrl: form.platformUrl.trim(),
        imageId: form.image?.id,
        imageUrl: form.image?.url,
        visibleToReaders: form.visible,
        courseColor: course?.color,
        taskTypeColor: type?.color ?? undefined,
        courseCardSize: course?.cardSize,
        linkedMaterials: [],
      };
      setTasks((current) => [...current, nextTask]);
      setSelectedTaskId(id);
      closeTaskForm();
      setCreatingTask(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          course_id: form.courseId || null,
          task_type_id: form.typeId || null,
          due_date: form.itemKind === "event" ? form.startDate : form.dueDate,
          due_time: form.itemKind === "event" ? form.startTime : (form.dueTime || "23:59"),
          item_kind: form.itemKind,
          starts_at: form.itemKind === "event" ? `${form.startDate}T${form.startTime}:00` : null,
          ends_at: form.itemKind === "event" ? `${form.endDate}T${form.endTime}:00` : null,
          location: form.itemKind === "event" ? (form.location.trim() || null) : null,
          status: form.status,
          priority: form.priority,
          visible_to_students: form.visible,
          material_url: form.materialUrl.trim() || null,
          platform_url: form.platformUrl.trim() || null,
          notes: form.notes.trim() || null,
          image_id: form.image?.id ?? null,
          image_url: form.image?.url ?? null,
          material_needed: form.materialNeeded.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({})) as { task?: { id: string }; error?: string; calendarError?: string | null };
      if (!response.ok || !body.task) throw new Error(body.error ?? "No se pudo crear la tarea.");
      const taskId = String(body.task.id);
      let materialSyncError: string | null = null;
      if (form.itemKind === "task" && form.materialIds.length) {
        try {
          await replaceTaskMaterials(taskId, form.materialIds);
        } catch (linkError) {
          materialSyncError = linkError instanceof Error ? linkError.message : "No se pudieron enlazar los materiales.";
        }
      }
      await loadData(d1Client);
      setSelectedTaskId(taskId);
      closeTaskForm();
      if (materialSyncError) setError(`Actividad creada; materiales pendientes: ${materialSyncError}`);
      else if (body.calendarError) setError(`Tarea creada; calendario pendiente: ${body.calendarError}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear la tarea.");
    }

    setCreatingTask(false);
  }

  async function replaceTaskMaterials(taskId: string, materialIds: string[]) {
    const response = await fetch(`/api/admin/tasks/${taskId}/materials`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialIds }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "No se pudieron sincronizar los materiales.");
  }

  async function updateTaskFromDetail(id: string, form: TaskForm) {
    const title = form.title.trim();
    if (!title) return false;

    setError(null);

    if (!d1Client) {
      const course = courses.find((item) => item.id === form.courseId);
      const type = taskTypes.find((item) => item.id === form.typeId);
      const dueDate = form.itemKind === "event" ? form.startDate : (form.dueDate || dateKeyInTimeZone());
      const dueTime = form.itemKind === "event" ? form.startTime : (form.dueTime || "23:59");
      setTasks((current) => current.map((task) => task.id === id ? {
        ...task,
        courseId: course?.id,
        taskTypeId: type?.id,
        priority: form.priority,
        course: course?.name ?? task.course,
        itemKind: form.itemKind,
        startsAt: form.itemKind === "event" ? `${form.startDate}T${form.startTime}:00` : undefined,
        endsAt: form.itemKind === "event" ? `${form.endDate}T${form.endTime}:00` : undefined,
        location: form.itemKind === "event" ? form.location.trim() : undefined,
        dueDate,
        dueTime,
        title,
        materialNeeded: form.materialNeeded.trim(),
        materialUrl: form.materialUrl.trim(),
        deliveryType: delivery(type?.name),
        status: form.status,
        daysRemaining: calculateDaysRemaining(dueDate),
        notes: form.notes.trim(),
        platformUrl: form.platformUrl.trim(),
        imageId: form.image?.id,
        imageUrl: form.image?.url,
        visibleToReaders: form.visible,
        courseColor: course?.color ?? task.courseColor,
        taskTypeColor: type?.color ?? task.taskTypeColor,
        courseCardSize: course?.cardSize ?? task.courseCardSize,
        linkedMaterials: form.itemKind === "task"
          ? (task.linkedMaterials ?? []).filter((material) => form.materialIds.includes(material.id))
          : [],
      } : task));
      return true;
    }

    try {
      const response = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          course_id: form.courseId || null,
          task_type_id: form.typeId || null,
          due_date: form.itemKind === "event" ? form.startDate : form.dueDate,
          due_time: form.itemKind === "event" ? form.startTime : (form.dueTime || "23:59"),
          item_kind: form.itemKind,
          starts_at: form.itemKind === "event" ? `${form.startDate}T${form.startTime}:00` : null,
          ends_at: form.itemKind === "event" ? `${form.endDate}T${form.endTime}:00` : null,
          location: form.itemKind === "event" ? (form.location.trim() || null) : null,
          status: form.status,
          priority: form.priority,
          visible_to_students: form.visible,
          material_needed: form.materialNeeded.trim() || null,
          material_url: form.materialUrl.trim() || null,
          platform_url: form.platformUrl.trim() || null,
          notes: form.notes.trim() || null,
          image_id: form.image?.id ?? null,
          image_url: form.image?.url ?? null,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; calendarError?: string | null };
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar la tarea.");
      let materialSyncError: string | null = null;
      if (form.itemKind === "task") {
        try {
          await replaceTaskMaterials(id, form.materialIds);
        } catch (linkError) {
          materialSyncError = linkError instanceof Error ? linkError.message : "No se pudieron sincronizar los materiales.";
        }
      }
      await loadData(d1Client);
      if (materialSyncError) setError(`Actividad guardada; materiales sin actualizar: ${materialSyncError}`);
      else if (body.calendarError) setError(`Tarea guardada; calendario pendiente: ${body.calendarError}`);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la tarea.");
      return false;
    }
  }

  async function markDone(id: string) {
    if (!capabilities.canEditTasks) return;
    const response = await fetch(`/api/admin/tasks/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Entregado", visible_to_students: false }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; calendarError?: string | null };
    if (!response.ok) setError(body.error ?? "No se pudo marcar como entregada.");
    else {
      await loadData(d1Client);
      if (body.calendarError) setError(`Tarea entregada; calendario pendiente: ${body.calendarError}`);
    }
  }

  if (!profile) {
    return (
      <main className="loginScreen authPage">
        <section className="loginCard authCard authCardSimple">
          <img src="/icon.svg" className="authLogoMain" alt="PSCV Room" />
          <h1 className="authTitle">PSCV Room</h1>
          <p>No tienes una sesión autorizada.</p>
        </section>
      </main>
    );
  }

  const normalizedTasks = tasks.map((task) => {
    const daysRemaining = calculateDaysRemaining(task.dueDate);
    const status = deriveStatus(task.status, daysRemaining);
    return { ...task, daysRemaining, status, visibleToReaders: task.visibleToReaders && deriveReaderVisibility({ status }) };
  });

  const activeTasks = normalizedTasks.filter((task) => task.status !== "Entregado" && task.status !== "Cancelado");
  const listBase = shellRole === "admin"
    ? activeTasks
    : activeTasks.filter((task) => task.visibleToReaders);
  const visibleTasks = sortTasks(listBase);
  const completedTasks = sortTasks(normalizedTasks.filter((task) => task.status === "Entregado"));
  const shownTasks = filterTasks(visibleTasks, query);
  const selectedTask = selectedTaskId
    ? normalizedTasks.find((task) => task.id === selectedTaskId) ?? shownTasks[0] ?? null
    : shownTasks[0] ?? null;
  const calendarSelectedTask = selectedTaskId
    ? visibleTasks.find((task) => task.id === selectedTaskId) ?? null
    : null;
  const listSelectedTask = selectedTaskId
    ? shownTasks.find((task) => task.id === selectedTaskId) ?? null
    : null;
  const activeNavTab = tab === "taskDetail" ? detailOrigin : tab;
  const unreadNotifications = notifications.filter((notification) => !notification.read_at).length;
  const notificationDetailOpen = Boolean(notificationDetail);

  function go(next: Tab) {
    if (next === "completed" && !canViewCompleted) return;
    if (next === "group" && !capabilities.canManageGroup) return;
    if (next === "admin" && !capabilities.canAccessAdmin) return;
    setTab(next);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openTaskDetail(id: string, origin: DetailOrigin) {
    setSelectedTaskId(id);
    setDetailOrigin(origin);
    setTab("taskDetail");
    setDrawerOpen(false);
  }

  function openNotification(notification: AppNotification) {
    void updateNotifications([notification.id], "read");
    setNotificationOpen(false);
    setNotificationView("notifications");
    if (notification.entity === "tasks" && notification.entity_id) {
      openTaskDetail(notification.entity_id, "tasks");
      return;
    }
    setNotificationDetail(notification);
  }

  function refreshCurrentData() {
    void Promise.all([loadData(d1Client), loadNotifications()]);
  }

  return (
    <main className={`mobileApp density-${prefs.taskDensity} ${shellRole === "admin" ? "adminShell" : ""}`}>
      <a className="skipLink" href="#main-content">Saltar al contenido</a>
      <header className="topAppBar" inert={drawerOpen || notificationOpen || notificationDetailOpen ? true : undefined}>
        <button className="iconButton" aria-label="Abrir navegación" title="Navegación" onClick={() => setDrawerOpen(true)} type="button"><Menu size={23} /></button>
        <img src="/icon.svg" className="appLogo" alt="PSCV" />
        <div className="barTitle">
          {searchOpen ? (
            <input className="barSearch" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
          ) : (
            titleFor(tab)
          )}
        </div>
        <button className="iconButton" aria-label="Buscar" title="Buscar" onClick={() => setSearchOpen((value) => !value)} type="button"><Search size={22} /></button>
        <button
          className={`iconButton notificationButton ${notifications.length && !unreadNotifications ? "hasNotifications" : ""}`}
          aria-label={unreadNotifications ? `${unreadNotifications} avisos sin leer` : "Avisos"}
          aria-expanded={notificationOpen}
          aria-controls="notification-tray"
          title={unreadNotifications ? `${unreadNotifications} avisos sin leer` : "Avisos"}
          onClick={() => setNotificationOpen((value) => {
            const next = !value;
            if (!next) setNotificationView("notifications");
            return next;
          })}
          type="button"
        >
          <Bell size={21} />
          {unreadNotifications ? <span className="notificationBadge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span> : null}
        </button>
        <button className="iconButton" aria-label="Actualizar" title="Actualizar" onClick={refreshCurrentData} type="button"><RefreshCw size={21} /></button>
      </header>

      <Drawer
        open={drawerOpen}
        email={email ?? ""}
        role={shellRole}
        roleLabel={roleLabel}
        active={activeNavTab}
        sourceLabel="Cloudflare Access + D1"
        canViewCompleted={canViewCompleted}
        canManageGroup={capabilities.canManageGroup}
        canAccessAdmin={capabilities.canAccessAdmin}
        onClose={() => setDrawerOpen(false)}
        onSelect={go}
        onSignOut={signOut}
      />
      {error ? <div className="systemBanner" role="alert">{error}</div> : null}
      <NotificationTray
        open={notificationOpen}
        view={notificationView}
        notifications={notifications}
        onClose={() => {
          setNotificationOpen(false);
          setNotificationView("notifications");
        }}
        onOpen={openNotification}
        onSettings={() => setNotificationView("settings")}
        onBack={() => setNotificationView("notifications")}
        onRefresh={() => void loadNotifications()}
        onRead={(ids) => void updateNotifications(ids, "read")}
        onDismiss={(ids) => void updateNotifications(ids, "dismiss")}
      />
      <NotificationDetailDialog
        notification={notificationDetail}
        onClose={() => setNotificationDetail(null)}
      />

      <section className="screen" id="main-content" tabIndex={-1} inert={drawerOpen || notificationOpen || notificationDetailOpen ? true : undefined}>
        {tab === "calendar" ? (
          <>
            <WorkspaceOverview tasks={visibleTasks} completedCount={completedTasks.length} membersCount={members.length} canViewCompleted={canViewCompleted} canManageGroup={capabilities.canManageGroup} onGo={go} />
            <Calendar tasks={visibleTasks} cursor={cursor} setCursor={setCursor} selectedTask={calendarSelectedTask} onSelect={(id) => openTaskDetail(id, "calendar")} onCreateDate={capabilities.canEditTasks ? (date) => openTaskForm("calendar", date) : undefined} />
          </>
        ) : null}
        {tab === "tasks" ? (
          <>
            <WorkspaceOverview tasks={visibleTasks} completedCount={completedTasks.length} membersCount={members.length} canViewCompleted={canViewCompleted} canManageGroup={capabilities.canManageGroup} onGo={go} compact />
            <TaskList tasks={shownTasks} role={taskActionRole} selectedTask={listSelectedTask} density={prefs.taskDensity} onSelect={(id) => openTaskDetail(id, "tasks")} onDone={(id) => void markDone(id)} onCreate={capabilities.canEditTasks ? () => openTaskForm("tasks") : undefined} />
          </>
        ) : null}
        {tab === "materials" ? <MaterialLibrary previewSize={prefs.materialPreviewSize} globalQuery={query} /> : null}
        {tab === "schedule" ? <ScheduleAndProfessors courses={courses.filter((course) => course.active)} /> : null}
        {tab === "completed" ? <TaskList tasks={completedTasks} role="reader" selectedTask={null} density={prefs.taskDensity} onSelect={(id) => openTaskDetail(id, "completed")} onDone={() => undefined} completedOnly /> : null}
        {tab === "group" ? <Group members={members} d1Client={d1Client} role={capabilities.canManageGroup ? "admin" : "reader"} canManageMembers={capabilities.canManageUsers} profile={profile} onMembersChange={setMembers} onError={setError} /> : null}
        {tab === "prefs" ? <Preferences profile={profile} d1Client={d1Client} onProfile={setProfileOverride} onError={setError} /> : null}
        {tab === "taskDetail" ? <TaskDetailScreen task={selectedTask} canEdit={capabilities.canEditTasks} courses={courses} taskTypes={taskTypes} onBack={() => go(detailOrigin)} onDone={(id) => void markDone(id)} onSave={(id, form) => updateTaskFromDetail(id, form)} /> : null}
        {tab === "admin" ? (
          <AdminHub
            courses={courses}
            sections={sections}
            profile={profile}
            d1Client={d1Client}
            reload={() => loadData(d1Client)}
            onCourses={setCourses}
            onSections={setSections}
            onError={setError}
            initialTab={initialAdminTab}
          />
        ) : null}
      </section>

      <TaskCreateModal
        open={taskFormOpen}
        source={taskFormSource}
        form={taskForm}
        courses={courses}
        taskTypes={taskTypes}
        busy={creatingTask}
        onClose={closeTaskForm}
        onChange={setTaskFormField}
        onSubmit={(form) => void createTask(form)}
      />

      <ScrollToTopButton />

      <nav className={`bottomNav ${capabilities.canAccessAdmin ? "adminBottomNav" : ""}`} aria-label="Navegación principal" inert={drawerOpen || notificationOpen || notificationDetailOpen ? true : undefined}>
        <button aria-current={activeNavTab === "calendar" ? "page" : undefined} className={activeNavTab === "calendar" ? "active" : ""} onClick={() => go("calendar")} type="button"><CalendarDays size={22} />Calendario</button>
        <button aria-current={activeNavTab === "tasks" ? "page" : undefined} className={activeNavTab === "tasks" ? "active" : ""} onClick={() => go("tasks")} type="button"><ListTodo size={22} />Tareas</button>
        <button aria-current={activeNavTab === "schedule" ? "page" : undefined} className={activeNavTab === "schedule" ? "active" : ""} onClick={() => go("schedule")} type="button"><GraduationCap size={22} />Horario</button>
        {capabilities.canAccessAdmin ? (
          <button aria-current={activeNavTab === "admin" ? "page" : undefined} className={activeNavTab === "admin" ? "active" : ""} onClick={() => go("admin")} type="button"><SlidersHorizontal size={22} />Admin</button>
        ) : null}
        <button aria-current={activeNavTab === "materials" ? "page" : undefined} className={activeNavTab === "materials" ? "active" : ""} onClick={() => go("materials")} type="button"><FolderOpen size={22} />Materiales</button>
      </nav>
    </main>
  );
}

function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 520);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;

  function returnToTop() {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <button
      className="scrollToTop"
      type="button"
      onClick={returnToTop}
    >
      <ArrowUp size={17} aria-hidden="true" />
      <span>Volver arriba</span>
    </button>
  );
}

function useContainedDialogFocus(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScrollLock = lockBodyScroll();
    const frame = window.requestAnimationFrame(() => {
      const preferred = containerRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]");
      const first = containerRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (preferred ?? first)?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      releaseBodyScrollLock();
      previousFocusRef.current?.focus();
    };
  }, [containerRef, open]);
}

function Drawer({
  open,
  email,
  role,
  roleLabel,
  active,
  sourceLabel,
  canViewCompleted,
  canManageGroup,
  canAccessAdmin,
  onClose,
  onSelect,
  onSignOut,
}: {
  open: boolean;
  email: string;
  role: ViewRole;
  roleLabel: string;
  active: Tab;
  sourceLabel: string;
  canViewCompleted: boolean;
  canManageGroup: boolean;
  canAccessAdmin: boolean;
  onClose: () => void;
  onSelect: (tab: Tab) => void;
  onSignOut: () => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  useContainedDialogFocus(open, drawerRef, onClose);

  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} aria-hidden="true" onClick={onClose} />
      <aside ref={drawerRef} className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal={open ? "true" : undefined} aria-label="Navegación" aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="drawerHead">
          <img src="/icon.svg" alt="PSCV" />
          <div>
            <strong>{role === "admin" ? "PSCV-ADMIN" : "PSCV-ROOM"}</strong>
            <span className="drawerSource">{sourceLabel}</span>
            <span className="drawerSource">{roleLabel}</span>
          </div>
        </div>
        <nav className="drawerNav">
          <DrawerItem icon={<CalendarDays size={20} />} label="Calendario" active={active === "calendar"} onClick={() => onSelect("calendar")} />
          <DrawerItem icon={<ListTodo size={20} />} label="Tareas" active={active === "tasks"} onClick={() => onSelect("tasks")} />
          <DrawerItem icon={<FolderOpen size={20} />} label="Materiales" active={active === "materials"} onClick={() => onSelect("materials")} />
          <DrawerItem icon={<GraduationCap size={20} />} label="Horario y profesores" active={active === "schedule"} onClick={() => onSelect("schedule")} />
          <DrawerItem icon={<Settings size={20} />} label="Preferencias" active={active === "prefs"} onClick={() => onSelect("prefs")} />
          {canViewCompleted ? <DrawerItem icon={<CheckCircle2 size={20} />} label="Entregadas" active={active === "completed"} onClick={() => onSelect("completed")} /> : null}
          {canManageGroup ? <DrawerItem icon={<Users size={20} />} label="Lista de grupo" active={active === "group"} onClick={() => onSelect("group")} /> : null}
          {canAccessAdmin ? <DrawerItem icon={<SlidersHorizontal size={20} />} label="Configuración" active={active === "admin"} onClick={() => onSelect("admin")} /> : null}
        </nav>
        <div className="drawerFooter">
          <div className="offline"><span>Online</span><u>{sourceLabel}</u></div>
          <div className="accountRow">
            <span className="avatar">{email[0]?.toUpperCase()}</span>
            <span>{email}</span>
            <button className="logoutButton" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={onSignOut} type="button"><LogOut size={18} /><span>Cerrar sesión</span></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function NotificationTray({
  open,
  view,
  notifications,
  onClose,
  onOpen,
  onSettings,
  onBack,
  onRefresh,
  onRead,
  onDismiss,
}: {
  open: boolean;
  view: "notifications" | "settings";
  notifications: AppNotification[];
  onClose: () => void;
  onOpen: (notification: AppNotification) => void;
  onSettings: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onRead: (ids: string[]) => void;
  onDismiss: (ids: string[]) => void;
}) {
  const trayRef = useRef<HTMLElement | null>(null);
  useContainedDialogFocus(open, trayRef, onClose);

  if (!open) return null;

  const unreadIds = notifications.filter((notification) => !notification.read_at).map((notification) => notification.id);
  const unreadLabel = unreadIds.length ? `${unreadIds.length} sin leer` : "todo leído";

  return (
    <>
    <div className="notificationTrayScrim" aria-hidden="true" onClick={onClose} />
    <section ref={trayRef} id="notification-tray" className="notificationTray" role="dialog" aria-modal="true" aria-label={view === "settings" ? "Configuración de avisos" : "Avisos"}>
      <div className="notificationTrayHead">
        {view === "settings" ? (
          <button className="notificationTrayIconButton" aria-label="Volver a avisos" title="Volver a avisos" onClick={onBack} type="button"><ArrowLeft size={16} /></button>
        ) : null}
        <div className="notificationTrayHeadContent">
          <strong>{view === "settings" ? "Configuración" : "Avisos"}</strong>
          <span>{view === "settings" ? "Elige cómo recibir novedades" : `${notifications.length} activos · ${unreadLabel}`}</span>
        </div>
        <div className="notificationTrayHeadActions">
          {view === "notifications" ? (
            <button className="notificationTrayIconButton" aria-label="Configurar avisos" title="Configurar avisos" aria-expanded={false} onClick={onSettings} type="button"><Settings size={16} /></button>
          ) : null}
          <button className="notificationTrayIconButton" data-dialog-autofocus aria-label="Cerrar avisos" title="Cerrar avisos" onClick={onClose} type="button"><X size={16} /></button>
        </div>
      </div>
      <div className={`notificationTrayBody ${view === "settings" ? "settings" : "notifications"}`}>
        {view === "settings" ? (
          <NotificationSettingsPanel />
        ) : (
          <>
            <div className="notificationTrayActions">
              <button type="button" onClick={onRefresh}>Actualizar</button>
              <button type="button" onClick={() => onRead(unreadIds)} disabled={!unreadIds.length}>Marcar leídos</button>
              <button type="button" onClick={() => onDismiss(notifications.map((notification) => notification.id))} disabled={!notifications.length}>Limpiar</button>
            </div>
            <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">{notifications.length} avisos activos; {unreadLabel}.</p>
            <div className="notificationList">
              {notifications.map((notification) => {
                const meta = notificationKindMeta(notification.kind);
                return (
                  <article className={`notificationItem kind-${meta.tone} ${notification.read_at ? "" : "unread"} priority-${notification.priority}`} key={notification.id}>
                    <button type="button" onClick={() => onOpen(notification)}>
                      <span className="notificationItemTitle">{meta.icon}<strong>{notification.title}</strong></span>
                      {notification.body ? <span className="notificationItemBody">{notification.body}</span> : null}
                      <span className="notificationItemMeta">
                        <span>{meta.label}</span>
                        <time dateTime={notification.scheduled_for}>{formatOptionalSync(notification.scheduled_for)}</time>
                      </span>
                    </button>
                    <button aria-label={`Ocultar ${notification.title}`} title="Ocultar" onClick={() => onDismiss([notification.id])} type="button"><X size={14} /></button>
                  </article>
                );
              })}
              {!notifications.length ? <p className="notificationEmpty">No hay avisos pendientes.</p> : null}
            </div>
          </>
        )}
      </div>
    </section>
    </>
  );
}

function NotificationDetailDialog({
  notification,
  onClose,
}: {
  notification: AppNotification | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useContainedDialogFocus(Boolean(notification), dialogRef, onClose);

  if (!notification) return null;

  const meta = notificationKindMeta(notification.kind);
  const priority = notification.priority === "high"
    ? "Prioridad alta"
    : notification.priority === "low"
      ? "Prioridad baja"
      : "Prioridad normal";

  return (
    <>
      <div className="notificationDetailScrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={dialogRef}
        className={`notificationDetailDialog priority-${notification.priority}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-detail-title"
        aria-describedby="notification-detail-body"
      >
        <header className="notificationDetailHead">
          <span className={`notificationDetailKind kind-${meta.tone}`}>{meta.icon}{meta.label}</span>
          <button data-dialog-autofocus type="button" aria-label="Cerrar aviso" title="Cerrar" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="notificationDetailContent">
          <h2 id="notification-detail-title">{notification.title}</h2>
          <p id="notification-detail-body">{notification.body || "Este aviso no incluye información adicional."}</p>
          {notification.media_url && notification.media_type === "image" ? <img className="notificationMedia" src={notification.media_url} alt="Archivo adjunto del aviso" /> : null}
          {notification.media_url && notification.media_type === "video" ? <video className="notificationMedia" src={notification.media_url} controls playsInline /> : null}
          {notification.media_url && notification.media_type === "audio" ? <audio className="notificationMediaAudio" src={notification.media_url} controls /> : null}
          {notification.media_url && notification.media_type === "file" ? <a className="notificationMediaLink" href={notification.media_url} target="_blank" rel="noreferrer">Abrir archivo adjunto</a> : null}
        </div>
        <footer className="notificationDetailFooter">
          <div>
            <span>{priority}</span>
            <time dateTime={notification.scheduled_for}>{formatOptionalSync(notification.scheduled_for)}</time>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </>
  );
}

function notificationKindMeta(kind: string) {
  if (kind === "task_reminder_day_of") {
    return { label: "Entrega hoy", tone: "today", icon: <CalendarClock size={16} aria-hidden="true" /> };
  }
  if (kind === "task_reminder_1_day") {
    return { label: "Entrega mañana", tone: "tomorrow", icon: <CalendarClock size={16} aria-hidden="true" /> };
  }
  if (kind === "event_reminder_day_before") {
    return { label: "Evento mañana", tone: "event", icon: <CalendarDays size={16} aria-hidden="true" /> };
  }
  if (kind === "material_added") {
    return { label: "Material", tone: "material", icon: <FolderOpen size={16} aria-hidden="true" /> };
  }
  if (kind === "task_updated") {
    return { label: "Actividad", tone: "task", icon: <RefreshCw size={16} aria-hidden="true" /> };
  }
  return { label: "Sistema", tone: "system", icon: <Bell size={16} aria-hidden="true" /> };
}

function DrawerItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`drawerItem ${active ? "active" : ""}`} onClick={onClick} type="button"><span>{icon}</span>{label}</button>;
}

function WorkspaceOverview({
  tasks,
  completedCount,
  membersCount,
  canViewCompleted,
  canManageGroup,
  onGo,
  compact = false,
}: {
  tasks: UiTask[];
  completedCount: number;
  membersCount: number;
  canViewCompleted: boolean;
  canManageGroup: boolean;
  onGo: (tab: Tab) => void;
  compact?: boolean;
}) {
  const today = dateKeyInTimeZone();
  const dueToday = tasks.filter((task) => task.dueDate === today).length;
  const overdue = tasks.filter((task) => task.daysRemaining < 0).length;
  const nextTask = tasks.find((task) => task.daysRemaining >= 0) ?? tasks[0] ?? null;

  return (
    <section className={`workbenchOverview ${compact ? "compact" : ""}`}>
      <button className="overviewMetric" onClick={() => onGo("tasks")} type="button">
        <ListTodo size={18} />
        <span>Activas</span>
        <strong>{tasks.length}</strong>
      </button>
      <button className="overviewMetric" onClick={() => onGo("calendar")} type="button">
        <CalendarClock size={18} />
        <span>Hoy</span>
        <strong>{dueToday}</strong>
      </button>
      {canViewCompleted ? (
        <button className="overviewMetric" onClick={() => onGo("completed")} type="button">
          <CheckCircle2 size={18} />
          <span>Entregadas</span>
          <strong>{completedCount}</strong>
        </button>
      ) : null}
      {canManageGroup ? (
        <button className="overviewMetric" onClick={() => onGo("group")} type="button">
          <Users size={18} />
          <span>Alumnos</span>
          <strong>{membersCount}</strong>
        </button>
      ) : null}
      <div className="overviewNext">
        <span>{overdue > 0 ? `${overdue} vencidas` : "Siguiente actividad"}</span>
        <strong>{nextTask ? nextTask.title : "Sin actividades activas"}</strong>
        {nextTask ? <small>{formatTaskDateTime(nextTask.dueDate, nextTask.dueTime)}</small> : null}
      </div>
    </section>
  );
}

function eventIncludesDate(task: UiTask, date: string) {
  if (!date || task.itemKind !== "event") return false;
  const start = task.startsAt?.slice(0, 10) ?? task.dueDate;
  const end = task.endsAt?.slice(0, 10) ?? start;
  return date >= start && date <= end;
}

function Calendar({ tasks, cursor, setCursor, selectedTask, onSelect, onCreateDate }: { tasks: UiTask[]; cursor: Date; setCursor: (date: Date) => void; selectedTask: UiTask | null; onSelect: (id: string) => void; onCreateDate?: (date: string) => void }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = monthCells(year, month);
  const label = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(cursor);
  const today = dateKeyInTimeZone();

  return (
    <div className="calendarWorkspace">
      <section className="calendarPane">
        <div className="viewTabs"><span>Día</span><span>Semana</span><strong>Mes</strong><button type="button" onClick={() => setCursor(new Date())}>Hoy</button></div>
        <div className="monthHead"><button aria-label="Mes anterior" onClick={() => setCursor(new Date(year, month - 1, 15))} type="button">‹</button><h2>{label}</h2><button aria-label="Mes siguiente" onClick={() => setCursor(new Date(year, month + 1, 15))} type="button">›</button></div>
        <div className="weekdays"><span>do</span><span>lu</span><span>ma</span><span>mi</span><span>ju</span><span>vi</span><span>sá</span></div>
        <div className="monthGrid">
          {cells.map((day, index) => {
            const key = day ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
            const dayTasks = tasks.filter((task) => task.itemKind === "event" ? eventIncludesDate(task, key) : task.dueDate === key);
            const hasEvent = dayTasks.some((task) => task.itemKind === "event");
            return (
              <div
                className={`dayCell ${day && onCreateDate ? "canCreateTask" : ""} ${hasEvent ? "hasCalendarEvent" : ""}`}
                key={`${key}-${index}`}
                title={day && onCreateDate ? "Crear tarea en esta fecha" : undefined}
              >
                {day && onCreateDate ? (
                  <button
                    className={`dayNumber ${key === today ? "today" : ""}`}
                    aria-label={`Crear tarea el ${key}`}
                    onClick={() => onCreateDate(key)}
                    type="button"
                  >
                    {String(day).padStart(2, "0")}
                    <Plus className="dayCreateIcon" size={12} />
                  </button>
                ) : day ? (
                  <span className={`dayNumber ${key === today ? "today" : ""}`}>{String(day).padStart(2, "0")}</span>
                ) : null}
                <div className="eventStack">
                  {dayTasks.slice(0, 3).map((task) => (
                    <button
                      className={`calendarEvent ${task.itemKind === "event" ? "calendarEventItem" : "calendarTaskItem"} ${selectedTask?.id === task.id ? "selected" : ""}`}
                      style={{ borderLeftColor: task.itemKind === "event" ? "#6d28d9" : (task.taskTypeColor ?? task.courseColor ?? "#4285dc") } as CSSProperties}
                      key={task.id}
                      title={`${task.dueTime} ${task.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(task.id);
                      }}
                      type="button"
                    >
                      <span>{task.dueTime}</span>
                      <strong>{task.title}</strong>
                    </button>
                  ))}
                  {dayTasks.length > 3 ? (
                    <button
                      className="moreEvents"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(dayTasks[3].id);
                      }}
                      type="button"
                    >
                      +{dayTasks.length - 3}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TaskDetailScreen({
  task,
  canEdit,
  courses,
  taskTypes,
  onBack,
  onDone,
  onSave,
}: {
  task: UiTask | null;
  canEdit: boolean;
  courses: CourseConfig[];
  taskTypes: TaskTypeConfig[];
  onBack: () => void;
  onDone: (id: string) => void;
  onSave: (id: string, form: TaskForm) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TaskForm>(() => task ? taskToForm(task, courses, taskTypes) : newTaskForm());

  useEffect(() => {
    if (!task) return;
    setEditing(false);
    setForm(taskToForm(task, courses, taskTypes));
    // Reset the edit draft only when the selected task changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  if (!task) {
    return (
      <div className="taskDetailScreen empty">
        <CalendarDays size={24} />
        <strong>Sin actividades</strong>
        <button className="detailNavButton" onClick={onBack} type="button"><ArrowLeft size={17} />Volver</button>
      </div>
    );
  }

  const accent = task.taskTypeColor ?? task.courseColor ?? "#4285dc";
  const dateTime = formatTaskDateTime(task.dueDate, task.dueTime);

  function change<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskId = task?.id;
    if (!taskId || saving || !form.title.trim()) return;
    setSaving(true);
    const saved = await onSave(taskId, form);
    setSaving(false);
    if (saved) setEditing(false);
  }

  return (
    <div className="taskDetailScreen">
      <div className="detailToolbar">
        <button className="detailNavButton" onClick={onBack} type="button"><ArrowLeft size={17} />Volver</button>
        <div className="detailToolbarTitle">
          <span>Detalle de actividad</span>
          <strong>{task.title}</strong>
        </div>
        <div className="detailToolbarActions">
          {safeExternalHref(task.materialUrl) ? <a href={safeExternalHref(task.materialUrl)} target="_blank" rel="noreferrer"><ExternalLink size={16} />Recurso externo</a> : null}
          {safeExternalHref(task.platformUrl) ? <a href={safeExternalHref(task.platformUrl)} target="_blank" rel="noreferrer"><ExternalLink size={16} />Plataforma</a> : null}
          {canEdit && !editing ? <button onClick={() => setEditing(true)} type="button"><Edit3 size={16} />Editar</button> : null}
          {canEdit && task.status !== "Entregado" ? <button onClick={() => onDone(task.id)} type="button"><Check size={16} />Entregada</button> : null}
        </div>
      </div>
      <section className="detailSheet" style={{ borderTopColor: accent } as CSSProperties}>
        <div className="detailHero">
          <span style={{ background: accent }}>{task.deliveryType}</span>
          <h2>{task.title}</h2>
        </div>
        {editing ? (
          <TaskEditForm
            form={form}
            courses={courses}
            taskTypes={taskTypes}
            linkedMaterials={task.linkedMaterials ?? []}
            busy={saving}
            onChange={change}
            onCancel={() => {
              setForm(taskToForm(task, courses, taskTypes));
              setEditing(false);
            }}
            onSubmit={submit}
          />
        ) : (
          <dl className="detailGrid">
            <DetailField label="Actividad / tarea" value={task.title} />
            <DetailField label="Materia" value={task.course} />
            {task.itemKind === "event" ? (<>
              <DetailField label="Inicio" value={task.startsAt ? formatTaskDateTime(task.startsAt.slice(0, 10), task.startsAt.slice(11, 16)) : dateTime} icon={<CalendarClock size={17} />} />
              <DetailField label="Fin" value={task.endsAt ? formatTaskDateTime(task.endsAt.slice(0, 10), task.endsAt.slice(11, 16)) : "Sin fin indicado"} icon={<Clock size={17} />} />
              {task.location ? <DetailField label="Lugar" value={task.location} /> : null}
            </>) : (<>
              <DetailField label="Fecha de entrega" value={dateTime} icon={<CalendarClock size={17} />} />
              <DetailField label="Hora" value={formatTaskTime(task.dueTime)} icon={<Clock size={17} />} />
            </>)}
            {task.itemKind === "task" ? <DetailField label="Material necesario" value={task.materialNeeded || "Sin material indicado"} wide /> : null}
            {task.itemKind === "task" && task.linkedMaterials?.length ? (
              <DetailField label="Materiales del bucket" wide>
                <TaskMaterialGallery materials={task.linkedMaterials} />
              </DetailField>
            ) : null}
            <DetailField label="Tipo de entrega" wide>
              <span className="deliveryTypeLarge" style={{ color: accent }}><FileCheck2 size={28} />{task.deliveryType}</span>
            </DetailField>
            <DetailField label="Estado" value={task.status} icon={<ClipboardCheck size={17} />} />
            <DetailField label="Días restantes" value={String(task.daysRemaining)} />
            {task.imageUrl ? <img className="taskContentImage" src={task.imageUrl} alt={`Imagen de ${task.title}`} /> : null}
            {task.notes ? (
          <section className="taskInstructions" aria-labelledby="task-instructions-title">
            <div className="taskInstructionsIcon" aria-hidden="true">
              <ClipboardCheck size={20} strokeWidth={2} />
            </div>
            <div>
              <h3 id="task-instructions-title">Instrucciones</h3>
              <p>{task.notes}</p>
            </div>
          </section>
        ) : null}
            {task.calendarEventId ? <DetailField label="Evento calendario" value={task.calendarEventId} /> : null}
            {task.lastSync ? <DetailField label="Última sincronización" value={formatOptionalSync(task.lastSync)} /> : null}
          </dl>
        )}
      </section>
    </div>
  );
}

function ActivityKindFields({ form, courses, taskTypes, onChange }: { form: TaskForm; courses: CourseConfig[]; taskTypes: TaskTypeConfig[]; onChange: TaskFormChange }) {
  const visibleTypes = taskTypes.filter((type) => form.itemKind === "event" ? isEventTypeName(type.name) : !isEventTypeName(type.name));

  function selectKind(kind: "task" | "event") {
    if (kind === form.itemKind) return;
    const currentType = taskTypes.find((type) => type.id === form.typeId);
    if (kind === "event" && currentType && !isEventTypeName(currentType.name)) {
      onChange("taskTypeDraftId", currentType.id);
    }
    onChange("itemKind", kind);
    const nextType = kind === "event"
      ? taskTypes.find((type) => isEventTypeName(type.name))
      : taskTypes.find((type) => type.id === form.taskTypeDraftId && !isEventTypeName(type.name))
        ?? taskTypes.find((type) => !isEventTypeName(type.name));
    if (nextType) onChange("typeId", nextType.id);
  }

  function selectType(typeId: string) {
    onChange("typeId", typeId);
    if (form.itemKind === "task") onChange("taskTypeDraftId", typeId);
  }

  return (
    <>
      <div className="activityKindSwitch wide" role="group" aria-label="Tipo de actividad">
        <button type="button" aria-pressed={form.itemKind === "task"} className={form.itemKind === "task" ? "active" : ""} onClick={() => selectKind("task")}><ListTodo size={18} />Tarea</button>
        <button type="button" aria-pressed={form.itemKind === "event"} className={form.itemKind === "event" ? "active event" : "event"} onClick={() => selectKind("event")}><CalendarDays size={18} />Evento</button>
      </div>
      <label className="wide">Título<input data-dialog-autofocus value={form.title} onChange={(event) => onChange("title", event.target.value)} required /></label>
      <label>Materia<select value={form.courseId} onChange={(event) => onChange("courseId", event.target.value)}>{courses.length ? courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>) : <option value="">Sin materias</option>}</select></label>
      <label>Tipo<select value={visibleTypes.some((type) => type.id === form.typeId) ? form.typeId : (visibleTypes[0]?.id ?? "")} onChange={(event) => selectType(event.target.value)}>{visibleTypes.length ? visibleTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>) : <option value="">{form.itemKind === "event" ? "Evento" : "Tarea"}</option>}</select></label>
      {form.itemKind === "event" ? (
        <>
          <label>Fecha de inicio<input type="date" value={form.startDate} onChange={(event) => onChange("startDate", event.target.value)} required /></label>
          <label>Hora de inicio<input type="time" value={form.startTime} onChange={(event) => onChange("startTime", event.target.value)} required /></label>
          <label>Fecha de fin<input type="date" min={form.startDate} value={form.endDate} onChange={(event) => onChange("endDate", event.target.value)} required /></label>
          <label>Hora de fin<input type="time" value={form.endTime} onChange={(event) => onChange("endTime", event.target.value)} required /></label>
          <label className="wide">Lugar<input value={form.location} onChange={(event) => onChange("location", event.target.value)} placeholder="Aula, enlace o ubicación" /></label>
        </>
      ) : (
        <>
          <label>Fecha de entrega<input type="date" value={form.dueDate} onChange={(event) => onChange("dueDate", event.target.value)} required /></label>
          <label>Hora de entrega<input type="time" value={form.dueTime} onChange={(event) => onChange("dueTime", event.target.value)} /></label>
        </>
      )}
    </>
  );
}

function TaskEditForm({
  form,
  courses,
  taskTypes,
  linkedMaterials,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: TaskForm;
  courses: CourseConfig[];
  taskTypes: TaskTypeConfig[];
  linkedMaterials: MaterialOption[];
  busy: boolean;
  onChange: TaskFormChange;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="taskForm detailEditForm" onSubmit={onSubmit}>
      <ActivityKindFields form={form} courses={courses} taskTypes={taskTypes} onChange={onChange} />
      <label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value as TaskStatus)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Prioridad<select value={form.priority} onChange={(event) => onChange("priority", event.target.value)}><option>Alta</option><option>Media</option><option>Baja</option></select></label>
      {form.itemKind === "task" ? (<>
        <label className="wide">Material necesario<input value={form.materialNeeded} onChange={(event) => onChange("materialNeeded", event.target.value)} /></label>
        <label className="wide">Recurso externo<input value={form.materialUrl} onChange={(event) => onChange("materialUrl", event.target.value)} /></label>
        <TaskMaterialPicker
          selectedIds={form.materialIds}
          initialMaterials={linkedMaterials}
          onChange={(ids) => onChange("materialIds", ids)}
        />
      </>) : null}
      <label className="wide">Link plataforma<input value={form.platformUrl} onChange={(event) => onChange("platformUrl", event.target.value)} /></label>
      <label className="wide">Instrucciones<textarea value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></label>
      <CloudflareImageUpload value={form.image} category={form.itemKind} label={form.itemKind === "event" ? "Imagen del evento" : "Imagen para las instrucciones"} onChange={(image) => onChange("image", image)} />
      <label className="taskCheck"><input type="checkbox" checked={form.visible} onChange={(event) => onChange("visible", event.target.checked)} /> Visible para alumnos</label>
      <div className="detailEditActions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="primaryAction" disabled={busy || !form.title.trim()} type="submit">{busy ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </form>
  );
}

function DetailField({ label, value, icon, wide = false, children }: { label: string; value?: string; icon?: React.ReactNode; wide?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`detailField ${wide ? "wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{icon ? <span className="detailFieldIcon">{icon}</span> : null}{children ?? value}</dd>
    </div>
  );
}

function TaskList({
  tasks,
  role,
  selectedTask,
  density,
  completedOnly = false,
  onSelect,
  onDone,
  onCreate,
}: {
  tasks: UiTask[];
  role: ViewRole;
  selectedTask: UiTask | null;
  density: CardSize;
  completedOnly?: boolean;
  onSelect: (id: string) => void;
  onDone: (id: string) => void;
  onCreate?: () => void;
}) {
  const grouped = groupTasks(tasks);
  return (
    <div className={`taskListWorkspace ${completedOnly ? "completedOnly" : ""}`}>
      <div className="listScreen">
        {deliveryTypes.map((type) => {
          const rows = grouped.get(type) ?? [];
          if (!rows.length) return null;
          return (
            <section className="typeGroup" key={type}>
              <h2 className="groupTitle" style={{ color: rows[0].taskTypeColor ?? undefined }}>{type === "Evento" ? <CalendarDays size={22} /> : <ListTodo size={22} />}{type}</h2>
              {rows.map((task) => (
                <article className={`dataRow taskRow card-${density} ${task.itemKind === "event" ? "eventRow" : ""} ${selectedTask?.id === task.id ? "selected" : ""}`} style={{ borderLeft: `5px solid ${task.courseColor ?? "#4285dc"}` }} key={task.id}>
                  <button className="taskRowButton" onClick={() => onSelect(task.id)} type="button" aria-label={`Ver detalles de ${task.title}`}>
                    <span className="rowMain"><strong>{task.title}</strong><span>{task.course}</span></span>
                    <span className="rowDue">{task.itemKind === "event" && task.startsAt ? `Inicio ${formatTaskDateTime(task.startsAt.slice(0, 10), task.startsAt.slice(11, 16))}${task.endsAt ? ` · Fin ${formatTaskDateTime(task.endsAt.slice(0, 10), task.endsAt.slice(11, 16))}` : ""}` : formatTaskDateTime(task.dueDate, task.dueTime)}</span>
                  </button>
                  <div className="rowSide">
                    <span className={`days ${taskDayTone(task)}`}>{taskDayLabel(task)}</span>
                    {safeExternalHref(task.materialUrl) ? <a className="openIcon" aria-label="Abrir material" title="Abrir material" href={safeExternalHref(task.materialUrl)} target="_blank" rel="noreferrer"><ExternalLink size={20} /></a> : null}
                    {role === "admin" ? <button className="miniAction" aria-label="Marcar entregada" title="Marcar entregada" onClick={() => onDone(task.id)} type="button"><Check size={16} /></button> : null}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
        {!tasks.length ? <section className="emptyLibrary"><strong>{completedOnly ? "Sin tareas entregadas" : "Sin tareas activas"}</strong><p>{completedOnly ? "Cuando marques una tarea como entregada aparecerá aquí." : "Las tareas entregadas se muestran solamente en Entregadas."}</p></section> : null}
      </div>
      {onCreate ? (
        <button className="taskCreateDock" onClick={onCreate} type="button">
          <Plus size={18} />
          <span>Nueva actividad</span>
        </button>
      ) : null}
    </div>
  );
}

function TaskCreateModal({
  open,
  source,
  form,
  courses,
  taskTypes,
  busy,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  source: "calendar" | "tasks";
  form: TaskForm;
  courses: CourseConfig[];
  taskTypes: TaskTypeConfig[];
  busy: boolean;
  onClose: () => void;
  onChange: TaskFormChange;
  onSubmit: (form: TaskForm) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useContainedDialogFocus(open, dialogRef, onClose);

  if (!open) return null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onSubmit(form);
  }

  return (
    <>
      <div className="taskModalBackdrop" aria-hidden="true" onClick={onClose} />
      <section ref={dialogRef} className="taskCreateModal" role="dialog" aria-modal="true" aria-labelledby="task-create-title">
        <div className="taskCreateHead">
          <div>
            <p className="eyebrow">{source === "calendar" ? "Calendario" : "Tareas"}</p>
            <h2 id="task-create-title">{form.itemKind === "event" ? "Nuevo evento" : "Nueva tarea"}</h2>
          </div>
          <button className="iconButton modalCloseButton" aria-label="Cerrar formulario" title="Cerrar" onClick={onClose} type="button"><X size={20} /></button>
        </div>
        <form className="taskForm taskCreateForm" onSubmit={submit}>
          <ActivityKindFields form={form} courses={courses} taskTypes={taskTypes} onChange={onChange} />
          <label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value as TaskStatus)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Prioridad<select value={form.priority} onChange={(event) => onChange("priority", event.target.value)}><option>Alta</option><option>Media</option><option>Baja</option></select></label>
          {form.itemKind === "task" ? (<>
            <label className="wide">Material necesario<input value={form.materialNeeded} onChange={(event) => onChange("materialNeeded", event.target.value)} /></label>
            <label className="wide">Recurso externo<input value={form.materialUrl} onChange={(event) => onChange("materialUrl", event.target.value)} /></label>
            <TaskMaterialPicker
              selectedIds={form.materialIds}
              onChange={(ids) => onChange("materialIds", ids)}
            />
          </>) : null}
          <label className="wide">Link plataforma<input value={form.platformUrl} onChange={(event) => onChange("platformUrl", event.target.value)} /></label>
          <label className="wide">Instrucciones<textarea value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></label>
      <CloudflareImageUpload value={form.image} category={form.itemKind} label={form.itemKind === "event" ? "Imagen del evento" : "Imagen para las instrucciones"} onChange={(image) => onChange("image", image)} />
          <label className="taskCheck"><input type="checkbox" checked={form.visible} onChange={(event) => onChange("visible", event.target.checked)} /> Visible para alumnos</label>
          <button className="primaryAction" disabled={busy || !form.title.trim()} type="submit">{busy ? "Creando..." : form.itemKind === "event" ? "Crear evento" : "Crear tarea"}</button>
        </form>
      </section>
    </>
  );
}

function Group({ members, d1Client, role, canManageMembers, profile, onMembersChange, onError }: { members: UiGroupMember[]; d1Client: D1Browser | null; role: ViewRole; canManageMembers: boolean; profile: Profile | null; onMembersChange: (members: UiGroupMember[]) => void; onError: (error: string | null) => void }) {
  const [memberRows, setMemberRows] = useState<UiGroupMember[]>(members);
  const [memberForm, setMemberForm] = useState({ id: "", fullName: "", email: "", controlNumber: "", active: true });
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [columns, setColumns] = useState<BooleanGroupColumn[]>(fixedBooleanColumns);
  const [values, setValues] = useState<GroupValueStore>({});
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [usingRemote, setUsingRemote] = useState(false);


  useEffect(() => { setMemberRows(members); }, [members]);

  function resetMemberForm() {
    setMemberForm({ id: "", fullName: "", email: "", controlNumber: "", active: true });
  }

  function editMember(member: UiGroupMember) {
    setMemberForm({ id: member.profileId ?? "", fullName: member.fullName, email: member.email, controlNumber: member.controlNumber, active: true });
    setMemberMessage(null);
  }

  async function saveMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageMembers || memberBusy) return;
    setMemberBusy(true);
    setMemberMessage(null);
    try {
      const editing = Boolean(memberForm.id);
      const response = await fetch("/api/admin/students", {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...(editing ? { id: memberForm.id } : {}), fullName: memberForm.fullName, email: memberForm.email, controlNumber: memberForm.controlNumber, active: memberForm.active }),
      });
      const payload = await response.json() as { student?: Record<string, unknown>; message?: string; error?: string };
      if (!response.ok || !payload.student) throw new Error(payload.error ?? "No se pudo guardar el alumno.");
      const saved = toGroupMember(payload.student);
      const savedActive = payload.student.active === true || payload.student.active === 1 || payload.student.active === "1";
      const next = savedActive
        ? (memberRows.some((member) => member.profileId === saved.profileId)
          ? memberRows.map((member) => member.profileId === saved.profileId ? { ...member, ...saved } : member)
          : [...memberRows, saved])
        : memberRows.filter((member) => member.profileId !== saved.profileId);
      const sorted = next.sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
      setMemberRows(sorted);
      onMembersChange(sorted);
      setMemberMessage(payload.message ?? (editing ? "Alumno actualizado." : "Alumno agregado."));
      resetMemberForm();
    } catch (error) { onError(error instanceof Error ? error.message : "No se pudo guardar el alumno."); }
    finally { setMemberBusy(false); }
  }

  async function removeMember(member: UiGroupMember) {
    if (!canManageMembers || !member.profileId || memberBusy) return;
    if (!window.confirm(`Eliminar a ${member.fullName} de la lista de grupo?`)) return;
    setMemberBusy(true);
    try {
      const response = await fetch("/api/admin/students", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ id: member.profileId }) });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo eliminar el alumno.");
      const next = memberRows.filter((row) => row.profileId !== member.profileId);
      setMemberRows(next);
      onMembersChange(next);
      if (memberForm.id === member.profileId) resetMemberForm();
      setMemberMessage(payload.message ?? "Alumno eliminado.");
    } catch (error) { onError(error instanceof Error ? error.message : "No se pudo eliminar el alumno."); }
    finally { setMemberBusy(false); }
  }

  const loadGroupConfig = useCallback(async () => {
    if (d1Client && role === "admin") {
      const [columnRes, valueRes] = await Promise.all([
        d1Client
          .from("group_columns")
          .select("id,source_key,label,fixed,sort_order")
          .eq("active", true)
          .order("sort_order"),
        d1Client
          .from("group_column_values")
          .select("profile_id,column_id,value"),
      ]);

      if (!columnRes.error && !valueRes.error) {
        const remoteColumns = ((columnRes.data ?? []) as unknown[]).map((row) => toGroupColumn(row as GroupColumnRow));
        setColumns(remoteColumns.length ? remoteColumns : fixedBooleanColumns);
        setValues(toGroupValueStore((valueRes.data ?? []) as GroupValueRow[]));
        setUsingRemote(true);
        setStorageReady(true);
        return;
      }

      onError(columnRes.error?.message ?? valueRes.error?.message ?? null);
      setColumns(fixedBooleanColumns);
      setValues({});
      setUsingRemote(false);
      setStorageReady(true);
      return;
    }

    try {
      const raw = window.localStorage.getItem("pscv-group-columns-v2");
      if (raw) {
        const parsed = JSON.parse(raw) as { columns?: BooleanGroupColumn[]; values?: GroupValueStore };
        const storedColumns = Array.isArray(parsed.columns) ? parsed.columns.filter((column) => column.id && column.label && !column.fixed) : [];
        setColumns([...fixedBooleanColumns, ...storedColumns]);
        setValues(parsed.values && typeof parsed.values === "object" ? parsed.values : {});
      } else {
        setColumns(fixedBooleanColumns);
        setValues({});
      }
    } catch {
      setColumns(fixedBooleanColumns);
      setValues({});
    } finally {
      setUsingRemote(false);
      setStorageReady(true);
    }
  }, [onError, role, d1Client]);

  useEffect(() => {
    void loadGroupConfig();
  }, [loadGroupConfig]);

  useEffect(() => {
    if (!storageReady || usingRemote) return;
    window.localStorage.setItem("pscv-group-columns-v2", JSON.stringify({ columns: columns.filter((column) => !column.fixed), values }));
  }, [columns, values, storageReady, usingRemote]);

  async function addColumn() {
    const label = newColumnLabel.trim();
    if (!label) return;
    const sortOrder = Math.max(0, ...columns.map((column) => column.sortOrder ?? 0)) + 10;

    if (usingRemote && d1Client) {
      const { data, error } = await d1Client
        .from("group_columns")
        .insert({ label, sort_order: sortOrder, created_by: profile?.id ?? null })
        .select("id,source_key,label,fixed,sort_order")
        .single();
      if (error) {
        onError(error.message);
        return;
      }
      if (data) setColumns((current) => [...current, toGroupColumn(data as GroupColumnRow)]);
    } else {
      setColumns((current) => [...current, { id: `custom-${Date.now()}`, label, sortOrder }]);
    }

    setNewColumnLabel("");
  }

  function startEditing(column: BooleanGroupColumn) {
    setEditingColumnId(column.id);
    setEditingLabel(column.label);
  }

  async function saveColumnLabel(id: string) {
    const label = editingLabel.trim();
    if (label) {
      if (usingRemote && d1Client) {
        const { error } = await d1Client
          .from("group_columns")
          .update({ label, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) {
          onError(error.message);
        } else {
          setColumns((current) => current.map((column) => column.id === id ? { ...column, label } : column));
        }
      } else {
        setColumns((current) => current.map((column) => column.id === id ? { ...column, label } : column));
      }
    }
    setEditingColumnId(null);
    setEditingLabel("");
  }

  async function removeColumn(id: string) {
    const column = columns.find((item) => item.id === id);
    if (column?.fixed) return;

    if (usingRemote && d1Client) {
      const { error } = await d1Client
        .from("group_columns")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        onError(error.message);
        return;
      }
    }

    setColumns((current) => current.filter((item) => item.id !== id));
    setValues((current) => {
      const next: GroupValueStore = {};
      for (const [memberId, row] of Object.entries(current)) {
        const nextRow = { ...row };
        delete nextRow[id];
        next[memberId] = nextRow;
      }
      return next;
    });
  }

  function memberKey(member: UiGroupMember) {
    return usingRemote && member.profileId ? member.profileId : member.controlNumber;
  }

  function cellValue(member: UiGroupMember, column: BooleanGroupColumn) {
    const override = values[memberKey(member)]?.[column.id];
    if (override !== undefined) return override;
    return !usingRemote && column.source ? Boolean(member[column.source]) : false;
  }

  async function toggleCell(member: UiGroupMember, column: BooleanGroupColumn) {
    const key = memberKey(member);
    const nextValue = !cellValue(member, column);
    setValues((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        [column.id]: nextValue,
      },
    }));

    if (usingRemote && d1Client && member.profileId) {
      const { error } = await d1Client
        .from("group_column_values")
        .upsert({
          profile_id: member.profileId,
          column_id: column.id,
          value: nextValue,
          updated_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "profile_id,column_id" });
      if (error) {
        onError(error.message);
        setValues((current) => ({
          ...current,
          [key]: {
            ...(current[key] ?? {}),
            [column.id]: !nextValue,
          },
        }));
      }
    }
  }

  return (
    <div className="groupScreen">
      <section className="groupToolbar">
        <div>
          <strong>Lista de grupo</strong>
          <span>{memberRows.length} alumnos · {usingRemote ? "Sincronizada en D1" : "Sin sincronización remota"}</span>
        </div>
        <label>
          <input value={newColumnLabel} onChange={(event) => setNewColumnLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addColumn(); }} placeholder="Nuevo encabezado" />
          <button onClick={() => void addColumn()} type="button"><Plus size={16} />Columna</button>
        </label>
      </section>
      {canManageMembers ? (
        <form className="groupMemberForm" onSubmit={saveMember}>
          <label>Nombre completo<input value={memberForm.fullName} onChange={(event) => setMemberForm((current) => ({ ...current, fullName: event.target.value }))} required /></label>
          <label>Correo electrónico<input type="email" value={memberForm.email} onChange={(event) => setMemberForm((current) => ({ ...current, email: event.target.value }))} required /></label>
          <label>Número de control<input value={memberForm.controlNumber} onChange={(event) => setMemberForm((current) => ({ ...current, controlNumber: event.target.value }))} /></label>
          <label className="groupMemberActive"><input type="checkbox" checked={memberForm.active} onChange={(event) => setMemberForm((current) => ({ ...current, active: event.target.checked }))} /> Activo</label>
          <div className="groupMemberActions">
            {memberForm.id ? <button type="button" onClick={resetMemberForm} disabled={memberBusy}>Cancelar</button> : null}
            <button className="primaryAction" type="submit" disabled={memberBusy || !memberForm.fullName.trim() || !memberForm.email.trim()}>{memberBusy ? "Guardando…" : memberForm.id ? "Guardar cambios" : "Agregar alumno"}</button>
          </div>
          {memberMessage ? <p className="groupMemberMessage" role="status">{memberMessage}</p> : null}
        </form>
      ) : null}
      <div className="tableWrap groupTableWrap">
        <table className="appTable memberTable">
          <thead>
            <tr>
              <th>No. Control</th>
              <th>Correo electrónico</th>
              <th>Nombre completo</th>
              {canManageMembers ? <th className="memberActionsHeader">Acciones</th> : null}
              {columns.map((column) => (
                <th className="booleanHeader" key={column.id}>
                  <div className="groupColumnHeader">
                    {editingColumnId === column.id ? (
                      <input
                        value={editingLabel}
                        onChange={(event) => setEditingLabel(event.target.value)}
                        onBlur={() => void saveColumnLabel(column.id)}
                        onKeyDown={(event) => { if (event.key === "Enter") void saveColumnLabel(column.id); }}
                        autoFocus
                      />
                    ) : (
                      <span>{column.label}</span>
                    )}
                    <button aria-label={`Editar ${column.label}`} title="Editar encabezado" onClick={() => startEditing(column)} type="button"><Edit3 size={14} /></button>
                    {column.fixed ? <span className="headerSpacer" /> : <button aria-label={`Eliminar ${column.label}`} title="Eliminar columna" onClick={() => void removeColumn(column.id)} type="button"><Trash2 size={14} /></button>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {memberRows.map((member) => (
              <tr key={member.controlNumber}>
                <td>{member.controlNumber}</td>
                <td>{member.email}</td>
                <td>{member.fullName}</td>
                {canManageMembers ? <td className="memberActionsCell"><button type="button" onClick={() => editMember(member)} aria-label={`Editar ${member.fullName}`}><Edit3 size={14} /></button><button type="button" onClick={() => void removeMember(member)} aria-label={`Eliminar ${member.fullName}`} disabled={memberBusy}><Trash2 size={14} /></button></td> : null}
                {columns.map((column) => {
                  const checked = cellValue(member, column);
                  return (
                    <td className="booleanCell" key={column.id}>
                      <button className={`boolToggle ${checked ? "on" : ""}`} aria-pressed={checked} onClick={() => void toggleCell(member, column)} type="button">
                        {checked ? <Check size={14} /> : <X size={14} />}
                        <span>{checked ? "Sí" : "No"}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Preferences({ profile, d1Client, onProfile, onError }: { profile: Profile | null; d1Client: D1Browser | null; onProfile: (profile: Profile | null) => void; onError: (error: string | null) => void }) {
  const prefs = profile?.preferences ?? fallbackPrefs;

  async function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    const next = { ...prefs, [key]: value };
    if (profile) onProfile({ ...profile, preferences: next });
    if (d1Client && profile) {
      const { error } = await d1Client
        .from("app_profiles")
        .update({ preferences: next, updated_at: new Date().toISOString() })
        .eq("id", profile.id);
      if (error) {
        const fallback = await d1Client.rpc("update_my_preferences", { preferences_input: next });
        if (fallback.error) onError(fallback.error.message);
      }
    }
  }

  return (
    <div className="settingsScreen">
      <section className="settingsCard">
        <p className="eyebrow">Alumno</p>
        <h2>Preferencias</h2>
        <div className="settingsGrid">
          <label>Vista<select value={prefs.calendarView} onChange={(event) => void update("calendarView", event.target.value as UserPreferences["calendarView"])}><option value="month">Mes</option><option value="week">Semana</option><option value="day">Día</option></select></label>
          <label>Densidad<select value={prefs.taskDensity} onChange={(event) => void update("taskDensity", event.target.value as CardSize)}><option value="compact">Compacta</option><option value="medium">Media</option><option value="large">Grande</option></select></label>
          <label>Previews<select value={prefs.materialPreviewSize} onChange={(event) => void update("materialPreviewSize", event.target.value as UserPreferences["materialPreviewSize"])}><option value="small">Pequeños</option><option value="medium">Medianos</option><option value="large">Grandes</option></select></label>
          <label className="checkSetting"><input type="checkbox" checked={prefs.showCompleted} onChange={(event) => void update("showCompleted", event.target.checked)} /> Guardar entregadas en mi perfil</label>
        </div>
      </section>
    </div>
  );
}


const scheduleDayAliases: Record<string, { key: string; label: string; order: number }> = {
  lunes: { key: "lunes", label: "Lunes", order: 1 }, lun: { key: "lunes", label: "Lunes", order: 1 },
  martes: { key: "martes", label: "Martes", order: 2 }, mar: { key: "martes", label: "Martes", order: 2 },
  miercoles: { key: "miercoles", label: "Miércoles", order: 3 }, mie: { key: "miercoles", label: "Miércoles", order: 3 },
  jueves: { key: "jueves", label: "Jueves", order: 4 }, jue: { key: "jueves", label: "Jueves", order: 4 },
  viernes: { key: "viernes", label: "Viernes", order: 5 }, vie: { key: "viernes", label: "Viernes", order: 5 },
  sabado: { key: "sabado", label: "Sábado", order: 6 }, sab: { key: "sabado", label: "Sábado", order: 6 },
  domingo: { key: "domingo", label: "Domingo", order: 7 }, dom: { key: "domingo", label: "Domingo", order: 7 },
};

function parseScheduleEntries(course: CourseConfig) {
  return course.scheduleText.split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean).map((entry, index) => {
    const separatorIndex = entry.indexOf(":");
    const dayPart = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;
    const detail = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : "Horario por confirmar";
    const normalizedDay = dayPart.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const day = scheduleDayAliases[normalizedDay] ?? { key: `other-${index}`, label: dayPart.trim() || "Otro", order: 99 };
    return { ...day, detail, course };
  });
}

function ScheduleAndProfessors({ courses }: { courses: CourseConfig[] }) {
  const scheduleEntries = courses.flatMap(parseScheduleEntries).sort((a, b) => a.order - b.order || a.course.name.localeCompare(b.course.name, "es"));
  const grouped = new Map<string, { label: string; order: number; entries: typeof scheduleEntries }>();
  for (const entry of scheduleEntries) {
    const current = grouped.get(entry.key);
    if (current) current.entries.push(entry);
    else grouped.set(entry.key, { label: entry.label, order: entry.order, entries: [entry] });
  }
  const days = [...grouped.values()].sort((a, b) => a.order - b.order);

  return (
    <div className="scheduleScreen">
      <section className="scheduleHero">
        <div><span className="scheduleEyebrow">Información académica</span><h2>Horario y profesores</h2><p>Consulta en un mismo lugar quién imparte cada materia y cuándo se reúne el grupo.</p></div>
        <GraduationCap size={34} aria-hidden="true" />
      </section>
      <section className="professorGrid" aria-label="Profesores por materia">
        {courses.map((course) => (
          <article className="professorCard" key={course.id}>
            <span className="courseIcon" style={{ color: course.color }}><UiIcon name={course.icon} size={22} /></span>
            <div><small>{course.shortName || course.name}</small><strong>{course.professorName || "Profesor por definir"}</strong><span>{course.professorEmail || "Correo no registrado"}</span></div>
          </article>
        ))}
      </section>
      <section className="weeklySchedule" aria-label="Horario semanal">
        <div className="sectionTitleRow"><div><span className="scheduleEyebrow">Semana</span><h3>Horario del grupo</h3></div><CalendarDays size={22} aria-hidden="true" /></div>
        {days.length ? days.map((day) => (
          <article className="scheduleDay" key={`${day.order}-${day.label}`}>
            <h4>{day.label}</h4>
            <div className="scheduleDayEntries">
              {day.entries.map((entry, index) => (
                <div className="scheduleEntry" key={`${entry.course.id}-${index}`}>
                  <span className="courseIcon" style={{ color: entry.course.color }}><UiIcon name={entry.course.icon} size={19} /></span>
                  <div><strong>{entry.course.name}</strong><span><Clock size={15} aria-hidden="true" />{entry.detail}</span><small><GraduationCap size={14} aria-hidden="true" />{entry.course.professorName || "Profesor por definir"}</small></div>
                </div>
              ))}
            </div>
          </article>
        )) : <div className="scheduleEmpty"><MapPin size={24} aria-hidden="true" /><strong>Horario pendiente de captura</strong><p>Un administrador puede registrarlo desde Configuración → Materias.</p></div>}
      </section>
    </div>
  );
}

function titleFor(tab: Tab) {
  return tab === "calendar" ? "Calendario" : tab === "tasks" ? "Tareas" : tab === "materials" ? "Materiales" : tab === "schedule" ? "Horario y profesores" : tab === "completed" ? "Entregadas" : tab === "group" ? "Lista de grupo" : tab === "prefs" ? "Preferencias" : tab === "taskDetail" ? "Detalle de tarea" : "Configuración";
}
function monthCells(year: number, month: number) { const first = new Date(year, month, 1).getDay(); const total = new Date(year, month + 1, 0).getDate(); const cells: Array<number | null> = Array(first).fill(null).concat(Array.from({ length: total }, (_, index) => index + 1)); while (cells.length % 7 !== 0) cells.push(null); return cells; }
function groupTasks(tasks: UiTask[]) { const map = new Map<DeliveryType, UiTask[]>(); tasks.forEach((task) => map.set(task.deliveryType, [...(map.get(task.deliveryType) ?? []), task])); return map; }
function filterTasks(tasks: UiTask[], query: string) { const q = query.toLowerCase().trim(); return q ? tasks.filter((task) => [task.title, task.course, task.materialNeeded, task.notes].some((value) => value?.toLowerCase().includes(q))) : tasks; }
function formatTaskTime(value: string) { return value.slice(0, 5); }
function isEventTypeName(value: string | null | undefined) { return value?.trim().toLocaleLowerCase("es") === "evento"; }
function safeExternalHref(value: string | null | undefined) {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
function formatTaskDateTime(date: string, time: string) {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return `${date} ${formatTaskTime(time)}`.trim();
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year} ${formatTaskTime(time)}`;
}
function taskDayLabel(task: Pick<UiTask, "daysRemaining" | "itemKind">) {
  if (task.daysRemaining === 0) return "Hoy";
  if (task.daysRemaining === 1) return "Mañana";
  if (task.daysRemaining < 0) return task.itemKind === "event" ? "Finalizado" : "Vencida";
  return `En ${task.daysRemaining} días`;
}
function taskDayTone(task: Pick<UiTask, "daysRemaining" | "itemKind">) {
  if (task.daysRemaining === 0) return "today";
  if (task.daysRemaining === 1) return "tomorrow";
  if (task.daysRemaining < 0) return task.itemKind === "event" ? "past" : "overdue";
  return "upcoming";
}
function formatOptionalSync(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(",", "");
}
function asOne<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function cardSize(value: unknown): CardSize { return value === "compact" || value === "large" ? value : "medium"; }
function delivery(value: unknown): DeliveryType { const text = String(value ?? "Tarea"); return deliveryTypes.includes(text as DeliveryType) ? text as DeliveryType : "Tarea"; }
function status(value: unknown): TaskStatus { const text = String(value ?? "Pendiente"); return statuses.includes(text as TaskStatus) ? text as TaskStatus : "Pendiente"; }
function toCourse(row: Record<string, unknown>): CourseConfig { return { id: String(row.id), name: String(row.name), shortName: String(row.short_name ?? row.name), color: String(row.color ?? "#4285dc"), icon: String(row.icon ?? "book"), cardSize: cardSize(row.card_size), active: Boolean(row.active ?? true), professorName: String(row.professor_name ?? ""), professorEmail: String(row.professor_email ?? ""), scheduleText: String(row.schedule_text ?? "") }; }
function toSection(row: Record<string, unknown>): SectionConfig { return { id: String(row.id), name: String(row.name), path: String(row.path), color: String(row.color ?? "#4285dc"), icon: String(row.icon ?? "folder"), cardSize: cardSize(row.card_size), previewStyle: String(row.preview_style ?? "thumbnail"), active: Boolean(row.active ?? true) }; }
function toTask(row: Record<string, unknown>): UiTask {
  const course = asOne(row.courses as Record<string, unknown> | Record<string, unknown>[] | null);
  const type = asOne(row.task_types as Record<string, unknown> | Record<string, unknown>[] | null);
  const dueDate = String(row.due_date);
  const daysRemaining = calculateDaysRemaining(dueDate);
  const next = deriveStatus(status(row.status), daysRemaining);
  return {
    id: String(row.id),
    courseId: row.course_id ? String(row.course_id) : course?.id ? String(course.id) : undefined,
    taskTypeId: row.task_type_id ? String(row.task_type_id) : type?.id ? String(type.id) : undefined,
    priority: row.priority ? String(row.priority) : "Media",
    course: String(course?.name ?? "Sin materia"),
    itemKind: String(row.item_kind ?? "task") === "event" || isEventTypeName(String(type?.name ?? "")) ? "event" : "task",
    startsAt: row.starts_at ? String(row.starts_at) : undefined,
    endsAt: row.ends_at ? String(row.ends_at) : undefined,
    location: row.location ? String(row.location) : undefined,
    dueDate,
    dueTime: String(row.due_time ?? "23:59").slice(0, 5),
    title: String(row.title ?? "Sin título"),
    materialNeeded: row.material_needed ? String(row.material_needed) : "",
    materialUrl: row.material_url ? String(row.material_url) : "",
    deliveryType: delivery(type?.name),
    status: next,
    daysRemaining,
    notes: row.notes ? String(row.notes) : "",
    platformUrl: row.platform_url ? String(row.platform_url) : "",
    imageId: row.image_id ? String(row.image_id) : undefined,
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    visibleToReaders: Boolean(row.visible_to_students),
    courseColor: course?.color ? String(course.color) : undefined,
    taskTypeColor: type?.color ? String(type.color) : undefined,
    courseCardSize: cardSize(course?.card_size),
    linkedMaterials: toTaskLinkedMaterials(row.task_materials),
  };
}
function toGroupMember(row: Record<string, unknown>): UiGroupMember {
  const email = String(row.email ?? "");
  const fallbackControl = email.includes("@") ? email.split("@")[0] : String(row.id ?? "");
  return {
    profileId: String(row.id),
    controlNumber: String(row.control_number ?? fallbackControl),
    email,
    fullName: String(row.full_name ?? email ?? "Sin nombre"),
    attended: false,
    licenseIssue: false,
    authIssue: false,
  };
}
function toGroupColumn(row: GroupColumnRow): BooleanGroupColumn {
  const source = row.source_key === "attended" || row.source_key === "licenseIssue" || row.source_key === "authIssue" ? row.source_key : undefined;
  return {
    id: String(row.id),
    label: String(row.label),
    source,
    fixed: Boolean(row.fixed),
    sortOrder: Number(row.sort_order ?? 0),
  };
}
function toGroupValueStore(rows: GroupValueRow[]): GroupValueStore {
  return rows.reduce<GroupValueStore>((store, row) => {
    const memberId = String(row.profile_id);
    store[memberId] = { ...(store[memberId] ?? {}), [String(row.column_id)]: Boolean(row.value) };
    return store;
  }, {});
}

function toTaskLinkedMaterials(value: unknown): MaterialOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const relation = item as { materials?: unknown };
    const material = relation.materials;
    const rows = Array.isArray(material) ? material : material ? [material] : [];
    return rows.map(toMaterialOption);
  });
}

function toMaterialOption(value: unknown): MaterialOption {
  const row = value as Record<string, unknown>;
  const id = String(row.id);
  const r2Key = row.r2_key ? String(row.r2_key) : null;
  const sectionValue = row.section ?? row.material_sections;
  const section = asOne(sectionValue as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    id,
    title: String(row.title ?? row.file_name ?? "Material"),
    material_type: row.material_type ? String(row.material_type) : null,
    provider: row.provider ? String(row.provider) : null,
    source_url: r2Key ? `/api/materials/${encodeURIComponent(id)}/file?mode=download` : row.source_url ? String(row.source_url) : null,
    preview_url: r2Key ? `/api/materials/${encodeURIComponent(id)}/file?mode=preview` : row.preview_url ? String(row.preview_url) : null,
    download_url: r2Key ? `/api/materials/${encodeURIComponent(id)}/file?mode=download` : row.download_url ? String(row.download_url) : null,
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    public_url: row.public_url ? String(row.public_url) : null,
    r2_key: r2Key,
    file_name: row.file_name ? String(row.file_name) : null,
    content_type: row.content_type ? String(row.content_type) : null,
    size_bytes: typeof row.size_bytes === "number" ? row.size_bytes : null,
    section_id: row.section_id ? String(row.section_id) : null,
    section: section ? {
      id: String(section.id),
      name: String(section.name),
      path: String(section.path),
      color: section.color ? String(section.color) : null,
    } : null,
  };
}

function taskToForm(task: UiTask, courses: CourseConfig[], taskTypes: TaskTypeConfig[]): TaskForm {
  const typeId = task.taskTypeId ?? taskTypes.find((type) => type.name === task.deliveryType)?.id ?? taskTypes[0]?.id ?? "";
  const taskTypeDraftId = task.itemKind === "task" && !isEventTypeName(taskTypes.find((type) => type.id === typeId)?.name)
    ? typeId
    : taskTypes.find((type) => !isEventTypeName(type.name))?.id ?? "";
  return newTaskForm({
    itemKind: task.itemKind ?? (task.deliveryType === "Evento" ? "event" : "task"),
    title: task.title,
    courseId: task.courseId ?? courses.find((course) => course.name === task.course)?.id ?? courses[0]?.id ?? "",
    typeId,
    taskTypeDraftId,
    dueDate: task.dueDate,
    dueTime: task.dueTime || "23:59",
    startDate: task.startsAt?.slice(0, 10) ?? task.dueDate,
    startTime: task.startsAt?.slice(11, 16) ?? task.dueTime ?? "09:00",
    endDate: task.endsAt?.slice(0, 10) ?? task.dueDate,
    endTime: task.endsAt?.slice(11, 16) ?? "10:00",
    location: task.location ?? "",
    status: task.status,
    priority: task.priority ?? "Media",
    visible: task.visibleToReaders,
    materialUrl: task.materialUrl ?? "",
    platformUrl: task.platformUrl ?? "",
    notes: task.notes ?? "",
    materialNeeded: task.materialNeeded ?? "",
    materialIds: (task.linkedMaterials ?? []).map((material) => material.id),
    image: task.imageId && task.imageUrl ? { id: task.imageId, url: task.imageUrl } : null,
  });
}
