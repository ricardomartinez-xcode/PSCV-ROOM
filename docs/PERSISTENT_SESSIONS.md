# Sesiones persistentes de PSCV Room

PSCV Room no cierra sesiones por inactividad ni por una duración absoluta del servidor.

## Flujo

1. El usuario abre `/api/auth/login`, protegido por Cloudflare Access con los mismos proveedores y política de identidad existentes.
2. El Worker verifica la firma, emisor, audiencia y caducidad del JWT de Access y exige un perfil activo en D1.
3. Crea una credencial aleatoria de 256 bits. D1 guarda solamente su hash SHA-256, el perfil y el subject de Access.
4. El navegador recibe `__Host-pscv_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sin `Domain`.
5. Cada API valida la sesión en D1 y conserva sus controles de perfil, permisos y origen. No se aceptan JWT de Access para reabrir automáticamente una sesión revocada.
6. `/api/auth/session` renueva la cookie después de validar la sesión. La interfaz comprueba la sesión al abrirse, al volver a primer plano, al recuperar la conexión y cada cinco minutos mientras está visible. Los fallos temporales conservan el estado de la interfaz; los 401/403 lo retiran.
7. «Cerrar sesión» hace POST del mismo origen a `/api/auth/logout`. Primero revoca la credencial en D1, después borra la cookie y el estado local, avisa a las otras pestañas y termina el acceso de Cloudflare. Si falla la revocación se muestra un error y se permite reintentar.

## Límites del navegador

Los navegadores limitan las cookies persistentes a 400 días. La cookie se renueva con cada comprobación válida; la sesión en D1 no tiene fecha de caducidad. Borrar cookies, usar navegación privada o dejar el dispositivo sin abrir la app más allá de ese límite requiere iniciar sesión otra vez. Desactivar o eliminar un perfil bloquea su acceso.

## Despliegue y orden seguro

1. Aplicar `0020_persistent_sessions.sql` y desplegar el Worker con todas las pruebas y smoke aprobados.
2. Cambiar la aplicación Access `5ea707e5-bd98-4ccd-b514-938c14c76ecc` a un destino público `app.relnets.com/api/auth/login`. Mantener su AUD, proveedores y política. Retirar el destino de Worker completo: si permanece, Access seguirá imponiendo sus 12 horas a todas las peticiones.
3. La pantalla pública de acceso no contiene datos operativos. Todas las APIs de datos, archivos y administración requieren la sesión propia. No añadir un bypass a las APIs ni habilitar autenticación de desarrollo.
4. Verificar raíz 200, login redirigido a Access, APIs anónimas 401/403, sesión válida 200, renovación y rechazo de credenciales revocadas.

La administración puede revocar todas las sesiones de un perfil con una operación autorizada en D1: `UPDATE app_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE profile_id = ? AND revoked_at IS NULL`.

## Reversión

Restaurar primero los destinos Access originales (`app.relnets.com` y el Worker `f0678989c6234c7f8d17ac1a92a26109`), manteniendo proveedores y políticas. Después restaurar la versión anterior del Worker y el código anterior. La tabla aditiva de sesiones puede conservarse; no requiere eliminar perfiles ni datos operativos.
