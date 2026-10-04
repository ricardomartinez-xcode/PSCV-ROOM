# PSCV Room: despliegue canónico con Cloudflare Access y Keycloak

## Topología de producción

La URL canónica es `https://app.relnets.com` y debe ejecutarse en el Worker `pscv-room`.

```text
Navegador
  -> Cloudflare Access
    -> Keycloak (broker)
      -> Microsoft Entra ID / Google Workspace
  -> Worker pscv-room
    -> D1 + R2
```

PSCV Room usa bindings nativos de Cloudflare para D1 y R2, además del encabezado `cf-access-jwt-assertion` emitido por Cloudflare Access. Por esta razón, PSCV Room no valida tokens de Keycloak directamente y no necesita un cliente OAuth dentro de Next.js.

Vercel puede usarse sólo para previews o pruebas visuales. No es un origen de producción compatible con los bindings Cloudflare ni con el flujo de Access.

## Requisitos antes de publicar

1. El Worker debe estar asociado a `app.relnets.com` mediante el bloque `routes` de `wrangler.jsonc`.
2. Cloudflare Access debe tener una aplicación Self-hosted para `https://app.relnets.com`.
3. Configura los valores del Worker fuera de Git:

   ```bash
   wrangler secret put ACCESS_TEAM_DOMAIN
   wrangler secret put ACCESS_AUD
   ```

   `ACCESS_TEAM_DOMAIN` es el dominio del equipo de Access, sin protocolo. `ACCESS_AUD` es el Audience (AUD) de la aplicación Access.
4. Opcionalmente configura un valor no secreto para diagnóstico:

   ```bash
   wrangler secret put AUTH_IDENTITY_PROVIDER
   # valor: keycloak
   ```

5. Aplica las migraciones y comprueba que cada persona autorizada tenga un registro activo en `app_profiles`:

   ```bash
   wrangler d1 migrations apply pscv-room --remote
   ```
6. Publica el Worker:

   ```bash
   npm ci
   npm run lint
   npm run typecheck
   npm run cf:build
   npm run cf:deploy
   ```

## Configurar Keycloak como broker OIDC

### 1. Realm y proveedores upstream

Crea un realm dedicado, por ejemplo `pscv`. Dentro del realm agrega Microsoft Entra ID y Google como Identity Providers. Haz que el correo institucional sea obligatorio y verificable. Conserva una dirección de correo estable: PSCV Room relaciona usuarios con D1 por `email` y utiliza el `sub` emitido por Access como identificador alternativo.

Evita habilitar `Trust Email` para proveedores externos que no garanticen el atributo `email_verified` o que permitan cuentas personales fuera de las políticas institucionales.

### 2. Cliente OIDC para Cloudflare Access

En Keycloak crea un cliente confidencial OIDC para Cloudflare Access:

- Client ID sugerido: `cloudflare-access`.
- Client authentication: enabled.
- Standard flow: enabled.
- Direct access grants, service accounts e implicit flow: disabled.
- Valid redirect URI: `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/callback`.
- Default client scopes: `email` y `profile`.
- PKCE: `S256` si la versión/configuración de Keycloak lo permite.

No uses el cliente de Cloudflare Access desde el navegador ni guardes su secret en PSCV Room.

### 3. Integración OIDC en Cloudflare Zero Trust

En Zero Trust abre **Integrations > Identity providers > Add new identity provider > OpenID Connect** y registra Keycloak. Extrae los valores del documento OIDC discovery del realm:

```text
https://<KEYCLOAK_HOST>/realms/<REALM>/.well-known/openid-configuration
```

Configura en Cloudflare Access:

```text
Client ID: cloudflare-access client ID
Client secret: secret del cliente Keycloak
Auth URL: <authorization_endpoint del discovery>
Token URL: <token_endpoint del discovery>
Certificate URL: <jwks_uri del discovery>
Scopes: openid email profile
Email claim name: email
PKCE: enabled cuando Keycloak lo requiera
```

Después habilita este método de login en la aplicación Access de `app.relnets.com`. Prueba el proveedor desde Zero Trust antes de añadirlo a una política de producción.

### 4. Políticas Access y autorización interna

Cloudflare Access decide quién puede alcanzar el Worker. D1 decide qué puede hacer cada persona después de entrar. Mantén ambas capas:

- Política Access: limita acceso a usuarios, dominios o grupos permitidos de Keycloak.
- `app_profiles` en D1: asigna rol, estado activo y permisos de PSCV Room.

No copies roles de Keycloak a PSCV Room hasta que exista una estrategia explícita de sincronización y revisión de privilegios. La fuente actual de autorización es D1.

## Diagnóstico del acceso

- `401 Sesión de Cloudflare Access no encontrada`: el hostname no está protegido por Access, la sesión venció o el navegador no alcanzó el Worker por el dominio canónico.
- `403 Perfil no encontrado o no autorizado`: Access autenticó a la persona, pero falta su perfil o está inactivo en D1.
- `500 Cloudflare Access no está configurado`: faltan `ACCESS_TEAM_DOMAIN` o `ACCESS_AUD` en el Worker.
- `500 D1 binding DB no configurado`: el origen no es el Worker `pscv-room` o se publicó sin sus bindings.
- `/api/health`: debe devolver `auth.provider: "cloudflare-access"`, `auth.identityProvider: "keycloak"` y `auth.configured: true` tras configurar el Worker.

## Regla de operación

No mezcles el host de producción entre Vercel y Cloudflare Workers. Si se conserva el proyecto Vercel, retira `app.relnets.com` de sus aliases de producción y usa sus dominios `*.vercel.app` exclusivamente para previews no protegidos.
