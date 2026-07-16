# Hoja de ruta propuesta

Esta lista prioriza mejoras que complementan la selección múltiple de materiales,
los recordatorios de hoy/mañana y la actualización de Reportes/Diagnóstico.

## P0 — confiabilidad y seguridad

1. **Bucket completamente privado.** Desactivar el acceso público `r2.dev` y
   conservar previews/descargas únicamente por las rutas autenticadas de PSCV Room.
2. **Indexación incremental de R2.** Conectar `object-create` y `object-delete` de
   [R2 Event Notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
   a una Queue y un consumidor idempotente que actualice D1. Mantener el importador
   actual como reconciliación manual, no como flujo principal.
3. **Outbox para tareas y avisos.** Guardar la mutación de la actividad y el trabajo
   de recordatorio en una misma transacción lógica; procesarlo por cola evita que un
   fallo de push convierta en error una tarea que ya se guardó. Versionar cada
   ocurrencia y su claim evita que un envío externo ya iniciado confirme una
   reprogramación posterior.
4. **Política de archivos.** Validar extensión, MIME real, tamaño y nombre; registrar
   checksum, cuarentena y resultado de análisis antes de marcar un material como
   visible. Mantener los objetos privados y servir preview/descarga por rutas
   autorizadas con expiración y auditoría.
5. **Pruebas de permisos por rol.** Añadir casos de propietario, administrador sin
   permiso, alumno activo/inactivo y acceso directo a IDs de material o tarea.

## P1 — experiencia y accesibilidad

1. **Centro de instalación PWA.** Guiar de forma específica a Android, Windows e
   iOS; en iPhone/iPad Web Push requiere agregar la app a Inicio. Incluir prueba de
   notificación, estado del permiso y solución de problemas por dispositivo.
2. **Badges y preferencias granulares.** Mostrar cantidad pendiente en el icono
   instalado y permitir silenciar por materia, conservando el límite global de
   avisos a mañana/hoy.
3. **Reportes guardados.** Persistir filtros, orden y dataset; añadir paginación del
   servidor para auditorías grandes y enlaces compartibles con filtros, sujetos al
   permiso `reports:view`.
4. **Modo de lectura accesible.** Opción de mayor contraste y densidad cómoda,
   soporte completo a 200%/400% de zoom y pruebas automáticas de teclado, lectores
   de pantalla y movimiento reducido.
5. **Offline selectivo.** Cachear estructura, tareas y metadatos; descargar archivos
   grandes solo bajo petición y mostrar claramente su estado sin conexión.

## P2 — integraciones y operación

1. **Calendarios y LMS.** Exportación/suscripción ICS y conectores opcionales para
   Moodle o Google Classroom, con mapeo explícito de materia, tipo y fecha.
2. **Observabilidad.** Métricas de retraso del cron, avisos creados/enviados,
   suscripciones expiradas, fallos de preview y desfase R2↔D1; alertas solo cuando
   la acción sea concreta.
3. **Carga reanudable.** Multipart para archivos grandes, progreso, cancelación y
   reintento; actualización optimista solo después de confirmar el checksum.
4. **Auditoría exportable.** Filtros por actor/entidad/fecha, retención documentada
   y exportación protegida para soporte y cumplimiento.

## Métricas sugeridas

- Material nuevo visible en biblioteca en menos de 60 segundos.
- Cero enlaces R2 sin fila D1 después de cada reconciliación.
- Más de 99% de recordatorios generados antes de su ventana de entrega.
- Cero notificaciones activas de 2 o 3 días.
- 100% de flujos principales utilizables con teclado y sin scroll horizontal de página
  a 320 CSS px; las tablas conservan desplazamiento interno etiquetado.
