# Importación de alumnos desde CSV

La administración de alumnos se realiza en:

```text
/?tab=admin&adminTab=users
```

La pantalla requiere el permiso `users:manage` y permite altas, edición, desactivación, eliminación e importación masiva.

## Formato del archivo

El CSV debe tener una fila de encabezados e incluir estas columnas:

```text
Correo electrónico,Nombre completo,No de control
```

También se aceptan los encabezados equivalentes `Correo`, `Email`, `E-mail`, `Nombre` y `Número de control`.

La importación:

- Normaliza el correo a minúsculas.
- Agrega alumnos nuevos y actualiza coincidencias por número de control o correo.
- Ignora filas sin correo, nombre y número de control. Esto evita importar filas de relleno de Excel.
- No elimina alumnos que no estén presentes en el archivo.
- Rechaza correos o números de control duplicados y conflictos con perfiles `admin` u `owner`.
- No conserva el archivo CSV después de procesarlo.

Los usuarios con correos externos a `@univdep.edu.mx` pueden existir en D1, pero necesitan estar contemplados en la política de Cloudflare Access/Microsoft Entra para poder iniciar sesión.
