export type Role = "reader" | "admin";

export type TaskStatus =
  | "Pendiente"
  | "Se entrega hoy"
  | "En proceso"
  | "Entregado"
  | "Reprogramado"
  | "Cancelado";

export type DeliveryType =
  | "Tarea"
  | "Evento"
  | "Lectura"
  | "Examen"
  | "Exposición"
  | "Proyecto"
  | "Material"
  | "Recordatorio"
  | "Práctica";

export type Task = {
  id: string;
  course: string;
  itemKind?: "task" | "event";
  startsAt?: string;
  endsAt?: string;
  location?: string;
  dueDate: string;
  dueTime: string;
  title: string;
  materialNeeded?: string;
  materialUrl?: string;
  deliveryType: DeliveryType;
  status: TaskStatus;
  daysRemaining: number;
  notes?: string;
  platformUrl?: string;
  calendarEventId?: string;
  lastSync?: string;
  visibleToReaders: boolean;
};

export type Material = {
  id: string;
  type: string;
  scope: string;
  name: string;
  url: string;
  previewUrl?: string;
  fileId?: string;
  folder?: string;
  updatedAt?: string;
};

export type GroupMember = {
  controlNumber: string;
  email: string;
  fullName: string;
  attended: boolean;
  licenseIssue: boolean;
  authIssue: boolean;
};

export type ConfigColumn = {
  key: string;
  name: string;
  active: boolean;
  checkboxes: boolean;
  fixed: boolean;
};

export type NewTaskInput = Pick<
  Task,
  "course" | "dueDate" | "dueTime" | "title" | "deliveryType" | "status"
> &
  Partial<Pick<Task, "materialNeeded" | "materialUrl" | "notes" | "platformUrl">>;

export const courses = [
  "Teoría y Práctica de Procesos Grupales",
  "Alteraciones de la Conducta",
  "Evaluación Psicológica I",
  "Psicología del Aprendizaje",
  "Inglés VI",
  "Psicología en la Problemática Social Mexicana",
] as const;

export const statuses: TaskStatus[] = [
  "Pendiente",
  "Se entrega hoy",
  "En proceso",
  "Entregado",
  "Reprogramado",
  "Cancelado",
];

export const deliveryTypes: DeliveryType[] = [
  "Tarea",
  "Evento",
  "Lectura",
  "Examen",
  "Exposición",
  "Proyecto",
  "Material",
  "Recordatorio",
  "Práctica",
];
