"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Eye, FileText, FolderOpen, LayoutGrid, List, Search } from "lucide-react";
import { seedMaterials } from "@/lib/seed";
import { hasD1BrowserConfig } from "@/lib/d1/client";
import { materialDisplayName } from "@/lib/material-display-name";

type PreviewSize = "small" | "medium" | "large";

type LibrarySection = {
  id: string;
  name: string;
  path: string;
  color: string | null;
  icon: string | null;
  card_size: string | null;
  preview_style: string | null;
  sort_order: number | null;
  material_count: number;
};

type LibraryMaterial = {
  id: string;
  title: string;
  material_type: string | null;
  provider: string | null;
  source_url: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  public_url: string | null;
  r2_key: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  section_id: string | null;
  section: LibrarySection | null;
};

type LibraryResponse = {
  ok: boolean;
  sections: LibrarySection[];
  materials: LibraryMaterial[];
  error?: string;
};

type MaterialLibraryProps = {
  previewSize: PreviewSize;
  globalQuery?: string;
};

type SectionGroup = {
  section: LibrarySection;
  materials: LibraryMaterial[];
};

type LibraryCategory = {
  id: string;
  name: string;
  material_count: number;
};

const ALL_SECTIONS = "all";
const SECTION_PREVIEW_LIMIT = 4;
const hasD1Config = hasD1BrowserConfig();

export function MaterialLibrary({ previewSize, globalQuery = "" }: MaterialLibraryProps) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [query, setQuery] = useState(globalQuery);
  const [categoryId, setCategoryId] = useState(ALL_SECTIONS);
  const [sectionId, setSectionId] = useState(ALL_SECTIONS);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setQuery(globalQuery), [globalQuery]);

  const loadLibrary = useCallback(async (signal: AbortSignal) => {
    if (!hasD1Config) {
      setData(buildDemoLibrary(query));
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "400" });
      if (query.trim()) params.set("q", query.trim());

      const response = await fetch(`/api/materials/library?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      const body = (await response.json()) as LibraryResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "No se pudo cargar la biblioteca.");
      }

      setData(body);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la biblioteca.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadLibrary(controller.signal), 220);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [loadLibrary]);

  const sections = useMemo(() => normalizeSections(data?.sections ?? []), [data]);
  const categories = useMemo(() => buildCategories(data?.materials ?? []), [data]);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) ?? null,
    [categoryId, categories],
  );
  const categorySections = useMemo(
    () => categoryId === ALL_SECTIONS ? sections : sections.filter((section) => categoryKey(section) === categoryId),
    [categoryId, sections],
  );
  const selectedSection = useMemo(
    () => sections.find((section) => section.id === sectionId) ?? null,
    [sectionId, sections],
  );

  const materials = useMemo(() => {
    let rows = data?.materials ?? [];
    if (categoryId !== ALL_SECTIONS) rows = rows.filter((material) => categoryKey(material.section) === categoryId);
    if (sectionId !== ALL_SECTIONS) rows = rows.filter((material) => sectionKey(material.section) === sectionId);
    return rows;
  }, [categoryId, data, sectionId]);

  const sectionGroups = useMemo(() => {
    const byKey = new Map<string, SectionGroup>();
    const fallback: LibrarySection = {
      id: "section:otros",
      name: "Otros materiales",
      path: "Sin clasificación",
      color: "#64748b",
      icon: null,
      card_size: null,
      preview_style: null,
      sort_order: Number.MAX_SAFE_INTEGER,
      material_count: 0,
    };

    for (const material of materials) {
      const section = material.section ? normalizeSection(material.section) : fallback;
      const key = section.id;
      const group = byKey.get(key) ?? { section, materials: [] };
      group.materials.push(material);
      byKey.set(key, group);
    }

    return Array.from(byKey.values()).sort(
      (a, b) => (a.section.sort_order ?? 0) - (b.section.sort_order ?? 0) || a.section.name.localeCompare(b.section.name, "es"),
    );
  }, [materials]);

  const browsingRoot = categoryId === ALL_SECTIONS && sectionId === ALL_SECTIONS && !query.trim();
  const shouldGroup = !browsingRoot && sectionId === ALL_SECTIONS && !query.trim() && sectionGroups.length > 1;

  function openSection(id: string) {
    setSectionId(id);
    window.requestAnimationFrame(() => {
      document.querySelector(".materialLibraryResults")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className={`libraryShell preview-${previewSize}`}>
      <section className="libraryHero">
        <div>
          <p className="eyebrow">Biblioteca de recursos</p>
          <h2>{selectedSection?.name ?? selectedCategory?.name ?? "Biblioteca académica"}</h2>
          <p>
            {selectedSection
              ? selectedSection.path
              : selectedCategory
                ? `Explora las áreas y tipos de recurso dentro de ${selectedCategory.name}.`
                : "Explora por Materias, Biblioteca e Instrumentos psicológicos según el contenido real de cada documento."}
          </p>
        </div>
        <div className="libraryStats" aria-label={`${materials.length} recursos disponibles`}>
          <strong>{materials.length}</strong>
          <span>recursos</span>
        </div>
      </section>

      <section className="libraryToolbar" aria-label="Controles de biblioteca">
        <label className="librarySearch">
          <Search size={16} aria-hidden="true" />
          <span className="srOnly">Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, área o archivo"
          />
        </label>

        <div
          className="libraryFilterGroup"
          style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, minWidth: 0 }}
        >
          <label className="libraryFilter">
            <span>Colección</span>
            <select
              value={categoryId}
              onChange={(event) => { setCategoryId(event.target.value); setSectionId(ALL_SECTIONS); }}
              style={{ width: "100%", minWidth: 0 }}
            >
              <option value={ALL_SECTIONS}>Todas las colecciones</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name} ({category.material_count})</option>
              ))}
            </select>
          </label>

          <label className="libraryFilter">
            <span>Área</span>
            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              style={{ width: "100%", minWidth: 0 }}
            >
              <option value={ALL_SECTIONS}>Todas las áreas</option>
              {categorySections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name} ({section.material_count})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="libraryViewToggle" aria-label="Vista">
          <button
            className={view === "grid" ? "active" : ""}
            aria-label="Vista de tarjetas"
            title="Vista de tarjetas"
            type="button"
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className={view === "list" ? "active" : ""}
            aria-label="Vista de lista"
            title="Vista de lista"
            type="button"
            onClick={() => setView("list")}
          >
            <List size={16} />
          </button>
        </div>
      </section>

      {!query.trim() ? (
        <nav className="sectionRail" aria-label="Colecciones principales">
          {categories.map((category) => (
            <button key={category.id} type="button" className="sectionCard"
              onClick={() => { setCategoryId(category.id); setSectionId(ALL_SECTIONS); }}
              style={{ "--section-color": categoryColor(category.name) } as React.CSSProperties}>
              <span className="sectionIcon"><FolderOpen size={16} /></span>
              <span><strong>{category.name}</strong><small>{category.material_count} recursos</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </nav>
      ) : null}

      {categoryId !== ALL_SECTIONS && sectionId === ALL_SECTIONS && !query.trim() ? (
        <nav className="sectionRail" aria-label="Áreas disponibles">
          {categorySections.map((section) => (
            <button key={section.id} type="button" className="sectionCard" onClick={() => openSection(section.id)}
              style={{ "--section-color": section.color ?? "#2563eb" } as React.CSSProperties}>
              <span className="sectionIcon"><FolderOpen size={16} /></span>
              <span><strong>{section.name}</strong><small>{section.material_count} recursos</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </nav>
      ) : null}

      <section className="materialLibraryResults" aria-live="polite">
        {loading ? <LibrarySkeleton /> : null}
        {error ? <div className="systemBanner">{error}</div> : null}

        {!loading && !error && browsingRoot ? (
          <section className="emptyLibrary">
            <strong>Elige una colección para comenzar</strong>
            <p>Los materiales están organizados por materia, área académica e instrumentos psicológicos.</p>
          </section>
        ) : null}

        {!loading && !error && !browsingRoot && materials.length === 0 ? (
          <section className="emptyLibrary">
            <strong>No encontramos recursos</strong>
            <p>Prueba con otra palabra o vuelve a todas las áreas.</p>
            {sectionId !== ALL_SECTIONS ? (
              <button type="button" onClick={() => setSectionId(ALL_SECTIONS)}>Ver todas las áreas</button>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && !browsingRoot && materials.length > 0 && shouldGroup ? (
          <div className="librarySectionStack">
            {sectionGroups.map((group) => (
              <section className="librarySectionGroup" key={group.section.id}>
                <header className="librarySectionHeading">
                  <div>
                    <span className="sectionHeadingMark" style={{ background: group.section.color ?? "#2563eb" }} />
                    <div>
                      <p>{group.section.path}</p>
                      <h3>{group.section.name}</h3>
                    </div>
                  </div>
                  <button className="sectionGroupMore" type="button" onClick={() => openSection(group.section.id)}>
                    Ver todos <span>{group.materials.length}</span><ChevronRight size={15} />
                  </button>
                </header>
                <div className={view === "grid" ? "materialGrid compact" : "materialListV2"}>
                  {group.materials.slice(0, SECTION_PREVIEW_LIMIT).map((material) => (
                    <MaterialCard key={material.id} material={material} view={view} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {!loading && !error && !browsingRoot && materials.length > 0 && !shouldGroup ? (
          <div className={view === "grid" ? "materialGrid" : "materialListV2"}>
            {materials.map((material) => <MaterialCard key={material.id} material={material} view={view} />)}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function MaterialCard({ material, view }: { material: LibraryMaterial; view: "grid" | "list" }) {
  const section = material.section ? normalizeSection(material.section) : null;
  const color = section?.color ?? "#2563eb";
  const previewUrl = material.preview_url ?? material.thumbnail_url ?? material.source_url;
  const openUrl = material.public_url ?? material.preview_url ?? material.source_url;
  const type = material.material_type ?? material.content_type?.split("/").at(-1)?.toUpperCase() ?? "PDF";
  const isPdf = (material.content_type ?? material.file_name ?? material.title).toLowerCase().includes("pdf");
  const size = formatBytes(material.size_bytes);
  const displayName = materialDisplayName(material.title);
  const displayFileName = material.file_name ? materialDisplayName(material.file_name) : "Sin clasificación";

  return (
    <article className={`materialCardV2 ${view === "list" ? "list" : ""}`} style={{ "--material-color": color } as React.CSSProperties}>
      <MaterialThumbnail material={material} previewUrl={previewUrl} isPdf={isPdf} type={type} />
      <div className="materialContent">
        <div className="materialMetaLine">
          <span>{section?.name ?? "Material"}</span>
          <span>{type.slice(0, 8)}</span>
          {size ? <span>{size}</span> : null}
        </div>
        <strong title={displayName}>{displayName}</strong>
        <small title={section?.name ?? displayFileName}>{section?.name ?? displayFileName}</small>
      </div>
      <div className="materialActions">
        {previewUrl ? (
          <a href={previewUrl} aria-label={`Previsualizar ${displayName}`} title="Previsualizar" target="_blank" rel="noreferrer">
            <Eye size={16} />
          </a>
        ) : null}
        {openUrl ? (
          <a href={openUrl} aria-label={`Abrir ${displayName}`} title="Abrir" target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function MaterialThumbnail({ material, previewUrl, isPdf, type }: { material: LibraryMaterial; previewUrl: string | null; isPdf: boolean; type: string }) {
  const imageUrl = material.thumbnail_url ?? (material.content_type?.startsWith("image/") ? previewUrl : null);

  if (imageUrl) {
    return <div className="materialThumb hasPreview"><img src={imageUrl} alt="" loading="lazy" /></div>;
  }

  return (
    <div className="materialThumb" aria-hidden="true">
      <FileText size={20} />
      <span>{isPdf ? "PDF" : type.slice(0, 4)}</span>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="materialGrid" aria-label="Cargando recursos">
      {Array.from({ length: 8 }).map((_, index) => (
        <article className="materialCardV2 skeleton" key={index}>
          <div className="materialThumb" />
          <div className="materialContent"><span /><strong /><small /></div>
        </article>
      ))}
    </div>
  );
}

function normalizeSections(sections: LibrarySection[]) {
  const grouped = new Map<string, LibrarySection>();

  for (const section of sections) {
    if (section.material_count <= 0) continue;
    const normalized = normalizeSection(section);
    const current = grouped.get(normalized.id);

    if (!current) {
      grouped.set(normalized.id, normalized);
      continue;
    }

    grouped.set(normalized.id, {
      ...current,
      material_count: current.material_count + normalized.material_count,
      path: current.path.length <= normalized.path.length ? current.path : normalized.path,
      color: current.color ?? normalized.color,
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "es"),
  );
}

function normalizeSection(section: LibrarySection): LibrarySection {
  return { ...section, id: sectionKey(section) };
}

function sectionKey(section: Pick<LibrarySection, "name" | "path"> | null) {
  if (!section) return "section:otros";
  const parts = section.path.split("/").map((part) => part.trim()).filter(Boolean);
  return `section:${slug(parts.join("/") || section.name)}`;
}


function categoryColor(name: string) {
  if (name === "Materias") return "#2563eb";
  if (name === "Biblioteca") return "#0f766e";
  if (name === "Instrumentos psicológicos") return "#7c3aed";
  return "#64748b";
}

function categoryKey(section: Pick<LibrarySection, "name" | "path"> | null) {
  if (!section) return "category:otros";
  const root = section.path.split("/").map((part) => part.trim()).filter(Boolean)[0] ?? "Otros";
  return `category:${slug(root)}`;
}

function buildCategories(materials: LibraryMaterial[]): LibraryCategory[] {
  const grouped = new Map<string, LibraryCategory>();
  for (const material of materials) {
    const name = material.section?.path.split("/").map((part) => part.trim()).filter(Boolean)[0] ?? "Otros";
    const id = `category:${slug(name)}`;
    const current = grouped.get(id) ?? { id, name, material_count: 0 };
    current.material_count += 1;
    grouped.set(id, current);
  }
  const preferred = new Map([["Materias", 0], ["Biblioteca", 1], ["Instrumentos psicológicos", 2]]);
  return Array.from(grouped.values()).sort((a, b) =>
    (preferred.get(a.name) ?? 50) - (preferred.get(b.name) ?? 50) || a.name.localeCompare(b.name, "es"),
  );
}

function buildDemoLibrary(query: string): LibraryResponse {
  const names = Array.from(new Set(seedMaterials.map((material) => material.folder ?? material.scope)));
  const sections = names.map((name, index) => ({
    id: `section:${slug(name)}`,
    name,
    path: `Psicología / Materiales de clase / ${name}`,
    color: ["#2563eb", "#0f766e", "#7c3aed", "#c2410c", "#be123c"][index % 5],
    icon: null,
    card_size: null,
    preview_style: null,
    sort_order: index,
    material_count: 0,
  } satisfies LibrarySection));
  const byName = new Map(sections.map((section) => [section.name, section]));
  const normalizedQuery = query.trim().toLowerCase();

  const materials = seedMaterials
    .map((material) => {
      const section = byName.get(material.folder ?? material.scope) ?? null;
      return {
        id: material.id,
        title: material.name,
        material_type: material.type,
        provider: "demo",
        source_url: material.url,
        preview_url: material.previewUrl ?? material.url,
        thumbnail_url: null,
        public_url: material.url,
        r2_key: section ? `${section.path}/${material.name}` : material.name,
        file_name: material.name,
        content_type: material.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : null,
        size_bytes: null,
        section_id: section?.id ?? null,
        section,
      } satisfies LibraryMaterial;
    })
    .filter((material) => !normalizedQuery || [material.title, material.r2_key, material.section?.name].some((value) => value?.toLowerCase().includes(normalizedQuery)));

  const counts = new Map<string, number>();
  for (const material of materials) {
    if (material.section) counts.set(material.section.id, (counts.get(material.section.id) ?? 0) + 1);
  }

  return {
    ok: true,
    sections: sections.map((section) => ({ ...section, material_count: counts.get(section.id) ?? 0 })),
    materials,
  };
}

function formatBytes(value: number | null) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
