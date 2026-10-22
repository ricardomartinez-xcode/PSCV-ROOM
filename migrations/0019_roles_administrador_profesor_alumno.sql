-- Rol de experiencia de usuario canónico: administrador / profesor / alumno.
-- La columna histórica app_profiles.role sigue siendo el control interno de
-- compatibilidad ('owner','admin','student') y conserva el owner canónico.
-- Evita reconstruir app_profiles, referenciada por varias llaves foráneas en D1.
ALTER TABLE app_profiles ADD COLUMN profile_role TEXT NOT NULL DEFAULT 'student'
  CHECK (profile_role IN ('administrator','professor','student'));

UPDATE app_profiles
   SET profile_role = CASE
     WHEN role IN ('owner','admin') THEN 'administrator'
     ELSE 'student'
   END;

CREATE INDEX IF NOT EXISTS idx_profiles_profile_role ON app_profiles(profile_role,active);
CREATE INDEX IF NOT EXISTS idx_courses_professor_email ON courses(professor_email);
