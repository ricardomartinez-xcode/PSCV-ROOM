"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, BookOpen, ChevronRight, ExternalLink, Eye, FileText, FolderOpen, Info, LayoutGrid, List, Search, UploadCloud, X } from "lucide-react";
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
  onManage?: () => void;
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

export function MaterialLibrary({ previewSize, globalQuery = "", onManage }: MaterialLibraryProps) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [query, setQuery] = useState(globalQuery);
  const [categoryId, setCategoryId] = useState(ALL_SECTIONS);
  const [sectionId, setSectionId] = useState(ALL_SECTIONS);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [fileType, setFileType] = useState<"all" | "pdf" | "image" | "document" | "other">("all");
  const [sort, setSort] = useState<"name" | "name-desc" | "size-desc">("name");
  const [visibleCount, setVisibleCount] = useState(24);
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

  // Revalidate when the user returns to the tab, and periodically while open.
  // External changes to R2 should not require a manual page reload.
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible") void loadLibrary(controller.signal);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      controller.abort();
    };
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

  const filteredMaterials = useMemo(() => {
    const filtered = materials.filter((material) => fileType === "all" || materialFileType(material) === fileType);
    return filtered.sort((a, b) => {
      if (sort === "size-desc") {
        return (b.size_bytes ?? 0) - (a.size_bytes ?? 0) || materialDisplayName(a.title).localeCompare(materialDisplayName(b.title), "es", { sensitivity: "base" });
      }
      const order = materialDisplayName(a.title).localeCompare(materialDisplayName(b.title), "es", { sensitivity: "base" });
      return sort === "name-desc" ? -order : order;
    });
  }, [materials, fileType, sort]);

  useEffect(() => setVisibleCount(24), [query, categoryId, sectionId, fileType, sort]);

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

    for (const material of filteredMaterials) {
      const section = material.section ? normalizeSection(material.section) : fallback;
      const key = section.id;
      const group = byKey.get(key) ?? { section, materials: [] };
      group.materials.push(material);
      byKey.set(key, group);
    }

    return Array.from(byKey.values()).sort(
      (a, b) => (a.section.sort_order ?? 0) - (b.section.sort_order ?? 0) || a.section.name.localeCompare(b.section.name, "es"),
    );
  }, [filteredMaterials]);

  const browsingRoot = categoryId === ALL_SECTIONS && sectionId === ALL_SECTIONS && !query.trim();
  const shouldGroup = !browsingRoot && sectionId === ALL_SECTIONS && !query.trim() && sectionGroups.length > 1;

  function resetNavigation() {
    setQuery("");
    setCategoryId(ALL_SECTIONS);
    setSectionId(ALL_SECTIONS);
    setFileType("all");
    setVisibleCount(24);
  }

  function selectCategory(id: string) {
    setCategoryId(id);
    setSectionId(ALL_SECTIONS);
    setVisibleCount(24);
  }

  function openSection(id: string) {
    setSectionId(id);
    window.requestAnimationFrame(() => {
      document.querySelector(".materialLibraryResults")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className={`libraryShell materialsExplorer preview-${previewSize}`}>
      <nav className="libraryBreadcrumbs" aria-label="Ruta de navegación">
        <button type="button" onClick={resetNavigation} aria-current={browsingRoot ? "page" : undefined}>
          <BookOpen size={15} aria-hidden="true" /> Biblioteca
        </button>
        {selectedCategory ? (
          <><ChevronRight size={14} aria-hidden="true" />
            <button type="button" onClick={() => selectCategory(selectedCategory.id)} aria-current={sectionId === ALL_SECTIONS ? "page" : undefined}>
              {selectedCategory.name}
            </button></>
        ) : null}
        {selectedSection ? (
          <><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{selectedSection.name}</span></>
        ) : null}
      </nav>

      <section className="libraryHero">
        <div>
          <p className="eyebrow">PSCV · Recursos académicos</p>
          <h2>{selectedSection?.name ?? selectedCategory?.name ?? "Tu biblioteca, en un solo lugar"}</h2>
          <p>{selectedSection
            ? selectedSection.path
            : selectedCategory
              ? "Encuentra los documentos organizados por áreas y consulta sus detalles."
              : "Explora materiales de clase, lecturas e instrumentos psicológicos. Busca o navega por colecciones."}</p>
        </div>
        <div className="libraryHeroSide">
          {onManage ? (
            <button className="libraryManageAction" type="button" onClick={onManage}>
              <UploadCloud size={17} aria-hidden="true" /> Subir y gestionar archivos
            </button>
          ) : null}
          <div className="libraryStats" aria-label={`${filteredMaterials.length} recursos visibles`}>
            <strong>{loading ? "—" : filteredMaterials.length}</strong>
            <span>recursos</span>
          </div>
        </div>
      </section>

      <div className="libraryWorkbench">
        <aside className="libraryExplorerNav" aria-label="Explorador de colecciones">
          <p className="libraryNavCaption">COLECCIONES</p>
          <button type="button" className={`libraryNavItem ${categoryId === ALL_SECTIONS ? "active" : ""}`}
            onClick={resetNavigation} aria-current={categoryId === ALL_SECTIONS ? "page" : undefined}>
            <BookOpen size={17} aria-hidden="true" /><span>Todos los recursos</span>
            <small>{data?.materials.length ?? 0}</small>
          </button>
          {categories.map((category) => (
            <button type="button" key={category.id} className={`libraryNavItem ${categoryId === category.id ? "active" : ""}`}
              onClick={() => selectCategory(category.id)} aria-current={categoryId === category.id && sectionId === ALL_SECTIONS ? "page" : undefined}>
              <FolderOpen size={17} aria-hidden="true" /><span>{category.name}</span><small>{category.material_count}</small>
            </button>
          ))}
          {categoryId !== ALL_SECTIONS && categorySections.length > 0 ? (
            <div className="libraryNavSubsections">
              <p className="libraryNavCaption">ÁREAS</p>
              {categorySections.map((section) => (
                <button type="button" key={section.id} className={`libraryNavSubItem ${sectionId === section.id ? "active" : ""}`}
                  onClick={() => openSection(section.id)} aria-current={sectionId === section.id ? "page" : undefined}>
                  <span>{section.name}</span><small>{section.material_count}</small>
                </button>
              ))}
            </div>
          ) : null}
          <p className="libraryNavHint">Solo se muestran materiales disponibles en tu biblioteca.</p>
        </aside>

        <div className="libraryExplorerMain">
          <nav className="libraryMobileNav" aria-label="Colecciones">
            <button type="button" onClick={resetNavigation} className={categoryId === ALL_SECTIONS ? "active" : ""}>Todas</button>
            {categories.map((category) => (
              <button type="button" key={category.id} onClick={() => selectCategory(category.id)}
                className={categoryId === category.id ? "active" : ""}>{category.name}</button>
            ))}
          </nav>

          <section className="libraryToolbar" aria-label="Buscar y organizar materiales">
            <div className="librarySearchWrap">
              <label className="librarySearch">
                <Search size={18} aria-hidden="true" />
                <span className="srOnly">Buscar recursos</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar documento, materia o palabra clave…" />
              </label>
              {query ? <button className="librarySearchClear" type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}><X size={16} /></button> : null}
            </div>
            <div className="libraryFilterGroup">
              <label className="libraryFilter">
                <span>Colección</span>
                <select value={categoryId} onChange={(event) => selectCategory(event.target.value)}>
                  <option value={ALL_SECTIONS}>Todas las colecciones</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.material_count})</option>)}
                </select>
              </label>
              <label className="libraryFilter">
                <span>Área</span>
                <select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                  <option value={ALL_SECTIONS}>Todas las áreas</option>
                  {categorySections.map((section) => <option key={section.id} value={section.id}>{section.name} ({section.material_count})</option>)}
                </select>
              </label>
              <label className="libraryFilter">
                <span><ArrowUpDown size={12} aria-hidden="true" /> Ordenar</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="name">Nombre (A–Z)</option>
                  <option value="name-desc">Nombre (Z–A)</option>
                  <option value="size-desc">Mayor tamaño</option>
                </select>
              </label>
            </div>
            <div className="libraryViewToggle" role="group" aria-label="Vista de materiales">
              <button className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"}
                aria-label="Vista de tarjetas" title="Vista de tarjetas" type="button" onClick={() => setView("grid")}><LayoutGrid size={17} /></button>
              <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"}
                aria-label="Vista de lista" title="Vista de lista" type="button" onClick={() => setView("list")}><List size={17} /></button>
            </div>
          </section>

          <div className="libraryTypeFilters" role="group" aria-label="Filtrar por tipo de archivo">
            {([
              ["all", "Todos"],
              ["pdf", "PDF"],
              ["document", "Documentos"],
              ["image", "Imágenes"],
              ["other", "Otros"],
            ] as const).map(([id, label]) => (
              <button type="button" key={id} aria-pressed={fileType === id} className={fileType === id ? "active" : ""}
                onClick={() => setFileType(id)}>{label}</button>
            ))}
          </div>

          {!query.trim() && browsingRoot ? (
            <section className="libraryCollections" aria-label="Explorar por colección">
              <div className="librarySectionTitle"><h3>Explorar colecciones</h3><span>Elige una colección para comenzar</span></div>
              <nav className="sectionRail" aria-label="Colecciones principales">
                {categories.map((category) => (
                  <button key={category.id} type="button" className="sectionCard" onClick={() => selectCategory(category.id)}
                    style={{ "--section-color": categoryColor(category.name) } as React.CSSProperties}>
                    <span className="sectionIcon"><FolderOpen size={20} /></span>
                    <span><strong>{category.name}</strong><small>{category.material_count} recursos</small></span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                ))}
              </nav>
            </section>
          ) : null}

          {categoryId !== ALL_SECTIONS && sectionId === ALL_SECTIONS && !query.trim() ? (
            <section className="libraryCollections" aria-label="Áreas de la colección">
              <div className="librarySectionTitle"><h3>Áreas de {selectedCategory?.name ?? "la colección"}</h3><span>Selecciona un área para explorar</span></div>
              <nav className="sectionRail" aria-label="Áreas disponibles">
                {categorySections.map((section) => (
                  <button key={section.id} type="button" className="sectionCard" onClick={() => openSection(section.id)}
                    style={{ "--section-color": section.color ?? "#2563eb" } as React.CSSProperties}>
                    <span className="sectionIcon"><FolderOpen size={19} /></span>
                    <span><strong>{section.name}</strong><small>{section.material_count} recursos</small></span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </nav>
            </section>
          ) : null}

          <section className="materialLibraryResults" aria-live="polite" aria-busy={loading}>
            <div className="libraryResultHeading">
              <div>
                <h3>{browsingRoot ? "Recursos disponibles" : selectedSection?.name ?? (query.trim() ? "Resultados de búsqueda" : "Documentos de la colección")}</h3>
                <p>{loading ? "Actualizando biblioteca…" : `${filteredMaterials.length} archivo${filteredMaterials.length === 1 ? "" : "s"} en esta vista`}</p>
              </div>
              {(query || categoryId !== ALL_SECTIONS || sectionId !== ALL_SECTIONS || fileType !== "all") ? (
                <button type="button" className="libraryResetButton" onClick={resetNavigation}>
                  <X size={14} aria-hidden="true" /> Limpiar filtros
                </button>
              ) : null}
            </div>

            {loading ? <LibrarySkeleton /> : null}
            {error ? <div className="systemBanner" role="alert">
              <strong>No pudimos cargar los materiales.</strong><p>{error}</p>
              <button type="button" onClick={() => void loadLibrary(new AbortController().signal)}>Volver a intentar</button>
            </div> : null}

            {!loading && !error && filteredMaterials.length === 0 ? (
              <section className="emptyLibrary">
                <FolderOpen size={24} aria-hidden="true" />
                <strong>{query.trim() ? "No encontramos coincidencias" : "No hay materiales en esta selección"}</strong>
                <p>Intenta otro nombre, cambia el tipo de archivo o explora todas las colecciones.</p>
                <button type="button" onClick={resetNavigation}>Ver todos los recursos</button>
              </section>
            ) : null}

            {!loading && !error && filteredMaterials.length > 0 && shouldGroup ? (
              <div className="librarySectionStack">
                {sectionGroups.map((group) => (
                  <section className="librarySectionGroup" key={group.section.id}>
                    <header className="librarySectionHeading">
                      <div>
                        <span className="sectionHeadingMark" style={{ background: group.section.color ?? "#2563eb" }} />
                        <div><p>{group.section.path}</p><h3>{group.section.name}</h3></div>
                      </div>
                      <button className="sectionGroupMore" type="button" onClick={() => openSection(group.section.id)}>
                        Ver todos <span>{group.materials.length}</span><ChevronRight size={15} aria-hidden="true" />
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

            {!loading && !error && filteredMaterials.length > 0 && !shouldGroup ? (
              <>
                <div className={view === "grid" ? "materialGrid" : "materialListV2"}>
                  {filteredMaterials.slice(0, visibleCount).map((material) => (
                    <MaterialCard key={material.id} material={material} view={view} />
                  ))}
                </div>
                {filteredMaterials.length > visibleCount ? (
                  <button className="libraryLoadMore" type="button" onClick={() => setVisibleCount((count) => count + 24)}>
                    Mostrar más documentos <span>({visibleCount} de {filteredMaterials.length})</span>
                  </button>
                ) : null}
              </>
            ) : null}
            {!loading && !error && (data?.materials.length ?? 0) >= 400 ? (
              <p className="libraryLimitHint">Si no encuentras un archivo, utiliza la búsqueda para consultar más resultados.</p>
            ) : null}
          </section>
        </div>
      </div>
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
        {openUrl ? (
          <a className="materialOpenAction" href={openUrl} aria-label={`Abrir ${displayName}`}
            target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" /><span>Abrir</span></a>
        ) : null}
        {previewUrl && previewUrl !== openUrl ? (
          <a href={previewUrl} aria-label={`Previsualizar ${displayName}`}
            target="_blank" rel="noopener noreferrer"><Eye size={15} aria-hidden="true" /><span>Vista previa</span></a>
        ) : null}
      </div>
      <details className="materialDetails">
        <summary><Info size={14} aria-hidden="true" /> Detalles del archivo</summary>
        <dl>
          <div><dt>Nombre</dt><dd>{displayFileName}</dd></div>
          <div><dt>Formato</dt><dd>{type}</dd></div>
          {size ? <div><dt>Tamaño</dt><dd>{size}</dd></div> : null}
          {section ? <div><dt>Área</dt><dd>{section.name}</dd></div> : null}
        </dl>
      </details>
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

function materialFileType(material: LibraryMaterial): "pdf" | "image" | "document" | "other" {
  const type = (material.content_type ?? "").toLowerCase();
  const name = (material.file_name ?? material.title).toLowerCase();
  const label = (material.material_type ?? "").toLowerCase();
  if (type.includes("pdf") || /\.pdf(?:$|\?)/.test(name) || label === "pdf") return "pdf";
  if (type.startsWith("image/") || /\.(?:png|jpg|jpeg|gif|webp|svg)(?:$|\?)/.test(name)) return "image";
  if (/\.(?:docx?|pptx?|xlsx?|odt|ods|odp|txt|rtf)(?:$|\?)/.test(name)
    || /(?:word|excel|spreadsheet|powerpoint|officedocument|text\/)/.test(type)) return "document";
  return "other";
}
