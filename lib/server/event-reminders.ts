import {
  ACTIVITY_REMINDER_KINDS,
  EVENT_REMINDER_SCHEDULES,
  LEGACY_TASK_REMINDER_KINDS,
  TASK_REMINDER_SCHEDULES,
  activityReminderId,
  isTerminalReminderStatus,
  reminderWriteDecision,
  taskReminderActionUrl,
  type ActivityReminderKind,
} from "@/lib/activity-reminder-plan";
import {
  resolveEventReminderSchedule,
  sameMexicoCityDate,
} from "@/lib/event-reminder-schedule";
import { getD1 } from "@/lib/server/cloudflare";
import { d1All, d1First, d1Run } from "@/lib/server/d1-data";

export { ACTIVITY_REMINDER_KINDS } from "@/lib/activity-reminder-plan";

const EVENT_TASK_TYPE_NAME = "Evento";

type TaskTypeRow = {
  name: string;
};

type RecipientRow = {
  id: string;
};

type ExistingReminderRow = {
  id: string;
  scheduled_for: string;
  read_at: string | null;
  dismissed_at: string | null;
};

type ReminderMessage = {
  title: string;
  body: string;
  priority: "normal" | "high";
};

export type ReminderSyncResult = {
  created: number;
  updated: number;
  preserved: number;
  dismissed: number;
};

export type SyncActivityReminderInput = {
  taskId: string;
  title: string;
  dueDate: string;
  dueTime?: string | null;
  taskTypeId?: string | null;
  itemKind?: "task" | "event";
  startsAt?: string | null;
  endsAt?: string | null;
  status: string;
  visibleToStudents: boolean;
  actorId?: string | null;
};

function emptyResult(): ReminderSyncResult {
  return { created: 0, updated: 0, preserved: 0, dismissed: 0 };
}

function mergeResult(target: ReminderSyncResult, source: ReminderSyncResult) {
  target.created += source.created;
  target.updated += source.updated;
  target.preserved += source.preserved;
  target.dismissed += source.dismissed;
}

function changedRows(result: D1Result) {
  const changes = result.meta?.changes;
  return typeof changes === "number" ? changes : Number(changes ?? 0);
}

function display(date: string, time?: string | null) {
  return `${date} · ${time?.slice(0, 5) || "todo el día"}`;
}

function messageFor(input: SyncActivityReminderInput, kind: ActivityReminderKind): ReminderMessage {
  const labels: Record<ActivityReminderKind, ReminderMessage> = {
    event_reminder_day_before: {
      title: `Mañana: ${input.title}`,
      body: `El evento inicia mañana (${
        input.startsAt
          ?.replace("T", " ")
          .slice(0, 16)
          ?? display(input.dueDate, input.dueTime)
      }${
        input.endsAt
          ? ` · termina ${input.endsAt.replace("T", " ").slice(0, 16)}`
          : ""
      }).`,
      priority: "high",
    },
    task_reminder_1_day: {
      title: `Entrega mañana: ${input.title}`,
      body: `La tarea vence el ${display(input.dueDate, input.dueTime)}.`,
      priority: "high",
    },
    task_reminder_day_of: {
      title: `Entrega hoy: ${input.title}`,
      body: `La tarea vence hoy (${display(input.dueDate, input.dueTime)}).`,
      priority: "high",
    },
  };

  return labels[kind];
}

async function typeName(id?: string | null) {
  if (!id) return null;
  const row = await d1First<TaskTypeRow>(
    "SELECT name FROM task_types WHERE id = ? LIMIT 1",
    [id],
  );
  return row?.name ?? null;
}

async function dismissKinds(
  taskId: string,
  kinds: readonly string[],
) {
  if (kinds.length === 0) return 0;
  const placeholders = kinds.map(() => "?").join(", ");
  const result = await d1Run(
    `UPDATE notifications
        SET dismissed_at = COALESCE(dismissed_at, ?)
      WHERE entity = 'tasks'
        AND entity_id = ?
        AND kind IN (${placeholders})
        AND dismissed_at IS NULL`,
    [new Date().toISOString(), taskId, ...kinds],
  );
  return changedRows(result);
}

async function dismissIneligibleRecipients(taskId: string, profileIds: string[]) {
  const kindPlaceholders = ACTIVITY_REMINDER_KINDS.map(() => "?").join(", ");
  const profileClause = profileIds.length > 0
    ? `AND (profile_id IS NULL OR profile_id NOT IN (${profileIds.map(() => "?").join(", ")}))`
    : "";
  const result = await d1Run(
    `UPDATE notifications
        SET dismissed_at = COALESCE(dismissed_at, ?)
      WHERE entity = 'tasks'
        AND entity_id = ?
        AND kind IN (${kindPlaceholders})
        AND dismissed_at IS NULL
        ${profileClause}`,
    [
      new Date().toISOString(),
      taskId,
      ...ACTIVITY_REMINDER_KINDS,
      ...profileIds,
    ],
  );
  return changedRows(result);
}

async function dismissUnexpectedKinds(
  taskId: string,
  expectedKinds: readonly ActivityReminderKind[],
) {
  const unexpected = ACTIVITY_REMINDER_KINDS.filter(
    (kind) => !expectedKinds.includes(kind),
  );
  return dismissKinds(taskId, unexpected);
}

async function recipients(visibleToStudents: boolean) {
  return d1All<RecipientRow>(
    `SELECT id
       FROM app_profiles
      WHERE active = 1
        AND (? = 1 OR role <> 'student')
      ORDER BY id`,
    [visibleToStudents ? 1 : 0],
  );
}

async function ensurePreferences(profileIds: string[]) {
  const now = new Date().toISOString();
  for (const profileId of profileIds) {
    await d1Run(
      `INSERT INTO notification_preferences
         (profile_id, in_app_enabled, email_enabled, categories, created_at, updated_at)
       VALUES (?, 1, 1, '{}', ?, ?)
       ON CONFLICT(profile_id) DO NOTHING`,
      [profileId, now, now],
    );
  }
}

async function existingRows(
  taskId: string,
  profileId: string,
  kind: ActivityReminderKind,
) {
  return d1All<ExistingReminderRow>(
    `SELECT id, scheduled_for, read_at, dismissed_at
       FROM notifications
      WHERE entity = 'tasks'
        AND entity_id = ?
        AND profile_id = ?
        AND kind = ?
      ORDER BY CASE WHEN dismissed_at IS NULL THEN 0 ELSE 1 END,
               scheduled_for DESC,
               created_at DESC
      LIMIT 20`,
    [taskId, profileId, kind],
  );
}

async function dismissActiveDuplicates(
  taskId: string,
  profileId: string,
  kind: ActivityReminderKind,
  keepId: string,
) {
  const result = await d1Run(
    `UPDATE notifications
        SET dismissed_at = COALESCE(dismissed_at, ?)
      WHERE entity = 'tasks'
        AND entity_id = ?
        AND profile_id = ?
        AND kind = ?
        AND id <> ?
        AND dismissed_at IS NULL`,
    [new Date().toISOString(), taskId, profileId, kind, keepId],
  );
  return changedRows(result);
}

async function preserveReminder(
  row: ExistingReminderRow,
  input: SyncActivityReminderInput,
  kind: ActivityReminderKind,
  profileId: string,
  message: ReminderMessage,
) {
  const dismissed = await dismissActiveDuplicates(
    input.taskId,
    profileId,
    kind,
    row.id,
  );
  await d1Run(
    `UPDATE notifications
        SET priority = ?, title = ?, body = ?, action_url = ?
      WHERE id = ?`,
    [
      message.priority,
      message.title,
      message.body,
      taskReminderActionUrl(input.taskId),
      row.id,
    ],
  );
  return { ...emptyResult(), preserved: 1, dismissed };
}

async function rescheduleReminder(
  row: ExistingReminderRow,
  input: SyncActivityReminderInput,
  kind: ActivityReminderKind,
  profileId: string,
  scheduledFor: string,
  message: ReminderMessage,
) {
  const dismissed = await dismissActiveDuplicates(
    input.taskId,
    profileId,
    kind,
    row.id,
  );

  // Reset every channel and the logical occurrence in one D1 transaction so a
  // concurrent scheduled invocation never observes a half-rescheduled reminder.
  const db = await getD1();
  await db.batch([
    db.prepare("DELETE FROM push_deliveries WHERE notification_id = ?").bind(row.id),
    db.prepare("DELETE FROM notification_email_deliveries WHERE notification_id = ?").bind(row.id),
    db.prepare(`UPDATE notifications
        SET priority = ?,
            title = ?,
            body = ?,
            action_url = ?,
            scheduled_for = ?,
            read_at = NULL,
            dismissed_at = NULL,
            created_by = COALESCE(?, created_by)
      WHERE id = ?`).bind(
      message.priority,
      message.title,
      message.body,
      taskReminderActionUrl(input.taskId),
      scheduledFor,
      input.actorId ?? null,
      row.id,
    ),
  ]);
  return { ...emptyResult(), updated: 1, dismissed };
}

async function reconcileRows(
  rows: ExistingReminderRow[],
  input: SyncActivityReminderInput,
  kind: ActivityReminderKind,
  profileId: string,
  scheduledFor: string,
  message: ReminderMessage,
): Promise<ReminderSyncResult> {
  const sameOccurrence = rows.find((row) =>
    sameMexicoCityDate(row.scheduled_for, scheduledFor));
  const reusable = sameOccurrence
    ?? rows.find((row) => row.dismissed_at === null)
    ?? rows[0];
  const decision = reminderWriteDecision(Boolean(reusable), Boolean(sameOccurrence));

  if (decision === "preserve" && reusable) {
    return preserveReminder(reusable, input, kind, profileId, message);
  }
  if (decision === "reschedule" && reusable) {
    return rescheduleReminder(
      reusable,
      input,
      kind,
      profileId,
      scheduledFor,
      message,
    );
  }

  const inserted = await d1Run(
    `INSERT OR IGNORE INTO notifications
       (
         id, profile_id, kind, priority, title, body, entity, entity_id,
         action_url, scheduled_for, created_by
       )
     VALUES (?, ?, ?, ?, ?, ?, 'tasks', ?, ?, ?, ?)`,
    [
      activityReminderId(input.taskId, profileId, kind),
      profileId,
      kind,
      message.priority,
      message.title,
      message.body,
      input.taskId,
      taskReminderActionUrl(input.taskId),
      scheduledFor,
      input.actorId ?? null,
    ],
  );

  if (changedRows(inserted) > 0) {
    return { ...emptyResult(), created: 1 };
  }

  // Another at-least-once invocation may have inserted the same logical row.
  const concurrentRows = await existingRows(input.taskId, profileId, kind);
  if (concurrentRows.length === 0) return emptyResult();
  return reconcileRows(
    concurrentRows,
    input,
    kind,
    profileId,
    scheduledFor,
    message,
  );
}

async function upsertReminder(
  input: SyncActivityReminderInput,
  kind: ActivityReminderKind,
  scheduledFor: string,
  profileId: string,
) {
  const rows = await existingRows(input.taskId, profileId, kind);
  return reconcileRows(
    rows,
    input,
    kind,
    profileId,
    scheduledFor,
    messageFor(input, kind),
  );
}

export async function syncEventReminders(
  input: SyncActivityReminderInput,
): Promise<ReminderSyncResult> {
  const result = emptyResult();

  result.dismissed += await dismissKinds(
    input.taskId,
    LEGACY_TASK_REMINDER_KINDS,
  );

  if (isTerminalReminderStatus(input.status)) {
    result.dismissed += await dismissKinds(
      input.taskId,
      ACTIVITY_REMINDER_KINDS,
    );
    return result;
  }

  const event = input.itemKind === "event"
    || (await typeName(input.taskTypeId)) === EVENT_TASK_TYPE_NAME;
  const schedules = event
    ? EVENT_REMINDER_SCHEDULES
    : TASK_REMINDER_SCHEDULES;
  const expectedKinds = schedules.map((schedule) => schedule.kind);
  const profileIds = (await recipients(input.visibleToStudents)).map(
    (recipient) => recipient.id,
  );

  result.dismissed += await dismissIneligibleRecipients(
    input.taskId,
    profileIds,
  );
  result.dismissed += await dismissUnexpectedKinds(
    input.taskId,
    expectedKinds,
  );

  await ensurePreferences(profileIds);
  if (profileIds.length === 0) return result;

  const now = new Date();
  const date = event
    ? input.startsAt?.slice(0, 10) || input.dueDate
    : input.dueDate;

  for (const schedule of schedules) {
    const scheduledFor = resolveEventReminderSchedule(
      date,
      schedule.daysOffset,
      now,
    );
    if (!scheduledFor) {
      result.dismissed += await dismissKinds(input.taskId, [schedule.kind]);
      continue;
    }

    for (const profileId of profileIds) {
      mergeResult(
        result,
        await upsertReminder(input, schedule.kind, scheduledFor, profileId),
      );
    }
  }

  return result;
}

export async function dismissEventReminders(taskId: string) {
  return dismissKinds(taskId, [
    ...ACTIVITY_REMINDER_KINDS,
    ...LEGACY_TASK_REMINDER_KINDS,
  ]);
}
