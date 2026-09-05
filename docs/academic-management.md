# Gestión de materias y alumnos

La ruta administrativa es `/?tab=admin&adminTab=courses`. Solo la puede operar un perfil `owner` o un administrador con los permisos correspondientes.

## Crear una materia

1. Abre `https://TU-DOMINIO/?tab=admin&adminTab=courses` con una cuenta administradora.
2. Completa nombre, nombre corto opcional, color, icono y tamaño de tarjeta.
3. Pulsa **Crear materia**.
4. Para conservar el historial de tareas, una materia se desactiva y reactiva; no se elimina físicamente.

Las materias se guardan en `courses` y se pueden usar inmediatamente al crear tareas.

## Registrar un alumno

1. Completa nombre, correo y número de control opcional.
2. Pulsa **Guardar alumno**.
3. La aplicación crea o actualiza su fila en `app_profiles`.
4. El acceso inicial se concede desde Cloudflare Access/Microsoft Entra ID; el perfil D1 define permisos y estado dentro de PSCV Room.

## Configuración de despliegue

Antes de registrar alumnos:

1. Aplica las migraciones D1 con `npx wrangler d1 migrations apply pscv-room --remote`.
2. Configura Cloudflare Access para proteger el Worker con Microsoft Entra ID.
3. Crea o importa el perfil owner inicial en `app_profiles`.
4. Verifica `/api/auth/session` con una cuenta permitida por Access.

El panel principal existente de **Usuarios** se mantiene para cambiar roles, permisos o activar/desactivar perfiles ya creados.
