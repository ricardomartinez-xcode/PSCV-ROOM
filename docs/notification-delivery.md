# Entrega de avisos: sistema, aplicación y correo

PSCV Room conserva el centro de avisos y ofrece tres canales opcionales por
usuario. Los recordatorios de tareas se programan únicamente para **mañana** y
**hoy**; no se generan ventanas de dos o tres días.

## Activar como usuario

La configuración está dentro del centro de **Avisos**.

- **Con la app cerrada:** registra una suscripción Web Push y entrega una
  notificación del sistema mediante el service worker. El control **Probar**
  valida el dispositivo actual y **Desactivar** revoca solo esa suscripción.
- **Mientras usas la app:** cuando la pestaña queda en segundo plano, los avisos
  nuevos se muestran a través del service worker cuando está disponible. Existe
  un fallback para navegadores de escritorio que solo admiten `Notification`.
- **Sonido:** reproduce un tono breve después de que el usuario haya interactuado
  con el control de Avisos.
- **Correo:** guarda la preferencia en
  `notification_preferences.email_enabled`.

Los botones que solicitan permiso deben activarse mediante una interacción del
usuario; PSCV Room no intenta abrir el diálogo automáticamente.

## Compatibilidad e instalación

Web Push necesita HTTPS (localhost es la excepción de desarrollo), permiso del
sistema/navegador, service workers y Push API.

- **Android:** abrir la app en Chrome o un navegador compatible, entrar a Avisos
  y seleccionar **Activar**. Instalar la PWA es recomendable, pero Chrome puede
  entregar Web Push sin instalación.
- **Windows:** usar Edge, Chrome u otro navegador compatible y permitir los
  avisos tanto en el navegador como en Configuración > Sistema > Notificaciones.
- **iPhone/iPad:** requiere iOS/iPadOS 16.4 o posterior y una app web agregada a
  la pantalla de inicio. En Safari: **Compartir > Agregar a pantalla de inicio**;
  después se abre PSCV Room desde ese icono y se activa el permiso. La interfaz
  detecta también iPadOS cuando Safari usa una identificación de escritorio.

Si el permiso aparece como bloqueado, debe restablecerse desde la configuración
del sitio o del sistema; los navegadores no permiten volver a solicitar un
permiso denegado mediante código.

## Configuración del servidor

Aplicar las migraciones `0006_web_push.sql` y `0007_push_delivery_display.sql` y
configurar el par VAPID completo:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:responsable@tu-dominio.mx
```

`VAPID_PRIVATE_KEY` nunca debe exponerse al navegador. El workflow de Cloudflare
genera/valida el par y lo registra como secreto; no se deben rotar las claves en
cada despliegue porque las suscripciones existentes dejarían de coincidir.

El cron ejecuta la reconciliación de recordatorios antes de la entrega. El
service worker recibe un wake sin contenido sensible, reclama el aviso pendiente
con la sesión del usuario y muestra una notificación con tag estable. Las URLs de acción se
restringen al mismo origen antes de enfocar o abrir una ventana, y las mutaciones
de suscripción usan solicitudes `same-origin` sin seguir redirecciones.

## Iconos y badges

El manifest y las notificaciones reutilizan `public/icon.svg`. No se declara como
`maskable` porque no existe todavía un asset con zona segura dedicada. Para cerrar
la matriz visual de producción deben prepararse, a partir del arte aprobado, PNG
de 180 px (Apple touch), 192 px y 512 px, más un badge monocromo; hasta entonces
se omite `badge` para evitar recortes o fondos ilegibles según la plataforma.

## Correo de anuncios

Al publicar un anuncio desde Administración > Avisos, PSCV Room guarda primero
las notificaciones en D1 y después intenta enviar correo solo a usuarios activos
que hayan habilitado el canal y la categoría.

Configura estos secretos del Worker:

```text
RESEND_API_KEY=re_...
EMAIL_FROM="PSCV Room <avisos@tu-dominio.mx>"
```

En Resend, verifica el dominio usado por `EMAIL_FROM` antes de enviar a
estudiantes. La respuesta del endpoint incluye un resumen técnico de correos
enviados, omitidos o con error para diagnóstico.

## Validación manual antes de publicar

1. Probar activación, envío de prueba, clic y desactivación en Android y Windows.
2. Repetir en iPhone/iPad desde el icono de pantalla de inicio, no desde una pestaña
   normal de Safari.
3. Confirmar que un clic siempre abre una ruta de PSCV Room y que el mismo tag no
   apila duplicados.
4. Bloquear/restaurar el permiso y verificar que el estado se anuncie y los
   controles permanezcan utilizables con teclado y lector de pantalla.
5. Verificar que solo aparezcan recordatorios de tareas para mañana y hoy.
