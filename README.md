# PSCV Room 2.0

App web moderna para reemplazar y mejorar el flujo actual de AppSheet + Google Sheets.

## Objetivo

Convertir el sistema actual de tareas, materiales, calendario y seguimiento en una app propia con:

- Panel de lectura para alumnos.
- Panel admin para crear, editar, entregar y cancelar tareas.
- Modelo operativo en Cloudflare D1.
- Subida/descarga de archivos preparada para Cloudflare R2.
- Migración gradual desde Google Sheets.
- Auditoría, permisos y columnas internas separadas de la UI.

## Decisión de arquitectura

La recomendación para producción es:

```txt
Next.js / Cloudflare Workers
  ↓
D1: tareas, usuarios, materias, estados, auditoría
  ↓
Cloudflare R2: archivos pesados, PDFs, presentaciones, materiales
  ↓
Google Sheets: solo importación inicial, respaldo o reportes simples
```

Sheets funcionó bien para prototipo, pero no debe ser la fuente principal cuando necesitas permisos reales, auditoría, estados consistentes, carga de archivos y escalabilidad.

## Stack

- Next.js App Router
- React + TypeScript
- CSS nativo minimalista
- API routes listas para D1 y R2
- Modo demo con datos semilla si no hay base de datos
- Cloudflare Access + Microsoft para identidad
- Autorización por perfil en D1
- Notificaciones persistentes y reportes operativos

## Ejecutar localmente

```bash
npm install
npm run dev
```

Abre:

```txt
http://localhost:8788
```

## Variables de entorno

Copia `.env.example` a `.env.local`.

```bash
cp .env.example .env.local
```

`npm run dev` compila OpenNext y ejecuta `wrangler dev --remote --port 8788`, usando la misma D1/R2 que el despliegue de Cloudflare.

```bash
npm run dev
```

Para producción, los bindings principales viven en `wrangler.jsonc`: `DB` para D1 y `MATERIALS_BUCKET` para R2. El dominio protegido por Cloudflare Access es:

```txt
https://app.rlead.xyz
```

Si quieres generar URLs públicas directas para materiales, configura:

```env
R2_PUBLIC_BASE_URL="https://pub-fb23330311304d9685253700280f0a85.r2.dev"
```

## Scripts

```bash
npm run dev
npm run next:dev
npm run cf:dev
npm run cf:dev:remote
npm run build
npm run smoke
npm run start
npm run typecheck
```

## Operacion

El runbook de deploy, variables Cloudflare, R2, D1 y recuperacion esta en:

```txt
docs/OPERATIONS_RUNBOOK.md
```

Guias de cierre:

```txt
docs/MIGRATION_STATUS.md
docs/QA_CHECKLIST.md
docs/USER_GUIDE.md
```

## Carpetas importantes

```txt
app/                  UI y API routes
components/           Componentes de interfaz
lib/                  Tipos, seed y utilidades
migrations/           Migraciones Cloudflare D1
docs/                 Arquitectura y migración
```

## Estado actual

- Datos operativos en Cloudflare D1.
- Archivos en Cloudflare R2.
- Permisos por perfil admin.
- Auditoria y reportes disponibles en Admin.
- Smoke automatizado para contratos principales.
