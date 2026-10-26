# Sincronización OneDrive o carpeta de PC -> Cloudflare R2 (PSCV-ROOM)

Estado: **lista para configurar; no activada automáticamente**. No se almacenan secretos en el repositorio.

## Requisitos

1. Instalar [rclone](https://rclone.org/install/) en el equipo Windows que contiene la carpeta.
2. Crear en Cloudflare R2 un token S3 de **Object Read & Write** limitado al bucket `psicologia`. Se necesita **Access Key ID** y **Secret Access Key**.
3. Ejecutar `rclone config` y crear el remote `pscv-r2`, tipo **s3**, proveedor **Cloudflare**, región `auto`, endpoint `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`. El token normal de Workers **no sustituye** las credenciales S3.
4. Si la carpeta origen está en OneDrive, seleccionar una carpeta **disponible sin conexión** (o configurar un remote OneDrive OAuth con `rclone config`).

## Prueba y ejecución

En PowerShell, desde la raíz del proyecto:

```powershell
.\scripts\sync-folder-to-r2.ps1 -SourceFolder 'C:\Ruta\OneDrive\PSCV'
# Si todo coincide:
.\scripts\sync-folder-to-r2.ps1 -SourceFolder 'C:\Ruta\OneDrive\PSCV' -Apply
```

Los archivos se copian en `psicologia/Sincronizado-PC/` y la biblioteca D1 los reconoce mediante reconciliación del inventario R2 al consultar Materiales.

## Programación opcional, después de verificar credenciales y hacer una copia manual correcta

Ejemplo de tarea cada 30 minutos; ejecutar bajo el usuario Windows con sesión válida y configuración rclone:

```powershell
$script = 'C:\Ruta\PSCV-ROOM\scripts\sync-folder-to-r2.ps1'
$folder = 'C:\Ruta\OneDrive\PSCV'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -File `"$script`" -SourceFolder `"$folder`" -Apply"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'PSCV-R2-Copy' -Action $action -Trigger $trigger -Description 'Copia no destructiva de recursos académicos a R2'
```

## Protecciones

- **Solo sentido PC/OneDrive → R2**, sin eliminación de archivos de R2 cuando desaparezcan localmente. Esta política evita perder recursos al desincronizar OneDrive.
- Solo sincroniza `Sincronizado-PC/`, no el bucket completo ni recursos gestionados en otras carpetas.
- `-Apply` es obligatorio para efectuar una escritura; la opción predeterminada es simulación.
- Ediciones de un mismo archivo dentro de la subcarpeta pueden sobrescribirse desde el equipo origen. No se recomienda editar simultáneamente el mismo recurso desde dos sistemas.
- El Administrador puede ocultar recursos en D1; la importación manual no restablece su visibilidad.
- Para bidireccionalidad real hace falta definir una política de conflictos, versionado de R2 y borrados. **No habilitar `rclone sync` ni `bisync` sin respaldo y validación.**
