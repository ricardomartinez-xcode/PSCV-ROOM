import https from "node:https";

const env = process.env;
const token = env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");

const OLD_ACCOUNT = "41ffa6a1a7c184fd4308f87780a62cc4";
const OLD_DB = "49c23a1e-de2c-473b-a627-d6efe862b4b3";
const NEW_ACCOUNT = "e8cee5957315e28c1b4e4b2410c5fbcc";
const NEW_DB = "14ed5055-3366-4883-a6df-0349874337f0";

function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode < 200 || res.statusCode >= 300 || !parsed.success) {
            reject(new Error(JSON.stringify(parsed.errors ?? parsed)));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function query(account, db, sql, params = []) {
  const out = await requestJson(
    "POST",
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,
    { sql, params },
  );
  const result = out.result?.[0];
  if (!result?.success) throw new Error(result?.error || "D1 query failed");
  return result.results ?? [];
}

const oldProfiles = await query(OLD_ACCOUNT, OLD_DB, "SELECT id,email,control_number FROM app_profiles");
const newProfiles = await query(NEW_ACCOUNT, NEW_DB, "SELECT id,email,control_number FROM app_profiles");
const newByEmail = new Map(newProfiles.filter(r => r.email).map(r => [String(r.email).trim().toLowerCase(), r.id]));
const newByControl = new Map(newProfiles.filter(r => r.control_number).map(r => [String(r.control_number).trim(), r.id]));
const profileMap = new Map();
for (const row of oldProfiles) {
  const email = String(row.email ?? "").trim().toLowerCase();
  const control = String(row.control_number ?? "").trim();
  const target = (email && newByEmail.get(email)) || (control && newByControl.get(control));
  if (target) profileMap.set(row.id, target);
}

const oldCourses = await query(OLD_ACCOUNT, OLD_DB, "SELECT id,name FROM courses");
const newCourses = await query(NEW_ACCOUNT, NEW_DB, "SELECT id,name FROM courses");
const newCourseById = new Map(newCourses.map(r => [r.id, r.id]));
const newCourseByName = new Map(newCourses.map(r => [String(r.name ?? "").trim().toLowerCase(), r.id]));
const courseMap = new Map();
for (const row of oldCourses) {
  const target = newCourseById.get(row.id) || newCourseByName.get(String(row.name ?? "").trim().toLowerCase());
  if (!target) throw new Error("Missing target course mapping");
  courseMap.set(row.id, target);
}

const oldTypes = await query(OLD_ACCOUNT, OLD_DB, "SELECT id,name FROM task_types");
const newTypes = await query(NEW_ACCOUNT, NEW_DB, "SELECT id,name FROM task_types");
const newTypeById = new Map(newTypes.map(r => [r.id, r.id]));
const newTypeByName = new Map(newTypes.map(r => [String(r.name ?? "").trim().toLowerCase(), r.id]));
const typeMap = new Map();
for (const row of oldTypes) {
  const target = newTypeById.get(row.id) || newTypeByName.get(String(row.name ?? "").trim().toLowerCase());
  if (!target) throw new Error("Missing target task type mapping");
  typeMap.set(row.id, target);
}

const cols = (await query(OLD_ACCOUNT, OLD_DB, "PRAGMA table_info(tasks)")).map(r => r.name);
const newCols = (await query(NEW_ACCOUNT, NEW_DB, "PRAGMA table_info(tasks)")).map(r => r.name);
if (JSON.stringify(cols) !== JSON.stringify(newCols)) throw new Error("Task schemas do not match");

const oldTasks = await query(OLD_ACCOUNT, OLD_DB, `SELECT ${cols.join(",")} FROM tasks ORDER BY id`);
const existing = new Set((await query(NEW_ACCOUNT, NEW_DB, "SELECT id FROM tasks")).map(r => r.id));

for (const source of oldTasks) {
  const row = { ...source };
  if (row.course_id) row.course_id = courseMap.get(row.course_id);
  if (row.task_type_id) row.task_type_id = typeMap.get(row.task_type_id);
  for (const key of ["created_by", "updated_by"]) {
    if (row[key]) row[key] = profileMap.get(row[key]) ?? null;
  }
  if (existing.has(row.id)) {
    const setCols = cols.filter(c => c !== "id");
    await query(NEW_ACCOUNT, NEW_DB,
      `UPDATE tasks SET ${setCols.map(c => `${c}=?`).join(",")} WHERE id=?`,
      [...setCols.map(c => row[c]), row.id]);
  } else {
    await query(NEW_ACCOUNT, NEW_DB,
      `INSERT INTO tasks (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      cols.map(c => row[c]));
  }
}

let verified = 0;
for (const source of oldTasks) {
  const expected = { ...source };
  if (expected.course_id) expected.course_id = courseMap.get(expected.course_id);
  if (expected.task_type_id) expected.task_type_id = typeMap.get(expected.task_type_id);
  for (const key of ["created_by", "updated_by"]) {
    if (expected[key]) expected[key] = profileMap.get(expected[key]) ?? null;
  }
  const got = await query(NEW_ACCOUNT, NEW_DB, `SELECT ${cols.join(",")} FROM tasks WHERE id=?`, [source.id]);
  if (got.length !== 1) throw new Error("Missing migrated task");
  const mismatches = cols.filter(c => got[0][c] !== expected[c]);
  if (mismatches.length) throw new Error(`Task verification mismatch: ${mismatches.join(",")}`);
  verified++;
}

const counts = await query(NEW_ACCOUNT, NEW_DB, "SELECT item_kind,COUNT(*) n FROM tasks GROUP BY item_kind ORDER BY item_kind");
const kinds = Object.fromEntries(counts.map(r => [r.item_kind, r.n]));
const sourceLinks = (await query(OLD_ACCOUNT, OLD_DB, "SELECT COUNT(*) n FROM task_materials"))[0].n;
const targetMaterials = (await query(NEW_ACCOUNT, NEW_DB, "SELECT COUNT(*) n FROM materials"))[0].n;
const targetLinks = (await query(NEW_ACCOUNT, NEW_DB, "SELECT COUNT(*) n FROM task_materials"))[0].n;

const summary = {
  source_tasks: oldTasks.length,
  verified,
  target_by_kind: counts,
  source_task_material_links: sourceLinks,
  target_materials: targetMaterials,
  target_task_material_links: targetLinks,
  material_links_deferred: targetMaterials === 0 ? sourceLinks : 0,
};
console.log(JSON.stringify(summary, null, 2));

if (verified !== 50 || kinds.task !== 37 || kinds.event !== 13) {
  throw new Error("Task/event totals do not match source");
}
