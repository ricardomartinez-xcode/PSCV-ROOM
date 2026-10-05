# Cloudflare Access + Microsoft

La app usa Cloudflare Access con Microsoft Entra ID. La autenticación ocurre en Access y la autorización interna ocurre en D1.

## Producción vigente

- Dominio protegido: `https://app.relnets.com`
- Team domain: `withered-glade-36de.cloudflareaccess.com`
- Proveedor Access: Microsoft Entra ID (`azureAD`)
- Login automático al IdP: habilitado
- Política Access: `allow everyone`, limitada por los IdP permitidos de la aplicación
- Autorización de PSCV Room: perfil activo y permisos en `app_profiles`

## Modelo actual

```txt
Usuario
  -> Cloudflare Access
  -> Microsoft Entra ID
  -> Worker PSCV Room
  -> Perfil y permisos en Cloudflare D1
```

El Worker valida `cf-access-jwt-assertion` y busca el perfil en `app_profiles`. Que Access autentique una identidad no concede permisos dentro de PSCV Room: si el perfil no existe o está inactivo, la API responde 403.

## Cambio y cierre de sesión

El cierre de sesión navega en primer nivel a:

```text
https://app.relnets.com/cdn-cgi/access/logout
```

No se usa `fetch()` para cerrar Access. Esto permite que Cloudflare elimine de forma fiable su cookie `HttpOnly`, incluso en navegadores móviles. Si la app detecta una sesión inválida o no autorizada, **Volver a iniciar acceso** también termina primero la sesión de Access para evitar bucles con una cookie antigua.

Para permitir cambio explícito de cuenta, el proveedor Microsoft debe usar `prompt=select_account`.

## Variables del Worker

```env
AUTH_MODE="cloudflare-access"
ACCESS_TEAM_DOMAIN="withered-glade-36de.cloudflareaccess.com"
ACCESS_AUD="<audience-tag>"
AUTH_IDENTITY_PROVIDER="azureAD"
```

## Base de permisos

Los permisos viven en `app_profiles`: `role`, `active` y los campos `can_*`. Cloudflare Access/Microsoft verifica la identidad; D1 determina si esa identidad está autorizada y qué puede hacer.
