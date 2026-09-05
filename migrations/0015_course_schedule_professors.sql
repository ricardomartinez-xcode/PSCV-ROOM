-- Horario y profesores por materia.
ALTER TABLE courses ADD COLUMN professor_name TEXT;
ALTER TABLE courses ADD COLUMN professor_email TEXT;
ALTER TABLE courses ADD COLUMN schedule_text TEXT NOT NULL DEFAULT '';
