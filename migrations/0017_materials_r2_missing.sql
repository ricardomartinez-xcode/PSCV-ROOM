-- Preserve index records and task links while tracking objects removed from R2.
ALTER TABLE materials ADD COLUMN r2_missing_at TEXT;
CREATE INDEX IF NOT EXISTS idx_materials_r2_missing ON materials(provider, r2_missing_at);

DROP VIEW IF EXISTS report_material_summary;
CREATE VIEW report_material_summary AS
SELECT
  COALESCE(ms.path, 'Sin sección') AS section_path,
  COALESCE(m.provider, 'r2') AS provider,
  COUNT(*) AS total,
  COALESCE(SUM(m.size_bytes), 0) AS total_bytes,
  MAX(m.updated_at) AS last_updated_at
FROM materials m
LEFT JOIN material_sections ms ON ms.id = m.section_id
WHERE m.visibility = 'visible' AND m.r2_missing_at IS NULL
GROUP BY COALESCE(ms.path, 'Sin sección'), COALESCE(m.provider, 'r2');
