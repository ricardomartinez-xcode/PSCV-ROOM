# PSCV-ROOM — Permanencia con descansos fijos y variables

## Tres roles de acceso (visibles en la plataforma)

| Rol | Sección Asistencia | Permisos generales |
| --- | --- | --- |
| **Administrador** | Pase de lista, entradas/salidas, descansos configurables, reportes grupales y exportación, sujeto a `group:manage` | Gestión institucional según indicadores individuales existentes; cambios de roles y permisos reservados al administrador principal |
| **Profesor** | Misma vista de captura que administrador, **solo para materias donde `courses.professor_email` coincide con el correo autenticado** | Sin gestión de usuarios, configuración global ni datos de otras materias |
| **Alumno** | Vista «Mi asistencia» de lectura: sus propias marcas y porcentaje por fecha, nunca información de otros alumnos | Sin escritura de asistencia ni administración |

**Compatibilidad:** D1 conserva el campo histórico `app_profiles.role` (`owner/admin/student`) para no reconstruir tablas referenciadas, pero añade `app_profiles.profile_role` con **administrator/professor/student**, el único rol institucional seleccionable en la aplicación. `owner` es exclusivamente una marca interna no asignable por UI. Al ascender un alumno a profesor se usa el rol técnico `admin` sin flags generales; las APIs aplican `profile_role` y el vínculo `courses.professor_email` antes de cualquier cambio.

- La identidad del alumno procede **de la sesión de Cloudflare Access**, nunca de un ID suministrado por el navegador.
- Las consultas de estudiantes entregan únicamente sus propios registros y descartan identidades ajenas.
- Cambiar el rol de usuario tiene auditoría, y la cuenta administradora principal no puede degradarse ni eliminarse desde el panel.
- Los profesores deben ser vinculados a sus materias en Gestión académica por correo, antes de registrar asistencia.
- Nuevos profesores se crean como usuarios y luego el administrador principal les cambia el rol a «Profesor».

## Alcance del diseño

Implementar un módulo interno y protegido en PSCV-ROOM, usando perfiles y materias ya almacenados en Cloudflare D1. **No** modifica asistencias oficiales institucionales ni comunica resultados a docentes automáticamente. El responsable registra observaciones presenciales, sujetas a corrección y auditoría. Los alumnos no registran sus propios tiempos.

Se requiere un registro separado por **materia + día + franja horaria**: Inglés VII se imparte el lunes de 16:00 a 18:00 y el miércoles de 16:00 a 17:00, por ejemplo. No es suficiente guardar una sola política por materia.

## Modalidades por franja

- **Fijo**: uno o varios intervalos de descanso programados, con inicio y fin local (HH:mm) establecidos en la plantilla semanal.
- **Variable**: el responsable toca «Iniciar descanso» y «Terminar descanso» durante cada clase. Los tiempos efectivos se guardan como eventos de sesión.
- **Mixto**: se aplican los intervalos fijos y también es posible registrar descansos adicionales o ajustes autorizados en esa sesión. El cálculo usa su **unión**, nunca suma doble los minutos superpuestos.
- **Sin descanso**: excepcionalmente, si esa franja no tiene receso oficial.

Para ausencias momentáneas (p. ej. sanitario) se recomienda un tipo de incidencia configurable en vez de asumir automáticamente una sanción o descuento. Una salida autorizada puede registrarse como incidencia, siguiendo reglas acordadas con el grupo y la institución.

## Horario compartido (sujeto a confirmar con los datos actuales de D1)

| Día | Franja | Materia | Duración programada |
| --- | --- | --- | --- |
| Lunes | 16:00–18:00 | Inglés VII | 120 min |
| Lunes | 18:00–21:00 | Evaluación Psicológica II | 180 min |
| Martes | 15:00–18:00 | Procesos Grupales y Manejo Constructivo de Conflictos | 180 min |
| Martes | 18:00–21:00 | Diagnóstico Psicométrico | 180 min |
| Miércoles | 16:00–17:00 | Inglés VII | 60 min |
| Miércoles | 17:00–19:00 | Modificación de la Conducta | 120 min |
| Jueves | 15:00–18:00 | Psicología Educativa | 180 min |

**Regla confirmada el 21/10/2026:** solamente las sesiones de tres horas incluyen receso y su horario casi siempre varía. Por ello las sesiones de 180 minutos inician en modo **variable** y las sesiones de 60 o 120 minutos en modo **sin descanso**. En cualquier momento, el responsable puede modificar la modalidad para una sesión concreta; no se inventan descansos ni tiempos.

| Día | Horario | Materia | Descanso inicial |
| --- | --- | --- | --- |
| Lunes | 16–18 | Inglés VII | No |
| Lunes | 18–21 | Evaluación Psicológica II | Variable |
| Martes | 15–18 | Procesos Grupales y Manejo Constructivo de Conflictos | Variable |
| Martes | 18–21 | Diagnóstico Psicométrico | Variable |
| Miércoles | 16–17 | Inglés VII | No |
| Miércoles | 17–19 | Modificación de la Conducta | No |
| Jueves | 15–18 | Psicología Educativa | Variable |

### Asistencia y permanencia diaria
- El menú se llamará **Asistencia** y tendrá pase de lista (presente, retardo, ausente, justificado) y control de intervalos de entrada/salida.
- Los alumnos se leen **directamente de la tabla D1 `app_profiles`** filtrando `role = 'student' AND active = 1`, sin duplicar información en una tabla nueva.
- Se podrá consultar la asistencia de cada clase de un día y la permanencia ponderada acumulada del mismo día.
- Una marca de pase de lista **no sustituye** la medición de permanencia; las horas de entrada y salida construyen los intervalos.
- Los alumnos ven únicamente registros propios; los profesores pueden gestionar sus materias asignadas y los administradores con permiso `group:manage` gestionan el conjunto. No se modifica la lista oficial ni se comparten datos personales automáticamente.

## Modelo de datos

- 'permanence_patterns': regla semanal por curso y horario; modo de descanso y plantilla fija.
- 'permanence_sessions': sesión real con inicio/fin programados, cierre real y estado.
- 'permanence_breaks': descansos efectivamente aplicados; distingue fijos y variables.
- 'permanence_presence': intervalos de presencia por estudiante, registrando entradas y salidas.
- 'permanence_attendance': estado de pase de lista por estudiante y por sesión, con historial en auditoría.

Evitar sobrescribir intervalos históricos. Los ajustes posteriores deben conservar actor, momento, justificación y antes/después en 'audit_log'. La identidad y los permisos deben verificarse **en servidor**, aprovechando 'requirePermission(request, "group:manage")' y/o una capacidad específica en el futuro.

## Regla de cálculo

Todos los intervalos se recortan a los límites de la clase. Se normalizan a UTC, se fusionan intervalos solapados y se usa precisión en milisegundos antes de mostrar minutos y porcentaje.

- 'R' = duración real exigible = duración efectiva de la sesión menos unión de descansos oficiales.
- 'P' = unión de intervalos de presencia del alumno menos la intersección con los descansos.
- 'permanencia %' = P / R × 100, si R > 0.

El denominador para clase cerrada usa su hora efectiva de finalización si difiere de la prevista. No sumar descansos que se superponen dos veces. No inferir permanencia a partir de un registro aislado de pase de lista.

Para reportes acumulados de materia o periodo usar **suma de minutos presentes / suma de minutos exigibles**, no promedio simple de porcentajes entre sesiones de distintas duraciones.

Durante una clase abierta, el resultado es provisional; si un intervalo de presencia o un descanso variable está abierto, se calcula hasta el momento de consulta. No tratar la falta de registro como prueba definitiva de ausencia sin oportunidad de corrección.

## Propuesta de controles móviles

1. Seleccionar clase y fecha; cargar grupo desde 'app_profiles' y curso desde 'courses'.
2. «Iniciar sesión»; precargar descansos fijos según patrón, si aplica.
3. Por alumno: «Entrada» / «Salida». Al volver al aula, se abre un nuevo intervalo.
4. Si la modalidad permite recesos variables: «Iniciar descanso» y «Finalizar descanso»; impedir dos descansos variables abiertos al mismo tiempo.
5. «Finalizar clase»: cerrar intervalos abiertos con tiempo de cierre real, no necesariamente tiempo programado.
6. Reportes filtrables por alumno, materia y periodo, exportables a Excel.

Un receso fijo puede **reprogramarse solo en la sesión** si el docente modifica la hora; registrar diferencia y actor. Una clase cancelada no tiene minutos exigibles. Las salidas autorizadas deben contar con observación trazable.

## Seguridad y operación

- Edición únicamente para administrador autorizado o profesor asignado a la materia; alumno accede a consulta privada de su propio historial.
- Mantener D1 como fuente principal. Excel es exportación, no backend.
- Crear un PR de revisión y probar en entorno aislado con D1 local o de pruebas. **No aplicar la migración directamente a la D1 de producción** ni desplegar en el dominio sin validar permisos y flujo.
- Antes de usarlo, informar al grupo del propósito, criterios, acceso y plazo de conservación de los datos. No confundir permanencia de monitoreo interno con la asistencia oficial.
- Estado de este cambio: API, menús, paneles diferenciados, matriz de roles y migraciones están en PR de revisión. No hay migraciones en producción ni despliegue del módulo; resta validar el compilador OpenNext/Next.js y probar D1 en entorno aislado.
