# Cloudflare Access + Microsoft

La app usa Cloudflare Access con Microsoft Entra ID. Ya no usa un proveedor de auth dentro de la aplicación.

## Produccion vigente

- Dominio protegido: `https://app.rlead.xyz`
- Team domain: `relead.cloudflareaccess.com`
- Proveedor Access: Microsoft Entra ID (`azureAD`)
- Politica Access: allow para el correo owner registrado en D1

## Modelo actual

```txt
Usuario
  -> Cloudflare Access
  -> Microsoft Entra ID
  -> Worker PSCV Room
  -> Perfil y permisos en Cloudflare D1
```

El Worker valida el encabezado `cf-access-jwt-assertion` y busca el perfil en `app_profiles`.

No existe contraseña interna de PSCV Room para producción. La contraseña se administra en Microsoft y PSCV Room solo valida el token de Cloudflare Access.

## Variables del Worker

```env
AUTH_MODE="cloudflare-access"
ACCESS_TEAM_DOMAIN="<team>.cloudflareaccess.com"
ACCESS_AUD="<audience-tag>"
```

Estos valores se configuran como secretos del Worker con `wrangler secret put`; no se guardan en git.

Para desarrollo local contra la misma D1 remota:

```env
AUTH_MODE="development"
ALLOW_DEV_AUTH="1"
DEV_AUTH_EMAIL="admin@example.com"
```

`AUTH_MODE=development` no debe usarse en produccion.

## Base de permisos

Los permisos viven en `app_profiles`:

- `role`: `student`, `admin` u `owner`
- `active`
- `can_edit_tasks`
- `can_delete_tasks`
- `can_manage_materials`
- `can_manage_users`
- `can_manage_settings`
- `can_manage_group`
- `can_manage_notifications`
- `can_view_reports`
- `can_manage_r2`

El acceso a la app se concede en Cloudflare Access/Microsoft Entra; el alcance dentro de la app se decide en D1.
