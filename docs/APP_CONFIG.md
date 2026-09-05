# Configuración operacional

## Modo demo

Sin binding D1 disponible, la app usa datos semilla y `localStorage`. Sirve para probar UI, flujo admin/lectura y diseño.

## Modo producción

La app usa Cloudflare Access para identidad y D1 para datos. El dominio publicado es:

```txt
https://app.rlead.xyz
```

Para probar contra la misma base remota del despliegue:

```bash
npm run cf:dev:remote
```

Endpoints incluidos:

```txt
GET  /api/health
GET  /api/tasks
POST /api/uploads/direct
GET  /api/notifications
GET  /api/reports/operations
GET  /api/admin/r2/status
```

## R2

El endpoint `/api/uploads/direct` recibe `FormData` y guarda el archivo con el binding `MATERIALS_BUCKET`. Requiere sesion y permiso `r2:manage`. No se requieren claves S3/R2 para este flujo porque el Worker usa el binding nativo.

Flujo recomendado:

```txt
UI selecciona archivo
  ↓
POST /api/uploads/direct
  ↓
Guardar metadata en materials
```

## Seguridad en producción

Implementado en la fase operativa:

- autenticación,
- permisos por perfil admin en D1,
- protección de APIs admin,
- auditoría en `audit_log`,
- borrado lógico de tareas,
- notificaciones persistentes,
- reportes operativos.

Pendiente para una fase posterior si aumenta el uso:

- rate limiting por IP/usuario,
- limites estrictos de tamano/tipo de archivo por curso,
- backups automáticos documentados.
