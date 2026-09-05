# Migration Status

Fecha: 2026-06-30

PSCV Room esta migrado a Cloudflare Workers con OpenNext.

## Runtime vigente

- Next.js App Router compilado con `@opennextjs/cloudflare`.
- Worker principal: `.open-next/worker.js`.
- Configuracion de despliegue: `wrangler.jsonc`.
- Dominio productivo: `https://app.rlead.xyz`.
- URL workers.dev disponible: `https://pscv-room.ricardomartinez.workers.dev`.
- Base de datos: Cloudflare D1 binding `DB`, database `pscv-room`.
- Archivos: Cloudflare R2 binding `MATERIALS_BUCKET`, bucket `psicologia`.
- Identidad: Cloudflare Access con Microsoft Entra ID en `relead.cloudflareaccess.com`.
- Autorizacion interna: perfiles y permisos en `app_profiles`.

## Migraciones vigentes

Las migraciones de datos activas viven en `migrations/`.

- `0001_pscv_room.sql`: esquema D1 operativo.
- `0002_seed_defaults.sql`: catalogos iniciales.
- `0003_owner_ricardo_outlook.sql`: owner inicial para el correo admin.

Las migraciones SQL del backend anterior fueron retiradas del repo para evitar que se usen como fuente vigente.

## R2

El flujo normal usa el binding nativo `MATERIALS_BUCKET`.

- Subida: `POST /api/uploads/direct`.
- Preview/descarga: `GET /api/materials/<id>/file`.
- Importacion: `GET|POST /api/admin/r2/import-materials`.
- Diagnostico: `GET /api/admin/r2/status`.

No se requieren claves S3 para el flujo normal. `R2_PUBLIC_BASE_URL` es opcional.

## Deploy

```bash
npm run cf:build
npx wrangler deploy
```

Verificacion minima:

```bash
npm run typecheck
npm test
npm run lint
npx wrangler deploy --dry-run --outdir dist
SMOKE_BASE_URL="https://pscv-room.ricardomartinez.workers.dev" npm run smoke
curl -I "https://app.rlead.xyz/api/health"
```

El smoke automatizado puede usar `workers.dev`, pero ahora comprueba que tareas, materiales y destinos del bucket rechacen sesiones anónimas. Así el subdominio técnico no se convierte en un bypass de Cloudflare Access. En el dominio productivo, una llamada sin sesión puede ser rechazada por la aplicación o redirigida por Access.

## Access

El dominio `app.rlead.xyz` esta protegido por una app self-hosted de Cloudflare Access.
La politica vigente permite el correo owner configurado en D1 y usa Microsoft Entra ID como proveedor.

Secrets requeridos en el Worker, configurados con `wrangler secret put`:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

`ACCESS_AUD` es el audience tag de la app self-hosted de Cloudflare Access que protege PSCV Room. No se debe usar `AUTH_MODE=development` en produccion.
