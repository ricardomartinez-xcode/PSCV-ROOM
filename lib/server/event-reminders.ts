import { resolveEventReminderSchedule } from "@/lib/event-reminder-schedule";
import { d1First, d1Run } from "@/lib/server/d1-data";

const EVENT_TASK_TYPE_NAME = "Evento";
export const ACTIVITY_REMINDER_KINDS = [
  "event_reminder_day_before",
  "task_reminder_3_days",
  "task_reminder_2_days",
  "task_reminder_1_day",
  "task_reminder_day_of",
] as const;
type ActivityReminderKind = (typeof ACTIVITY_REMINDER_KINDS)[number];
type TaskTypeRow = { name: string };
export type SyncActivityReminderInput = { taskId:string; title:string; dueDate:string; dueTime?:string|null; taskTypeId?:string|null; itemKind?:"task"|"event"; startsAt?:string|null; endsAt?:string|null; actorId?:string|null };
function display(date:string,time?:string|null){return `${date} · ${time?.slice(0,5)||"todo el día"}`;}
async function typeName(id?:string|null){if(!id)return null;const row=await d1First<TaskTypeRow>("SELECT name FROM task_types WHERE id = ? LIMIT 1",[id]);return row?.name??null;}
async function dismiss(taskId:string){const p=ACTIVITY_REMINDER_KINDS.map(()=>"?").join(", ");await d1Run(`UPDATE notifications SET dismissed_at=COALESCE(dismissed_at,?) WHERE entity='tasks' AND entity_id=? AND kind IN (${p}) AND dismissed_at IS NULL`,[new Date().toISOString(),taskId,...ACTIVITY_REMINDER_KINDS]);}
async function insert(input:SyncActivityReminderInput,kind:ActivityReminderKind,scheduledFor:string){const labels:Record<ActivityReminderKind,{title:string;body:string;priority:"normal"|"high"}>={
 event_reminder_day_before:{title:`Mañana: ${input.title}`,body:`El evento inicia mañana (${input.startsAt?.replace("T"," ").slice(0,16)??display(input.dueDate,input.dueTime)}${input.endsAt?` · termina ${input.endsAt.replace("T"," ").slice(0,16)}`:""}).`,priority:"high"},
 task_reminder_3_days:{title:`Entrega en 3 días: ${input.title}`,body:`La tarea vence el ${display(input.dueDate,input.dueTime)}.`,priority:"normal"},
 task_reminder_2_days:{title:`Entrega en 2 días: ${input.title}`,body:`La tarea vence el ${display(input.dueDate,input.dueTime)}.`,priority:"normal"},
 task_reminder_1_day:{title:`Entrega mañana: ${input.title}`,body:`La tarea vence el ${display(input.dueDate,input.dueTime)}.`,priority:"high"},
 task_reminder_day_of:{title:`Entrega hoy: ${input.title}`,body:`La tarea vence hoy (${display(input.dueDate,input.dueTime)}).`,priority:"high"}};const m=labels[kind];await d1Run(`INSERT INTO notifications(id,profile_id,kind,priority,title,body,entity,entity_id,action_url,scheduled_for,created_by) VALUES(?,NULL,?,?,?,?, 'tasks',?,'/',?,?)`,[crypto.randomUUID(),kind,m.priority,m.title,m.body,input.taskId,scheduledFor,input.actorId??null]);}
export async function syncEventReminders(input:SyncActivityReminderInput){const event=input.itemKind==="event"||(await typeName(input.taskTypeId))===EVENT_TASK_TYPE_NAME;await dismiss(input.taskId);const now=new Date();if(event){const date=input.startsAt?.slice(0,10)||input.dueDate;const at=resolveEventReminderSchedule(date,-1,now);if(at)await insert(input,"event_reminder_day_before",at);return;}for(const[kind,offset]of [["task_reminder_3_days",-3],["task_reminder_2_days",-2],["task_reminder_1_day",-1],["task_reminder_day_of",0]] as const){const at=resolveEventReminderSchedule(input.dueDate,offset,now);if(at)await insert(input,kind,at);}}
export async function dismissEventReminders(taskId:string){await dismiss(taskId);}
