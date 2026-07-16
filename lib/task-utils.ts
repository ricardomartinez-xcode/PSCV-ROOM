import type { DeliveryType, Task, TaskStatus } from "./domain";

const eventTypes = new Set<DeliveryType>(["Evento"]);
export const ACADEMIC_TIME_ZONE = "America/Mexico_City";

export function dateKeyInTimeZone(date = new Date(), timeZone = ACADEMIC_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOnlyEpoch(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function isEventDelivery(type?: DeliveryType | null) {
  return Boolean(type && eventTypes.has(type));
}

export function calculateDaysRemaining(dueDate: string, now = new Date()) {
  const diff = dateOnlyEpoch(dueDate) - dateOnlyEpoch(dateKeyInTimeZone(now));
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export function deriveStatus(status: TaskStatus, daysRemaining: number, deliveryType?: DeliveryType | null): TaskStatus {
  if (isEventDelivery(deliveryType)) {
    if (status === "Cancelado") return "Cancelado";
    if (status === "Entregado") return "Entregado";
    return status === "Se entrega hoy" ? "Pendiente" : status;
  }

  if (status === "Entregado" || status === "Cancelado" || status === "Reprogramado") {
    return status;
  }
  if (daysRemaining === 0) return "Se entrega hoy";
  return status;
}

export function deriveReaderVisibility(
  task: Pick<Task, "status"> & Partial<Pick<Task, "deliveryType">>,
) {
  if (isEventDelivery(task.deliveryType)) {
    return task.status !== "Cancelado";
  }

  return task.status !== "Entregado" && task.status !== "Cancelado";
}

export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const dateA = `${a.dueDate}T${a.dueTime}`;
    const dateB = `${b.dueDate}T${b.dueTime}`;
    return dateA.localeCompare(dateB);
  });
}

export function groupByCourse(tasks: Task[]) {
  return tasks.reduce<Record<string, Task[]>>((acc, task) => {
    acc[task.course] = acc[task.course] ?? [];
    acc[task.course].push(task);
    return acc;
  }, {});
}

export function deliveryTone(type: DeliveryType) {
  const tone: Record<DeliveryType, string> = {
    Tarea: "blue",
    Evento: "purple",
    Lectura: "green",
    Examen: "red",
    Exposición: "purple",
    Proyecto: "orange",
    Material: "cyan",
    Recordatorio: "gray",
    Práctica: "teal",
  };

  return tone[type] ?? "blue";
}

export function calendarTone(task: Task) {
  if (isEventDelivery(task.deliveryType)) return "purple";
  if (task.status === "Entregado") return "green";
  if (task.status === "Se entrega hoy") return "red";
  if (task.daysRemaining < 0) return "orange";
  return "blue";
}
