-- Nuevo dominio aislado. No cambia permisos ni registros históricos existentes.
-- Toda marca temporal en UTC ISO-8601. Intervalos [inicio, fin).
CREATE TABLE IF NOT EXISTS permanence_patterns (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_local TEXT NOT NULL,
  ends_local TEXT NOT NULL,
  break_mode TEXT NOT NULL DEFAULT 'variable'
    CHECK (break_mode IN ('fixed','variable','mixed','none')),
  fixed_breaks_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id,weekday,starts_local,ends_local)
);

CREATE TABLE IF NOT EXISTS permanence_sessions (
  id TEXT PRIMARY KEY,
  pattern_id TEXT REFERENCES permanence_patterns(id) ON DELETE SET NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  scheduled_start_at TEXT NOT NULL,
  scheduled_end_at TEXT NOT NULL,
  actual_end_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  notes TEXT,
  created_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  closed_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (scheduled_end_at > scheduled_start_at),
  UNIQUE(course_id,scheduled_start_at)
);

CREATE TABLE IF NOT EXISTS permanence_breaks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES permanence_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','variable')),
  start_at TEXT NOT NULL,
  end_at TEXT,
  recorded_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at IS NULL OR end_at > start_at)
);

CREATE TABLE IF NOT EXISTS permanence_presence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES permanence_sessions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES app_profiles(id) ON DELETE RESTRICT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  recorded_by TEXT REFERENCES app_profiles(id) ON DELETE SET NULL,
  observation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at IS NULL OR end_at > start_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permanence_open_presence
  ON permanence_presence(session_id,profile_id) WHERE end_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_permanence_open_variable_break
  ON permanence_breaks(session_id) WHERE end_at IS NULL AND kind = 'variable';
CREATE INDEX IF NOT EXISTS idx_permanence_sessions_course
  ON permanence_sessions(course_id,scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_permanence_breaks_session
  ON permanence_breaks(session_id,start_at);
CREATE INDEX IF NOT EXISTS idx_permanence_presence_session
  ON permanence_presence(session_id,profile_id,start_at);
