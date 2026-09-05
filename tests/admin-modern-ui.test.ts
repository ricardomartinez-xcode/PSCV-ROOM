import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hub = readFileSync(new URL("../components/admin-hub.tsx", import.meta.url), "utf8");
const modernCss = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const workspacesCss = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const reportsCss = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const diagnosticsCss = readFileSync(new URL("../app/pscv.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("loads unified admin modules and their active base styles", () => {
  for (const name of ["adminTasksModule", "adminCalendarModule", "adminMaterialsModule", "adminCoursesModule", "adminUsersModule", "adminNoticesModule", "adminReportsModule", "adminDiagnosticsModule"]) {
    assert.match(hub, new RegExp(name));
  }

  assert.match(layout, /import "\.\/pscv\.css"/);
  assert.doesNotMatch(layout, /admin-modern\.css|admin-reports\.css|admin-diagnostics\.css|admin-workspaces\.css|operational-polish\.css/);
  assert.match(modernCss, /adminCoursesModule/);
  assert.match(workspacesCss, /\.adminTasksModule/);
  assert.match(workspacesCss, /\.adminCalendarModule/);
  assert.match(workspacesCss, /\.adminMaterialsModule/);
  assert.match(reportsCss, /\.reportToolbar/);
  assert.match(diagnosticsCss, /\.diagnosticDetails/);
});

test("admin tabs use real icons and an accessible keyboard tab pattern", () => {
  for (const icon of ["LayoutDashboard", "ListTodo", "CalendarDays", "BookOpen", "FolderOpen", "Users", "Bell", "BarChart3", "Activity"]) {
    assert.match(hub, new RegExp(icon));
  }

  assert.match(hub, /\{ id: "calendar", label: "Calendario", icon: CalendarDays \}/);
  assert.match(hub, /tab\.id === "calendar" \? "tasks" : tab\.id/);
  assert.match(hub, /role="tablist"/);
  assert.match(hub, /role="tab"/);
  assert.match(hub, /const selected = activeTab === tab\.id/);
  assert.match(hub, /aria-selected=\{selected\}/);
  assert.match(hub, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(hub, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(hub, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
});

test("general admin metrics are keyboard-accessible shortcuts to their modules", () => {
  assert.match(hub, /<GeneralPanel stats=\{stats\} onNavigate=\{setActiveTab\}/);
  assert.match(hub, /aria-label="Accesos rápidos de administración"/);
  assert.match(hub, /aria-label=\{`Abrir \$\{label\}`\}/);
  assert.match(hub, /onNavigate\("materials"\)/);
  assert.match(workspacesCss, /\.metricCard:hover/);
});

test("tasks and calendar expose interactive summaries, filters and editable views", () => {
  assert.match(hub, /function TasksPanel/);
  assert.match(hub, /aria-label="Resumen de tareas"/);
  assert.match(hub, /aria-label="Filtros de tareas"/);
  assert.match(hub, /compareAdminTasks\(firstTask, secondTask, sortMode\)/);
  assert.match(hub, /visibleTasks\.length\} de \{tasks\.length/);
  assert.match(hub, /function AdminCalendarPanel/);
  assert.match(hub, /aria-label="Resumen del calendario"/);
  assert.match(hub, /className="adminCalendarScroll" role="region"/);
  assert.match(hub, /className="adminCalendarGrid" role="grid"/);
  assert.match(hub, /className="adminCalendarAgenda"/);
  assert.match(hub, /Selecciona una entrega del calendario para editarla/);
});

test("materials connect the indexed library to an explicit bucket sync", () => {
  assert.match(hub, /\/api\/materials\/library\?limit=500/);
  assert.match(hub, /\/api\/admin\/r2\/import-materials/);
  assert.match(hub, /JSON\.stringify\(\{ dryRun: false, maxItems: 10000 \}\)/);
  assert.match(hub, /if \(!canManageR2\) return/);
  assert.match(hub, /Sincronizar bucket/);
  assert.match(hub, /await loadMaterialLibrary\(\);[\s\S]*await reload\(\);/);
  assert.match(hub, /Vista previa/);
  assert.match(hub, /Descargar/);
  assert.match(hub, /aria-label="Filtros de materiales"/);
});

test("reports expose summary, dataset, search, sorting, counter and CSV export", () => {
  assert.match(hub, /reportSummaryGrid/);
  assert.match(hub, /Conjunto de datos/);
  assert.match(hub, /Buscar en/);
  assert.match(hub, /filterAndSortReportRows/);
  assert.match(hub, /aria-sort=\{sortColumn === column \? sortDirection : "none"\}/);
  assert.match(hub, /Exportar CSV/);
  assert.match(hub, /text\/csv;charset=utf-8/);
  assert.match(hub, /role="region" aria-label=\{`Tabla de \$\{title\}`\} tabIndex=\{0\}/);
  assert.match(hub, /<caption className="reportSrOnly">/);
  assert.match(hub, /\{displayedRows\.length\} de \{selectedDataset\.rows\.length\}/);
});

test("diagnostics disclose details and require a successful simulation before sync", () => {
  assert.match(hub, /<details className="diagnosticDetails">/);
  assert.match(hub, /Variables de entorno/);
  assert.match(hub, /Carpetas detectadas/);
  assert.match(hub, /Objetos de muestra/);
  assert.match(hub, /Simular cambios/);
  assert.match(hub, /disabled=\{importBusy \|\| !canSynchronize\}/);
  assert.match(hub, /¿Aplicar los cambios simulados\?/);
  assert.match(hub, /Confirmar sincronización/);
  assert.match(hub, /importResult\?\.dryRun !== true/);
  assert.match(hub, /aria-busy=\{loading \|\| importBusy\}/);
  assert.match(hub, /role="status" aria-live="polite"/);
});

test("manual reminder UI only requests today and tomorrow", () => {
  assert.match(hub, /JSON\.stringify\(\{ windowDays: 1 \}\)/);
  assert.match(hub, /Sincronizar recordatorios \(hoy y mañana\)/);
  assert.match(hub, /No crea recordatorios de dos o tres días antes/);
  assert.match(hub, /payload\.synchronized/);
});
