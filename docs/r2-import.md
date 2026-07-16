# Importación de materiales desde Cloudflare R2

Este flujo convierte a Cloudflare R2 en la fuente de verdad del catálogo de materiales.

## Objetivo

- R2 contiene los archivos reales.
- D1 guarda solo el índice consultable por la app.
- El Worker de Cloudflare muestra previews y enlaces usando las keys importadas desde R2.

Esto evita cruzar rutas heredadas de Drive o rutas manuales con objetos reales de R2.

## Configuración requerida en Cloudflare Workers

El bucket se declara en `wrangler.jsonc` como binding `MATERIALS_BUCKET`.

`R2_PUBLIC_BASE_URL` es opcional. Si no existe, la app sirve preview/descarga mediante el Worker.

El bucket se llama `psicologia`, pero ese nombre no forma parte de las keys. Los objetos viven en la raíz del bucket (`Compendio de Psicología/...`, `Procesos Grupales/...`, etc.). Por eso `root` se omite para importar todo el bucket. Por compatibilidad, `root=psicologia` también se acepta y se interpreta como la raíz, nunca como el prefijo `psicologia/`.

## Dry run

Primero valida qué leerá el importador sin modificar la base de datos:

```bash
curl -X GET "https://app.rlead.xyz/api/admin/r2/import-materials?maxItems=10000" \
  -H "Cookie: <cookie-de-sesion-admin>"
```

También se puede abrir la URL desde el navegador con una sesión admin activa.

## Importación sin borrar registros existentes

```bash
curl -X POST "https://app.rlead.xyz/api/admin/r2/import-materials" \
  -H "Origin: https://app.rlead.xyz" \
  -H "Content-Type: application/json" \
  -H "Cookie: <cookie-de-sesion-admin>" \
  -d '{"dryRun":false,"maxItems":10000}'
```

## Reimportación limpia

Para borrar materiales existentes antes de importar, se requiere confirmación explícita.

Solo borra materiales R2 existentes:

```json
{
  "dryRun": false,
  "reset": true,
  "resetScope": "r2",
  "confirm": "REIMPORTAR_R2"
}
```

Borra todos los materiales del catálogo, incluyendo registros heredados de Drive/external, y luego importa desde R2:

```json
{
  "dryRun": false,
  "reset": true,
  "resetScope": "all",
  "confirm": "REIMPORTAR_TODO"
}
```

No borra usuarios, tareas, materias, preferencias ni configuración general. Solo elimina relaciones `task_materials` de los materiales borrados y registros de `materials`.

Para importar únicamente una carpeta, `root` debe ser el prefijo exacto dentro del bucket. Los espacios de una key R2 son significativos y el importador no los recorta.

## Resultado

Cada objeto de R2 se importa como un material con:

- `provider = 'r2'`
- `r2_bucket`
- `r2_key`
- `source_url`
- `preview_url`
- `section_id` calculado desde la carpeta del objeto
- `content_type` inferido por extensión
- `size_bytes` desde R2
