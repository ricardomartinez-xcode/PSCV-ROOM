# PSCV Room QA Checklist

Fecha: 2026-06-29

## Validaciones Locales Minimas

```bash
npm run typecheck
npm test
npm run lint
npm run cf:build
npx wrangler deploy --dry-run --outdir dist
npm run smoke
```

Si se usa `next start`, define `SMOKE_BASE_URL` contra el puerto temporal.

## Smoke Remoto

```bash
$env:SMOKE_BASE_URL="https://app.relnets.com"; npm run smoke
```

Si se prueba contra Cloudflare Access, una respuesta `401` sin sesión es esperada. Para validar datos con la misma D1 remota, usar:

```bash
npm run cf:dev:remote
```

## Flujo Alumno

- Login con cuenta valida.
- Calendario abre detalle de tarea.
- Lista de tareas abre detalle de tarea.
- Tarea entregada no aparece como pendiente.
- Material R2 abre preview o descarga.
- Preferencias afectan solo al usuario actual.
- Campana muestra y descarta notificaciones.

## Flujo Admin

- `Admin > Usuarios` cambia permisos y roles.
- `Admin > Avisos` crea broadcast y genera recordatorios.
- `Admin > Reportes` carga tareas, materiales, alumnos y auditoria.
- `Admin > Diagnostico` muestra D1, R2, destinos y biblioteca.
- `Admin > Materiales` sube a R2 solo con permiso R2.
- Importador R2 corre primero en `Simular`.

## Seguridad

- Sin sesion, estas rutas deben devolver `401` o `403`:
  - `GET /api/notifications`
  - `GET /api/reports/operations`
  - `GET /api/admin/notifications`
  - `GET /api/admin/r2/status`
  - `POST /api/uploads/presign`
- `audit_log` solo debe ser visible para perfiles con `reports:view`.
- `app_profiles` solo debe modificarse con `users:manage`.

## Deploy

- Commit creado.
- Push a `origin`.
- `wrangler deploy --dry-run` muestra bindings `DB` y `MATERIALS_BUCKET`.
- Deploy de Cloudflare completado.
- Smoke en produccion tras promover.
