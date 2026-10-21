# Corrección de compilación Cloudflare — 21 octubre 2026

## Causa
El comando `npm run cf:build` se detiene cuando `@opennextjs/cloudflare` detecta Next.js 15.5.19 fuera de su matriz de versiones aceptadas.

## Dependencias propuestas
- `next`: 16.4.2
- `eslint-config-next`: 16.4.2
- `@opennextjs/cloudflare`: 1.20.12

Se exige también actualizar `package-lock.json` usando `npm install --package-lock-only --ignore-scripts`, sin deshabilitar la comprobación de versiones.
El workflow temporal de sincronización de lockfile debe **eliminarse** y deben restaurarse los permisos mínimos `contents: read` antes de fusionar.

## Validación
1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run cf:build`
6. Inspeccionar `.open-next/worker.js`, rutas protegidas y tamaño; ejecutar smoke test en una instancia aislada antes de pasar a producción.

## Despliegue seguro
El workflow de `main` aplica `wrangler d1 migrations apply pscv-room --remote` antes del despliegue. Este PR se basa en `main` y **no contiene** migraciones nuevas ni el módulo Asistencia. Revisar los cambios en la rama, confirmar que GitHub Actions aprueba, desplegar en entorno de prueba y luego, con autorización, fusionar para desplegar producción.

Para integrar la sección **Asistencia**, habrá que incorporar el arreglo de dependencias a su rama y validar las migraciones allí por separado.
