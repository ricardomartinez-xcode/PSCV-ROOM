import type { DeliveryType, GroupMember, Task, TaskStatus } from "./domain.ts";
import { deliveryTypes, statuses } from "./domain.ts";
import { calculateDaysRemaining, deriveReaderVisibility, deriveStatus } from "./task-utils.ts";

export type CardSize = "compact" | "medium" | "large";

export type UserPreferences = {
  calendarView: "month" | "week" | "day";
  taskDensity: CardSize;
  materialPreviewSize: "small" | "medium" | "large";
  showCompleted: boolean;
  theme: "system" | "light" | "dark";
};

export type Profile = {
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

export type CourseConfig = {
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

export type SectionConfig = {
  id: string;
  name: string;
  path: string;
  color: string;
  icon: string;
  cardSize: CardSize;
  previewStyle: string;
  active: boolean;
};

export type TaskTypeConfig = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
};

export type MaterialSectionOption = {
  id: string;
  name: string;
  path: string;
  color: string | null;
};

export type MaterialOption = {
  id: string;
  title: string;
  material_type: string | null;
  provider: string | null;
  source_url: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  public_url?: string | null;
  r2_key: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  section_id?: string | null;
  section?: MaterialSectionOption | null;
};

export type UiTask = Task & {
  courseId?: string;
  taskTypeId?: string;
  priority?: string;
  courseColor?: string;
  taskTypeColor?: string;
  courseCardSize?: CardSize;
  linkedMaterials?: MaterialOption[];
};

export type UiGroupMember = GroupMember & {
  profileId?: string;
};

const fallbackPrefs: UserPreferences = {
  calendarView: "month",
  taskDensity: "medium",
  materialPreviewSize: "medium",
  showCompleted: false,
  theme: "system",
};

export function booleanFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function cardSize(value: unknown): CardSize {
  return value === "compact" || value === "large" ? value : "medium";
}

export function delivery(value: unknown): DeliveryType {
  const text = String(value ?? "Tarea");
  return deliveryTypes.includes(text as DeliveryType) ? text as DeliveryType : "Tarea";
}

export function status(value: unknown): TaskStatus {
  const text = String(value ?? "Pendiente");
  return statuses.includes(text as TaskStatus) ? text as TaskStatus : "Pendiente";
}

export function asOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizePreferences(value: unknown): UserPreferences {
  const input = objectFromUnknown(value) as Partial<UserPreferences>;
  return {
    calendarView: input.calendarView === "week" || input.calendarView === "day" ? input.calendarView : fallbackPrefs.calendarView,
    taskDensity: cardSize(input.taskDensity),
    materialPreviewSize: input.materialPreviewSize === "small" || input.materialPreviewSize === "large" ? input.materialPreviewSize : fallbackPrefs.materialPreviewSize,
    showCompleted: Boolean(input.showCompleted),
    theme: input.theme === "light" || input.theme === "dark" ? input.theme : fallbackPrefs.theme,
  };
}

export function toProfile(row: Record<string, unknown>): Profile {
  const role = row.role === "owner" ? "owner" : row.role === "admin" ? "admin" : "student";
  const owner = role === "owner";
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name ?? row.email),
    role,
    preferences: normalizePreferences(row.preferences),
    canEditTasks: owner || booleanFlag(row.can_edit_tasks),
    canDeleteTasks: owner || booleanFlag(row.can_delete_tasks),
    canManageMaterials: owner || booleanFlag(row.can_manage_materials),
    canManageUsers: owner || booleanFlag(row.can_manage_users),
    canManageSettings: owner || booleanFlag(row.can_manage_settings),
    canManageGroup: owner || booleanFlag(row.can_manage_group),
    canManageNotifications: owner || booleanFlag(row.can_manage_notifications),
    canViewReports: owner || booleanFlag(row.can_view_reports),
    canManageR2: owner || booleanFlag(row.can_manage_r2),
  };
}

export function toCourse(row: Record<string, unknown>): CourseConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name ?? row.name),
    color: String(row.color ?? "#4285dc"),
    icon: String(row.icon ?? "book"),
    cardSize: cardSize(row.card_size),
    active: row.active == null ? true : booleanFlag(row.active),
    professorName: String(row.professor_name ?? ""),
    professorEmail: String(row.professor_email ?? ""),
    scheduleText: String(row.schedule_text ?? ""),
  };
}

export function toSection(row: Record<string, unknown>): SectionConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    color: String(row.color ?? "#4285dc"),
    icon: String(row.icon ?? "folder"),
    cardSize: cardSize(row.card_size),
    previewStyle: String(row.preview_style ?? "thumbnail"),
    active: row.active == null ? true : booleanFlag(row.active),
  };
}

export function toTaskType(row: Record<string, unknown>): TaskTypeConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color ? String(row.color) : null,
    icon: row.icon ? String(row.icon) : null,
  };
}

export function toTask(row: Record<string, unknown>): UiTask {
  const course = asOne(row.courses as Record<string, unknown> | Record<string, unknown>[] | null);
  const type = asOne(row.task_types as Record<string, unknown> | Record<string, unknown>[] | null);
  const courseName = course?.name ?? row.course_name;
  const courseId = row.course_id ?? course?.id;
  const courseColor = course?.color ?? row.course_color;
  const courseCardSize = course?.card_size ?? row.course_card_size;
  const typeName = type?.name ?? row.task_type_name;
  const typeId = row.task_type_id ?? type?.id;
  const typeColor = type?.color ?? row.task_type_color;
  const dueDate = String(row.due_date);
  const daysRemaining = calculateDaysRemaining(dueDate);
  const next = deriveStatus(status(row.status), daysRemaining);

  return {
    id: String(row.id),
    courseId: courseId ? String(courseId) : undefined,
    taskTypeId: typeId ? String(typeId) : undefined,
    priority: row.priority ? String(row.priority) : "Media",
    course: String(courseName ?? "Sin materia"),
    dueDate,
    dueTime: String(row.due_time ?? "23:59").slice(0, 5),
    title: String(row.title ?? "Sin título"),
    materialNeeded: row.material_needed ? String(row.material_needed) : "",
    materialUrl: row.material_url ? String(row.material_url) : "",
    deliveryType: delivery(typeName),
    status: next,
    daysRemaining,
    notes: row.notes ? String(row.notes) : "",
    platformUrl: row.platform_url ? String(row.platform_url) : "",
    calendarEventId: row.calendar_event_id ? String(row.calendar_event_id) : undefined,
    lastSync: row.last_sync_at ? String(row.last_sync_at) : undefined,
    visibleToReaders: booleanFlag(row.visible_to_students) && deriveReaderVisibility({ status: next }),
    courseColor: courseColor ? String(courseColor) : undefined,
    taskTypeColor: typeColor ? String(typeColor) : undefined,
    courseCardSize: cardSize(courseCardSize),
    linkedMaterials: toTaskLinkedMaterials(row.task_materials),
  };
}

export function toGroupMember(row: Record<string, unknown>): UiGroupMember {
  const email = String(row.email ?? "");
  const fallbackControl = email.includes("@") ? email.split("@")[0] : String(row.id ?? "");
  return {
    profileId: String(row.id),
    controlNumber: String(row.control_number ?? fallbackControl),
    email,
    fullName: String(row.full_name ?? (email || "Sin nombre")),
    attended: false,
    licenseIssue: false,
    authIssue: false,
  };
}

export function toTaskLinkedMaterials(value: unknown): MaterialOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const relation = item as { materials?: unknown };
    const material = relation.materials;
    const rows = Array.isArray(material) ? material : material ? [material] : [];
    return rows.map(toMaterialOption);
  });
}

export function toMaterialOption(value: unknown): MaterialOption {
  const row = value as Record<string, unknown>;
  const sectionValue = row.section ?? row.material_sections;
  const section = asOne(sectionValue as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    id: String(row.id),
    title: String(row.title ?? row.file_name ?? "Material"),
    material_type: row.material_type ? String(row.material_type) : null,
    provider: row.provider ? String(row.provider) : null,
    source_url: row.source_url ? String(row.source_url) : null,
    preview_url: row.preview_url ? String(row.preview_url) : null,
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    public_url: row.public_url ? String(row.public_url) : null,
    r2_key: row.r2_key ? String(row.r2_key) : null,
    file_name: row.file_name ? String(row.file_name) : null,
    content_type: row.content_type ? String(row.content_type) : null,
    size_bytes: typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes ?? 0) || null,
    section_id: row.section_id ? String(row.section_id) : null,
    section: section ? {
      id: String(section.id),
      name: String(section.name),
      path: String(section.path),
      color: section.color ? String(section.color) : null,
    } : null,
  };
}
