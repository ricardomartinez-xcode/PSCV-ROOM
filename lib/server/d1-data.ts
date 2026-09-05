import { getD1 } from "@/lib/server/cloudflare";
import { HttpError, requireProfile, type ServerProfile } from "@/lib/server/authz";

export type DataFilter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "is"; column: string; value: null }
  | { op: "not"; column: string; operator: "is"; value: null }
  | { op: "in"; column: string; value: unknown[] }
  | { op: "lte"; column: string; value: unknown };

export type DataOrder = { column: string; ascending: boolean };

export type DataQuery = {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  select?: string;
  filters?: DataFilter[];
  order?: DataOrder[];
  limit?: number;
  single?: boolean;
  maybeSingle?: boolean;
  head?: boolean;
  count?: "exact";
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  onConflict?: string;
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type TableConfig = {
  columns: string[];
  id?: boolean;
  json?: string[];
  bool?: string[];
};

const tableConfigs: Record<string, TableConfig> = {
  app_profiles: {
    id: true,
    columns: [
      "id",
      "auth_user_id",
      "control_number",
      "email",
      "full_name",
      "role",
      "active",
      "can_edit_tasks",
      "can_delete_tasks",
      "can_manage_materials",
      "can_manage_users",
      "can_manage_settings",
      "can_manage_group",
      "can_manage_notifications",
      "can_view_reports",
      "can_manage_r2",
      "preferences",
      "legacy_notes",
      "created_at",
      "updated_at",
    ],
    json: ["preferences"],
    bool: [
      "active",
      "can_edit_tasks",
      "can_delete_tasks",
      "can_manage_materials",
      "can_manage_users",
      "can_manage_settings",
      "can_manage_group",
      "can_manage_notifications",
      "can_view_reports",
      "can_manage_r2",
    ],
  },
  courses: {
    id: true,
    columns: ["id", "legacy_name", "name", "short_name", "color", "icon", "card_size", "calendar_lane", "sort_order", "active", "config", "professor_name", "professor_email", "schedule_text", "created_at", "updated_at"],
    json: ["config"],
    bool: ["active"],
  },
  task_types: {
    id: true,
    columns: ["id", "name", "color", "icon", "card_size", "sort_order", "active", "config"],
    json: ["config"],
    bool: ["active"],
  },
  material_sections: {
    id: true,
    columns: ["id", "parent_id", "name", "slug", "path", "color", "icon", "card_size", "preview_style", "sort_order", "active", "config", "created_at", "updated_at"],
    json: ["config"],
    bool: ["active"],
  },
  tasks: {
    id: true,
    columns: ["id", "legacy_id", "course_id", "task_type_id", "title", "description", "material_needed", "material_url", "platform_url", "notes", "due_date", "due_time", "item_kind", "starts_at", "ends_at", "location", "status", "priority", "visible_to_students", "calendar_event_id", "last_sync_at", "created_by", "updated_by", "archived_at", "created_at", "updated_at"],
    bool: ["visible_to_students"],
  },
  materials: {
    id: true,
    columns: ["id", "legacy_id", "section_id", "title", "material_type", "visibility", "provider", "source_url", "preview_url", "thumbnail_url", "r2_bucket", "r2_key", "file_id", "file_name", "content_type", "size_bytes", "observations", "uploaded_by", "created_at", "updated_at"],
  },
  group_columns: {
    id: true,
    columns: ["id", "source_key", "label", "value_type", "fixed", "active", "sort_order", "created_by", "created_at", "updated_at"],
    bool: ["fixed", "active"],
  },
  group_column_values: {
    columns: ["profile_id", "column_id", "value", "updated_by", "updated_at"],
    bool: ["value"],
  },
  notification_preferences: {
    columns: ["profile_id", "in_app_enabled", "email_enabled", "due_soon_hours", "categories", "created_at", "updated_at"],
    json: ["categories"],
    bool: ["in_app_enabled", "email_enabled"],
  },
  notifications: {
    id: true,
    columns: ["id", "profile_id", "kind", "priority", "title", "body", "media_url", "media_type", "entity", "entity_id", "action_url", "scheduled_for", "read_at", "dismissed_at", "created_by", "created_at"],
  },
  audit_log: {
    id: true,
    columns: ["id", "actor_id", "action", "entity", "entity_id", "before_data", "after_data", "created_at"],
    json: ["before_data", "after_data"],
  },
};

function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function can(profile: ServerProfile, field: keyof ServerProfile) {
  return profile.role === "owner" || bool(profile[field]);
}

function canReadHiddenMaterials(profile: ServerProfile) {
  return profile.role === "owner"
    || (profile.role === "admin" && (can(profile, "can_manage_materials") || can(profile, "can_manage_r2")));
}

function ensureTable(table: string) {
  const config = tableConfigs[table];
  if (!config) throw new HttpError(400, `Tabla no permitida: ${table}`);
  return config;
}

function assertColumn(table: string, column: string) {
  const config = ensureTable(table);
  if (!config.columns.includes(column)) throw new HttpError(400, `Columna no permitida: ${table}.${column}`);
}

function dbValue(table: string, column: string, value: unknown) {
  const config = ensureTable(table);
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (config.bool?.includes(column)) return bool(value) ? 1 : 0;
  if (config.json?.includes(column) && typeof value === "object") return JSON.stringify(value);
  return value;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function columnExpr(table: string, column: string, useAlias: boolean) {
  assertColumn(table, column);
  if (useAlias && table === "tasks") return `t.${quoteIdentifier(column)}`;
  if (useAlias && table === "materials") return `m.${quoteIdentifier(column)}`;
  return quoteIdentifier(column);
}

function buildWhere(table: string, filters: DataFilter[] = [], values: unknown[] = [], useAlias = false) {
  const clauses: string[] = [];
  for (const filter of filters) {
    assertColumn(table, filter.column);
    const column = columnExpr(table, filter.column, useAlias);
    if (filter.op === "eq") {
      clauses.push(`${column} = ?`);
      values.push(dbValue(table, filter.column, filter.value));
    } else if (filter.op === "is") {
      clauses.push(`${column} IS NULL`);
    } else if (filter.op === "not" && filter.operator === "is") {
      clauses.push(`${column} IS NOT NULL`);
    } else if (filter.op === "in") {
      if (!filter.value.length) {
        clauses.push("1 = 0");
      } else {
        clauses.push(`${column} IN (${filter.value.map(() => "?").join(",")})`);
        values.push(...filter.value.map((item) => dbValue(table, filter.column, item)));
      }
    } else if (filter.op === "lte") {
      clauses.push(`${column} <= ?`);
      values.push(dbValue(table, filter.column, filter.value));
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
}

function buildOrder(table: string, order: DataOrder[] = []) {
  if (!order.length) return "";
  return ` ORDER BY ${order.map((item) => {
    assertColumn(table, item.column);
    return `${columnExpr(table, item.column, table === "tasks" || table === "materials")} ${item.ascending ? "ASC" : "DESC"}`;
  }).join(", ")}`;
}

function buildLimit(limit: number | undefined) {
  return limit ? ` LIMIT ${Math.max(1, Math.min(limit, 1000))}` : "";
}

function requestedTopLevelColumns(table: string, select: string | undefined) {
  const source = select?.trim();
  if (!source || source === "*") return null;
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) { if (current.trim()) tokens.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) tokens.push(current.trim());
  if (tokens.includes("*")) return null;
  return tokens.map((token) => token.includes("(") ? token.slice(0, token.indexOf("(")).trim() : token).filter(Boolean).map((column) => { assertColumn(table, column); return column; });
}

function buildSelectClause(table: string, select: string | undefined) {
  const columns = requestedTopLevelColumns(table, select);
  return columns?.length ? columns.map(quoteIdentifier).join(", ") : "*";
}

function projectRows(rows: Array<Record<string, unknown>>, select: string | undefined) {
  const source = select?.trim();
  if (!source || source.includes("*")) return rows;
  const keys: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) { if (current.trim()) keys.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) keys.push(current.trim());
  const top = keys.map((token) => token.includes("(") ? token.slice(0, token.indexOf("(")).trim() : token).filter(Boolean);
  return rows.map((row) => Object.fromEntries(top.filter((key) => key in row).map((key) => [key, row[key]])));
}

export async function d1All<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
  const db = await getD1();
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

export async function d1First<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
  const db = await getD1();
  return db.prepare(sql).bind(...values).first<T>();
}

export async function d1Run(sql: string, values: unknown[] = []) {
  const db = await getD1();
  return db.prepare(sql).bind(...values).run();
}

function decodeJsonFields(table: string, row: Record<string, unknown>) {
  const config = ensureTable(table);
  const next = { ...row };
  for (const column of config.json ?? []) {
    const value = next[column];
    if (typeof value !== "string") continue;
    try {
      next[column] = JSON.parse(value) as unknown;
    } catch {
      next[column] = value;
    }
  }
  return next;
}

function serializeMaterialForClient(row: Record<string, unknown>) {
  if (!row.r2_key || !row.id) return row;
  const id = encodeURIComponent(String(row.id));
  const previewUrl = `/api/materials/${id}/file?mode=preview`;
  const downloadUrl = `/api/materials/${id}/file?mode=download`;
  return {
    ...row,
    r2_key: "protected",
    public_url: downloadUrl,
    preview_url: previewUrl,
    source_url: downloadUrl,
    download_url: downloadUrl,
  };
}

async function attachTaskMaterials(tasks: Array<Record<string, unknown>>, visibleOnly: boolean) {
  const ids = tasks.map((row) => String(row.id));
  if (!ids.length) return tasks;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await d1All<Record<string, unknown>>(
    `SELECT tm.task_id, m.*, ms.id AS section_join_id, ms.name AS section_name, ms.path AS section_path, ms.color AS section_color
     FROM task_materials tm
     JOIN materials m ON m.id = tm.material_id
     LEFT JOIN material_sections ms ON ms.id = m.section_id
     WHERE tm.task_id IN (${placeholders})
       ${visibleOnly ? "AND m.visibility = 'visible'" : ""}
     ORDER BY m.title ASC`,
    ids,
  );
  const byTask = new Map<string, Array<{ materials: Record<string, unknown> }>>();
  for (const row of rows) {
    const taskId = String(row.task_id);
    const material = serializeMaterialForClient(decodeJsonFields("materials", {
      ...row,
      section: row.section_join_id ? {
        id: row.section_join_id,
        name: row.section_name,
        path: row.section_path,
        color: row.section_color,
      } : null,
    }));
    byTask.set(taskId, [...(byTask.get(taskId) ?? []), { materials: material }]);
  }
  return tasks.map((task) => ({ ...task, task_materials: byTask.get(String(task.id)) ?? [] }));
}

async function selectTasks(query: DataQuery, profile: ServerProfile) {
  const values: unknown[] = [];
  const where = buildWhere("tasks", query.filters, values, true);
  const rows = await d1All<Record<string, unknown>>(
    `SELECT t.*,
      c.id AS course_join_id, c.name AS course_name, c.color AS course_color, c.card_size AS course_card_size,
      tt.id AS task_type_join_id, tt.name AS task_type_name, tt.color AS task_type_color, tt.card_size AS task_type_card_size
     FROM tasks t
     LEFT JOIN courses c ON c.id = t.course_id
     LEFT JOIN task_types tt ON tt.id = t.task_type_id
     ${where}${buildOrder("tasks", query.order)}${buildLimit(query.limit)}`,
    values,
  );
  const nested = rows.map((row) => decodeJsonFields("tasks", {
    ...row,
    courses: row.course_join_id ? {
      id: row.course_join_id,
      name: row.course_name,
      color: row.course_color,
      card_size: row.course_card_size,
    } : null,
    task_types: row.task_type_join_id ? {
      id: row.task_type_join_id,
      name: row.task_type_name,
      color: row.task_type_color,
      card_size: row.task_type_card_size,
    } : null,
  }));
  return attachTaskMaterials(nested, !canReadHiddenMaterials(profile));
}

async function selectMaterials(query: DataQuery) {
  const values: unknown[] = [];
  const where = buildWhere("materials", query.filters, values, true);
  const rows = await d1All<Record<string, unknown>>(
    `SELECT m.*, ms.id AS section_join_id, ms.name AS section_name, ms.path AS section_path,
      ms.color AS section_color, ms.icon AS section_icon, ms.card_size AS section_card_size,
      ms.preview_style AS section_preview_style, ms.sort_order AS section_sort_order
     FROM materials m
     LEFT JOIN material_sections ms ON ms.id = m.section_id
     ${where}${buildOrder("materials", query.order)}${buildLimit(query.limit)}`,
    values,
  );
  return rows.map((row) => serializeMaterialForClient(decodeJsonFields("materials", {
    ...row,
    material_sections: row.section_join_id ? {
      id: row.section_join_id,
      name: row.section_name,
      path: row.section_path,
      color: row.section_color,
      icon: row.section_icon,
      card_size: row.section_card_size,
      preview_style: row.section_preview_style,
      sort_order: row.section_sort_order,
    } : null,
  })));
}

async function selectGeneric(table: string, query: DataQuery) {
  const values: unknown[] = [];
  const rows = await d1All<Record<string, unknown>>(
    `SELECT ${buildSelectClause(table, query.select)} FROM ${quoteIdentifier(table)}${buildWhere(table, query.filters, values)}${buildOrder(table, query.order)}${buildLimit(query.limit)}`,
    values,
  );
  return rows.map((row) => decodeJsonFields(table, row));
}

async function countRows(table: string, filters: DataFilter[] = []) {
  const values: unknown[] = [];
  const row = await d1First<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}${buildWhere(table, filters, values)}`,
    values,
  );
  return Number(row?.count ?? 0);
}

function hasOwnProfileFilter(query: DataQuery, profile: ServerProfile) {
  return (query.filters ?? []).some((filter) => filter.op === "eq" && filter.column === "email" && String(filter.value).toLowerCase() === profile.email.toLowerCase()) ||
    (query.filters ?? []).some((filter) => filter.op === "eq" && filter.column === "id" && String(filter.value) === profile.id);
}

function hasOwnProfileIdFilter(query: DataQuery, profile: ServerProfile) {
  return (query.filters ?? []).some((filter) => filter.op === "eq" && filter.column === "profile_id" && String(filter.value) === profile.id);
}

const GROUP_PROFILE_COLUMNS = new Set(["id", "control_number", "email", "full_name", "role", "active"]);

function ensureSelectAllowed(table: string, query: DataQuery, profile: ServerProfile) {
  if (table === "audit_log") {
    if (profile.role === "owner" || can(profile, "can_view_reports")) return;
    throw new HttpError(403, "No autorizado.");
  }
  if (table === "notifications") {
    if (profile.role === "owner" || can(profile, "can_manage_notifications")) return;
    throw new HttpError(403, "Usa el endpoint personal de notificaciones.");
  }
  if (table === "notification_preferences") {
    if (hasOwnProfileIdFilter(query, profile) || profile.role === "owner" || can(profile, "can_manage_notifications")) return;
    throw new HttpError(403, "No autorizado.");
  }
  if (table === "group_column_values") {
    if (profile.role === "owner" || can(profile, "can_manage_group")) return;
    throw new HttpError(403, "No autorizado.");
  }
  if (table !== "app_profiles") return;
  const ownProfile = hasOwnProfileFilter(query, profile);
  if (ownProfile) return;
  if (profile.role === "owner" || can(profile, "can_manage_users")) return;
  if (can(profile, "can_manage_group")) {
    const requested = requestedTopLevelColumns(table, query.select);
    if (!requested || requested.some((column) => !GROUP_PROFILE_COLUMNS.has(column))) throw new HttpError(403, "La lista de grupo sólo puede consultar datos básicos del perfil.");
    return;
  }
  throw new HttpError(403, "No autorizado.");
}

function scopeSelectQuery(table: string, query: DataQuery, profile: ServerProfile): DataQuery {
  const filters = [...(query.filters ?? [])];
  if (profile.role === "student" && table === "tasks") {
    filters.push({ op: "eq", column: "visible_to_students", value: true });
  }
  if (!canReadHiddenMaterials(profile) && table === "materials") {
    filters.push({ op: "eq", column: "visibility", value: "visible" });
  }
  if (filters.length === (query.filters ?? []).length) return query;
  return { ...query, filters };
}

function ensureMutationAllowed(table: string, query: DataQuery, profile: ServerProfile) {
  if (table === "tasks" || table === "task_materials") {
    if (!can(profile, "can_edit_tasks")) throw new HttpError(403, "No autorizado.");
    return;
  }
  if (table === "courses") {
    if (!can(profile, "can_manage_settings")) throw new HttpError(403, "No autorizado.");
    return;
  }
  if (table === "material_sections" || table === "materials") {
    if (!can(profile, "can_manage_materials") && !can(profile, "can_manage_r2")) throw new HttpError(403, "No autorizado.");
    return;
  }
  if (table === "group_columns" || table === "group_column_values") {
    if (!can(profile, "can_manage_group")) throw new HttpError(403, "No autorizado.");
    return;
  }
  if (table === "app_profiles") {
    const rows = Array.isArray(query.values) ? query.values : query.values ? [query.values] : [];
    const values = rows[0];
    const onlyOwnPreferences = query.action === "update" &&
      (query.filters ?? []).some((filter) => filter.op === "eq" && filter.column === "id" && filter.value === profile.id) &&
      values &&
      Object.keys(values).every((key) => key === "preferences" || key === "updated_at");
    if (onlyOwnPreferences) return;

    if (profile.role === "owner") return;
    throw new HttpError(403, "Las mutaciones administrativas de perfiles deben usar la API protegida de usuarios.");
  }
  throw new HttpError(403, "No autorizado.");
}

function mutationRows(table: string, values: DataQuery["values"]) {
  const rawRows = Array.isArray(values) ? values : values ? [values] : [];
  return rawRows.map((row) => {
    const config = ensureTable(table);
    const next: Record<string, unknown> = {};
    if (config.id && !row.id) next.id = crypto.randomUUID();
    for (const [column, value] of Object.entries(row)) {
      assertColumn(table, column);
      const converted = dbValue(table, column, value);
      if (converted !== undefined) next[column] = converted;
    }
    return next;
  });
}

async function insertRows(table: string, query: DataQuery) {
  const rows = mutationRows(table, query.values);
  if (!rows.length) return [];
  for (const row of rows) {
    const columns = Object.keys(row);
    await d1Run(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      columns.map((column) => row[column]),
    );
  }
  return rows;
}

async function updateRows(table: string, query: DataQuery) {
  const row = mutationRows(table, Array.isArray(query.values) ? query.values[0] : query.values)[0];
  if (!row) return [];
  const values: unknown[] = [];
  const setColumns = Object.keys(row).filter((column) => column !== "id");
  if (!setColumns.length) return [];
  values.push(...setColumns.map((column) => row[column]));
  const where = buildWhere(table, query.filters, values);
  if (!where) throw new HttpError(400, "Actualización sin filtro rechazada.");
  await d1Run(
    `UPDATE ${quoteIdentifier(table)} SET ${setColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(", ")}${where}`,
    values,
  );
  return selectGeneric(table, { ...query, action: "select" });
}

async function deleteRows(table: string, query: DataQuery) {
  const values: unknown[] = [];
  const where = buildWhere(table, query.filters, values);
  if (!where) throw new HttpError(400, "Borrado sin filtro rechazado.");
  await d1Run(`DELETE FROM ${quoteIdentifier(table)}${where}`, values);
  return [];
}

async function upsertRows(table: string, query: DataQuery) {
  const rows = mutationRows(table, query.values);
  if (!rows.length) return [];
  const conflictColumns = (query.onConflict ?? "id").split(",").map((column) => column.trim()).filter(Boolean);
  conflictColumns.forEach((column) => assertColumn(table, column));
  for (const row of rows) {
    const columns = Object.keys(row);
    const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
    await d1Run(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})
       ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(",")}) DO UPDATE SET ${updateColumns.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(", ")}`,
      columns.map((column) => row[column]),
    );
  }
  return rows;
}

async function shapeMutationResult(table: string, query: DataQuery, fallbackRows: Array<Record<string, unknown>>, profile: ServerProfile) {
  const id = fallbackRows[0]?.id;
  if (id) {
    const filters: DataFilter[] = [{ op: "eq", column: "id", value: id }];
    if (table === "tasks") return selectTasks({ table, action: "select", filters, limit: 1 }, profile);
    if (table === "materials") return selectMaterials({ table, action: "select", filters, limit: 1 });
    return selectGeneric(table, { table, action: "select", filters, limit: 1 });
  }
  if (table === "task_materials" || table === "group_column_values") return fallbackRows;
  return fallbackRows.map((row) => decodeJsonFields(table, row));
}

function normalizeResult(rows: unknown[], query: DataQuery, count?: number | null): QueryResult {
  const data = query.single || query.maybeSingle ? (rows[0] ?? null) : rows;
  return { data, error: null, count };
}

export async function executeDataQuery(request: Request, query: DataQuery): Promise<QueryResult> {
  const profile = await requireProfile(request);
  const table = query.table;
  ensureTable(table);

  if (query.action === "select") {
    ensureSelectAllowed(table, query, profile);
    const scopedQuery = scopeSelectQuery(table, query, profile);
    const count = query.count === "exact" ? await countRows(table, scopedQuery.filters) : null;
    if (query.head) return { data: null, error: null, count };
    const rows = table === "tasks"
      ? await selectTasks(scopedQuery, profile)
      : table === "materials"
        ? await selectMaterials(scopedQuery)
        : await selectGeneric(table, scopedQuery);
    return normalizeResult(projectRows(rows, scopedQuery.select), query, count);
  }

  ensureMutationAllowed(table, query, profile);
  let changed: Array<Record<string, unknown>>;
  if (query.action === "insert") changed = await insertRows(table, query);
  else if (query.action === "update") changed = await updateRows(table, query);
  else if (query.action === "delete") changed = await deleteRows(table, query);
  else changed = await upsertRows(table, query);

  const shaped = await shapeMutationResult(table, query, changed, profile);
  return normalizeResult(shaped, query);
}

export async function executeRpc(request: Request, name: string, args: Record<string, unknown>) {
  const profile = await requireProfile(request);
  if (name !== "update_my_preferences") throw new HttpError(400, `RPC no permitido: ${name}`);
  const preferences = args.preferences_input;
  await d1Run("UPDATE app_profiles SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    JSON.stringify(preferences ?? {}),
    profile.id,
  ]);
  return { data: preferences, error: null };
}

export async function withDataErrors(action: () => Promise<unknown>) {
  try {
    return Response.json(await action());
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Error inesperado." }, { status: 500 });
  }
}
