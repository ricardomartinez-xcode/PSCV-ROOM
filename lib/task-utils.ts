import type { DeliveryType, Task, TaskStatus } from "./domain";

const eventTypes = new Set<DeliveryType>(["Evento"]);

export function isEventDelivery(type?: DeliveryType | null) {
  return Boolean(type && eventTypes.has(type));
}

export function calculateDaysRemaining(dueDate: string, now = new Date()) {
  const target = new Date(`${dueDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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
