export const MATERIAL_LIBRARY_SEARCH_COLUMNS = [
  "m.title",
  "m.file_name",
  "m.observations",
  "m.r2_key",
  "ms.name",
  "ms.path",
] as const;

export function buildMaterialLibrarySearch(query: string | null | undefined) {
  const normalizedQuery = query?.trim() ?? "";
  if (!normalizedQuery) return null;

  const pattern = `%${normalizedQuery.replace(/[\\%_]/g, "\\$&")}%`;

  return {
    query: normalizedQuery,
    sql: `(${MATERIAL_LIBRARY_SEARCH_COLUMNS.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
    values: MATERIAL_LIBRARY_SEARCH_COLUMNS.map(() => pattern),
  };
}
