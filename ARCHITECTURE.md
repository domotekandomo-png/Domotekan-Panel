# Domotekan — Arquitectura del Sistema

> Documento de referencia. Actualizar cuando cambie estructura, rutas, tablas o flujos.
> Última revisión: 2026-08-04

---

## Ecosistema completo (mapa de proyectos)

Domotekan es un conjunto de proyectos independientes que comparten Supabase como BD y
`domotekan.com` como dominio. Ninguno depende directamente del código de otro, pero sí
comparten tablas y convenciones.

| Proyecto | Carpeta local | Dominio en producción | Stack | Estado |
|---|---|---|---|---|
| **Panel gestión** | `Projects_claude/Vercel` | `panel-gestion.domotekan.com` | HTML+JS + Vercel Serverless | Producción activa |
| **Domotekan Cloud** | Vultr `/opt/domotekan-cloud/` | `cloud.domotekan.com` | Node.js | Producción (v1.7.x) |
| **Panel cliente Next.js** | `Projects_claude/domotekan-panel` | sin URL pública activa | Next.js + WebSocket HA | Desarrollo/laboratorio |
| **Panel Txopo** | `Projects_claude/PANEL DE CONTROL TXOPO` | sin URL pública activa | Next.js + WebSocket HA | Desarrollo |
| **Panel hoteles** | `Projects_claude/hoteles` | posiblemente `hotel.domotekan.com` | Next.js + Supabase | Desarrollo |
| **Guest cloud** | `Projects_claude/guest-cloud` | sin URL pública activa | Next.js + Supabase | Desarrollo/prototipo |
| **HA dashboard** | `Projects_claude/home_assistant` | HA local en 192.168.1.19 | YAML Lovelace | Local/laboratorio |
| **HA laboratorio hoteles** | `Projects_claude/Vercel/ha-lab/` | HA local en 192.168.1.48 | Python + HA WebSocket | Laboratorio |
| **Imagen maestra** | `Projects_claude/Imagen Pi/scripts/` | RPi5 en 192.168.1.19 | Bash | Laboratorio |
| **Agente control** | `Projects_claude/Agente control` | Vercel (sin dominio claro) | Node.js Vercel | Experimental |
| **Precios/catálogo** | `Projects_claude/Precios producto` | — | Python + Holded | Herramienta interna |
| **n8n workflows** | `Projects_claude/n8n` | `n8n.domotekan.com` | n8n | Producción (caja negra) |

---

## 1. Inventario de archivos — repo Vercel

### Archivos en producción (committed + ruteados)

| Archivo | Propósito | Ruta pública | Estado | Dependencias |
|---|---|---|---|---|
| `index.html` | Panel de gestión. Login + tabla instalaciones + ficha + diagnóstico IA + instaladores/empresas | `/gestion` | **Producción** | Supabase, `/api/hw-provision`, `/api/hw-delete`, `/api/diagnose`, `/api/my-ip` |
| `invitacion.html` | Registro de instaladores y trabajadores vía token de un solo uso | `/register?invite=TOKEN` | **Producción** | Supabase (RPCs: `validar_invitacion`, `completar_invitacion`) |
| `panel-estandar.html` | Panel cliente final (residente). Multi-vivienda, control HA por habitaciones | `/` | **Producción** | Supabase, `/api/ha-proxy` |
| `api/hw-provision.js` | Serverless: provisiona instalación via n8n. Verifica sesión + rol admin/superadmin | `/api/hw-provision` | **Producción** | Supabase (service key), n8n webhook, `N8N_PROVISION_TOKEN` |
| `api/hw-delete.js` | Serverless: elimina instalación via n8n. Verifica sesión + rol superadmin | `/api/hw-delete` | **Producción** | Supabase (service key), n8n webhook, `N8N_ADMIN_TOKEN` |
| `api/ha-proxy.js` | Serverless: proxy hacia HA. Acciones: `load_home`, `call_service`, `get_state`, `register_user` | `/api/ha-proxy` | **Producción** | Supabase (service key), HA REST API |
| `api/diagnose.js` | Serverless: diagnóstico IA via Claude Haiku. Lee HA states + errors | `/api/diagnose` | **Producción** | Supabase (service key), HA REST API, Anthropic API |
| `api/my-ip.js` | Serverless: devuelve IP WAN del llamante | `/api/my-ip` | **Producción** | — |
| `api/_ratelimit.js` | Helper interno (no es ruta). Rate limiter Supabase-backed | — (helper) | **Producción** | Supabase (service key), tabla `rate_limits` |
| `api/connector-token.js` | Serverless: genera/devuelve el connector_token de una instalación. Solo admin/superadmin. | `/api/connector-token` | **Pendiente despliegue** | Supabase (service key) |
| `api/heartbeat.js` | Serverless público: verifica hw_id+connector_token, UPSERT en heartbeats | `/api/heartbeat` | **Pendiente despliegue** | Supabase (service key), sql/07 aplicado |
| `domoconector/domoconector.py` | Script Python del conector. Se descarga desde el panel. | `/domoconector.py` (via rewrite) | **Pendiente despliegue** | Ninguna (stdlib Python 3.7+) |
| `domoconector/config.json.example` | Plantilla de configuración para el instalador | — (asset local) | **Pendiente despliegue** | — |
| `domoconector/README.md` | Guía de instalación del conector | — (asset local) | **Pendiente despliegue** | — |
| `vercel.json` | Rewrites de rutas + headers de seguridad | — | **Producción** | — |
| `logo.png` | Logo Domotekan | — (asset) | **Producción** | — |
| `manifest.json` | PWA manifest | — (asset) | **Producción** | — |
| `sql/invitaciones_rpc.sql` | RPCs: `validar_invitacion`, `completar_invitacion`, `crear_invitacion` | — | **Aplicado en Supabase** | Supabase |

### Archivos sin ruta pública (no accesibles en producción)

| Archivo | Propósito | Estado | Notas |
|---|---|---|---|
| `panel-ander.html` | Variante personal del panel de gestión | **Local / sin ruta** | Committed pero sin rewrite en vercel.json |
| `panel-asier-demo.html` | Demo comercial estático. Datos 100% hardcodeados | **Local / demo comercial** | Committed pero sin ruta pública |
| `index.html.bak` | Backup del panel de gestión | **Ignorar** | Residuo de edición |
| `ha-lab/create_hotel_lab.py` | Script Python que inyecta 160 entidades de laboratorio hotelero en HA via WebSocket | **Laboratorio local** | Conecta a `ws://192.168.1.48:8123` |
| `ha-lab/hotel_clima.yaml` | YAML generado por el script anterior (20 entidades climate) | **Laboratorio local** | Se copia manualmente a `/config/packages/` en el HA del lab |
| `ha-lab/hotel_laboratorio.yaml` | YAML de laboratorio hotelero adicional | **Laboratorio local** | — |

### Migrations SQL (pendientes de aplicar en Supabase)

| Archivo | Qué hace | Estado |
|---|---|---|
| `sql/07_connector_token.sql` | Añade `hardware_devices.connector_token` (UNIQUE), `heartbeats.connector_version`, desduplicación de heartbeats, UNIQUE CONSTRAINT `heartbeats_hw_id_unique` | **NO aplicado — ejecutar antes de desplegar Domoconector** |
| `sql/02_empresas_schema.sql` | Crea tabla `empresas`, añade `empresa_id` FK a `usuarios` y `hardware_devices` | **NO aplicado** |
| `sql/03_empresas_migracion.sql` | Crea una empresa por cada admin/instalador existente. NO backfilla `hardware_devices` | **NO aplicado** |
| `sql/04_empresas_rpc.sql` | Reemplaza `crear_invitacion` con límite de 3 empleados, añade `invitaciones_restantes()`, `completar_invitacion` con empresa, `listar_empresas()` | **NO aplicado** |

---

## 2. Inventario de rutas (vercel.json)

### Rewrites HTML

| URL pública | Archivo servido |
|---|---|
| `panel-gestion.domotekan.com/gestion` | `index.html` |
| `panel-gestion.domotekan.com/register?invite=TOKEN` | `invitacion.html` |
| `panel-gestion.domotekan.com/domoconector.py` | `domoconector/domoconector.py` (descarga del conector) |
| `panel-gestion.domotekan.com/` | `panel-estandar.html` |

### Rutas API (Vercel Serverless)

| Endpoint | Archivo | Método |
|---|---|---|
| `/api/hw-provision` | `api/hw-provision.js` | POST |
| `/api/hw-delete` | `api/hw-delete.js` | POST |
| `/api/ha-proxy` | `api/ha-proxy.js` | POST |
| `/api/diagnose` | `api/diagnose.js` | POST |
| `/api/my-ip` | `api/my-ip.js` | GET |
| `/api/connector-token` | `api/connector-token.js` | POST |
| `/api/heartbeat` | `api/heartbeat.js` | POST |

### Archivos sin ruta definida

`panel-ander.html`, `panel-asier-demo.html`, `ha-lab/*`, `sql/*`, `index.html.bak`
→ No son accesibles en producción. No aparecen en `vercel.json`.

---

## 3. Inventario de APIs

### POST `/api/hw-provision`

| Campo | Valor |
|---|---|
| Autenticación | Supabase session (`auth_token` en body) |
| Roles permitidos | `superadmin`, `admin` (+ `activo = true`) |
| Tablas Supabase | `usuarios` (lectura rol/activo), `audit_log` (escritura fire-and-forget) |
| Servicios externos | n8n `POST /webhook/provisionar` con header `X-Admin-Token` |
| Env vars requeridas | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `N8N_PROVISION_TOKEN` |
| Env vars opcionales | `N8N_WEBHOOK_PROVISION` (URL con fallback hardcodeado) |
| Payload recibido | `{ hw_id, client_name, alias, direccion, cp, comunidad, pais, assigned_by, auth_token }` |
| Respuesta OK | El JSON que devuelva n8n (normalmente `{ ok: true, client_url, wg_ip, ... }`) |
| Estado n8n | n8n aún NO tiene Header Auth configurado — pendiente de configurar |

### POST `/api/hw-delete`

| Campo | Valor |
|---|---|
| Autenticación | Supabase session (`auth_token` en body) |
| Roles permitidos | Solo `superadmin` |
| Tablas Supabase | `usuarios` (lectura rol), `audit_log` (escritura) |
| Servicios externos | n8n `POST /webhook/hw-delete` con header `X-Admin-Token` |
| Env vars requeridas | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `N8N_DELETE_TOKEN` |
| Env vars opcionales | `N8N_WEBHOOK_DELETE` |
| Nota seguridad | Token en header `X-Admin-Token` (igual que hw-provision). Nunca en body JSON. |

### POST `/api/ha-proxy`

| Campo | Valor |
|---|---|
| Autenticación | Supabase session (`auth_token` en body) |
| Roles permitidos | Cualquier usuario autenticado en `instalacion_usuarios` para ese `hw_id` |
| Tablas Supabase | `hardware_devices` (lectura: `ha_token`, `client_url`, `status`, `pin_seguridad`, `max_usuarios`), `instalacion_usuarios` (lectura + escritura) |
| Servicios externos | HA REST API (usando `client_url` + `ha_token` leídos del backend) |
| Env vars requeridas | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Acciones | `load_home` (30 req/min por usuario), `call_service`, `get_state`, `register_user` |
| CORS | Permite cualquier `*.domotekan.com` |

### POST `/api/diagnose`

| Campo | Valor |
|---|---|
| Autenticación | Supabase session (`auth_token` en body) |
| Roles permitidos | Cualquier usuario autenticado (sin check de rol) |
| Tablas Supabase | `hardware_devices` (lectura: `ha_token`, `client_url`), `rate_limits` (lectura+escritura) |
| Servicios externos | HA REST API (`/api/states`, `/api/error/all`), Anthropic API (Claude Haiku) |
| Env vars requeridas | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` |
| Rate limit | 5 diagnósticos/minuto por usuario (por últimos 16 chars del token) |

### GET `/api/my-ip`

| Campo | Valor |
|---|---|
| Autenticación | Ninguna |
| Propósito | Devuelve `x-forwarded-for` del llamante. Usado en el alta para guardar WAN IP |
| Env vars | Ninguna |

### `api/_ratelimit.js` (helper, no ruta)

Rate limiter basado en tabla `rate_limits`. Limpia entradas > 5 minutos (fire-and-forget). Falla abierto (permite si la BD no responde).

---

## 4. Inventario de SQL

### `sql/05_rls_hardware_devices.sql` — APLICADO (2026-07-25)

Activa RLS en `hardware_devices`. Elimina la policy genérica anterior (`hw_devices_auth FOR ALL`) y crea dos policies SELECT granulares:
- `hw_superadmin_lee_todo`: superadmin ve todos los devices sin filtro
- `hw_empresa_lee_propios`: admin/user ven solo los devices de su `empresa_id`

**Efecto:** Multi-tenant isolation. Sin esta migration, todos los admins veían todas las instalaciones.

### `sql/06_rls_hw_write.sql` — APLICADO (2026-07-25)

Añade policies de escritura a `hardware_devices` (requiere que 05 esté aplicado):
- `hw_superadmin_actualiza_todo`: superadmin puede UPDATE cualquier device
- `hw_superadmin_borra_todo`: superadmin puede DELETE cualquier device

**Por qué es necesario:** Con RLS activo y sin policies de UPDATE, el `UPDATE` desde el browser retornaba éxito pero afectaba 0 filas. La función `asignarEmpresaHardware()` mostraba "Empresa actualizada" aunque no guardaba nada.

---

### `sql/invitaciones_rpc.sql` — APLICADO

| Función | Firma | Qué hace |
|---|---|---|
| `validar_invitacion` | `(p_token text) → text` | Verifica token no expirado, devuelve rol que tendrá el nuevo usuario. Borra tokens expirados. |
| `completar_invitacion` | `(p_token, p_user_id, p_email, p_nombre) → text` | Inserta en `usuarios`, borra token. 4 parámetros (versión sin empresa). |
| `crear_invitacion` | `() → text` | Verifica rol del caller, inserta en `invitaciones` con 5 min de expiración. Solo superadmin/admin. |

**Riesgo si no estuviera aplicado:** el flujo de invitaciones no funcionaría en absoluto.

### `sql/02_empresas_schema.sql` — PENDIENTE

Crea `public.empresas (id, nombre, creado_en)` y añade `empresa_id uuid FK` a `usuarios` y `hardware_devices`.

**Riesgo si no se aplica:** el frontend ya llama a `listar_empresas()` y usa `empresa_id`. Las llamadas a `listar_empresas()` fallarán (la función no existe). El campo `empresa_id` no existe en las tablas, los SELECT lo ignorarán y los UPDATE lo rechazarán silenciosamente.

**Riesgo de aplicarlo:** es aditivo y nullable. No rompe nada existente.

### `sql/03_empresas_migracion.sql` — PENDIENTE

Migración de datos: crea una empresa por cada admin/instalador existente sin `empresa_id`.

**Riesgo si no se aplica:** los admin existentes quedan sin empresa_id; `listar_empresas()` los mostraría sin empresa.

**Riesgo de aplicarlo:** idempotente, seguro. Hardware existente queda con `empresa_id = null` (intencional — asignación manual posterior).

### `sql/04_empresas_rpc.sql` — PENDIENTE

Reemplaza/añade: `crear_invitacion` (con límite 3 empleados), `invitaciones_restantes()`, `completar_invitacion` con 5 parámetros (con empresa), `listar_empresas()`.

**Riesgo si no se aplica:**
- El botón de invitar no muestra cupo restante
- El alta de admin no crea empresa
- El alta de user no hereda empresa_id
- `listar_empresas()` no existe → sección Instaladores/Empresas falla silenciosamente

**Orden de ejecución obligatorio:** 02 → 03 → 04 (la 04 referencia `empresas` que crea la 02).

---

## 5. Flujos principales

### Alta de instalación

```
[Panel gestión] Admin: modal "Alta nueva instalación"
    │ hw_id, client_name, alias, direccion, cp, comunidad, pais
    ▼
[Frontend] sb.auth.getSession() → auth_token
    │
    ▼
POST /api/hw-provision
    ├── Verifica sesión Supabase (auth_token)
    ├── Verifica rol admin/superadmin en tabla usuarios
    └── POST n8n.domotekan.com/webhook/provisionar
            Header: X-Admin-Token: N8N_PROVISION_TOKEN [pendiente activar en n8n]
            Body: { hw_id, client_name, alias, direccion, cp, comunidad, pais, assigned_by }
            │
            n8n (externo, caja negra):
            ├── Genera par de claves WireGuard
            ├── Registra peer en servidor VPS
            ├── Crea entrada Nginx Proxy Manager + HTTPS
            └── Guarda fila en hardware_devices (hw_id, client_url, wg_client_ip, status='active')
            │
            └── Devuelve { ok: true, client_url, wg_ip, slug }
    │
    ▼
[api/hw-provision] audit_log INSERT hw_create (fire-and-forget)
    │
    ▼
[Frontend] GET /api/my-ip → wan_ip
    │
    ▼
[Frontend] sb.from('hardware_devices').update({ wan_ip, empresa_id }) WHERE hw_id
    │
    ▼
UI: muestra client_url, recarga tabla, cierra modal
```

**Gaps conocidos:**
- n8n Header Auth pendiente de configurar → webhook todavía abierto a llamadas directas
- Descarga config WireGuard del RPi: paso manual fuera del sistema
- Instalación del conector Python en HA: manual
- Primer heartbeat / sincronización de entidades: manual

---

### Borrado de instalación

```
[Panel gestión] superadmin: confirma borrado
    │ hw_id
    ▼
[Frontend] sb.auth.getSession() → auth_token
    │
    ▼
POST /api/hw-delete
    ├── Verifica sesión Supabase
    ├── Verifica rol = superadmin (solo superadmin puede borrar)
    └── POST n8n.domotekan.com/webhook/hw-delete
            Body: { hw_id, admin_token: N8N_ADMIN_TOKEN }
            │
            n8n: elimina WG peer + NPM entry + fila hardware_devices
    │
    ▼
audit_log INSERT hw_delete (fire-and-forget backend)
    │
    ▼
UI: recarga tabla
```

**Nota seguridad:** `N8N_DELETE_TOKEN` va en header `X-Admin-Token`, no en el body.

---

### Onboarding de cliente con HA existente

Flujo actual: pasos automáticos + pasos manuales pendientes de automatizar.

```
[Superadmin/Admin] Panel gestión → "Dar de alta instalación"
    │ hw_id (ej. 0626-0004), nombre, dirección
    ▼
POST /api/hw-provision → n8n
    │ n8n hace automáticamente:
    ├── Genera par de claves WireGuard (privada + pública)
    ├── Registra peer en servidor VPS
    ├── Crea entrada Nginx Proxy Manager + HTTPS
    └── Guarda en hardware_devices: client_url, wg_client_ip, status='active'
    │
    ▼
[Superadmin] asigna empresa_id al device desde panel Hardware
    │
    ▼
[Manual] Instalar WireGuard en el RPi/HA del cliente
    │ - Copiar config WireGuard generada por n8n al RPi
    │ - Activar interfaz WireGuard en HA OS
    ▼
[Manual] Instalar conector Python en HA
    │ - Copiar domotekan_sse_connector.py a /config en HA OS
    │ - Configurar hw_id + token
    │ - Arrancar (vía automation o shell_command en HA)
    ▼
[Sistema] Primer heartbeat aparece en dashboard
    │ Verifica: CPU, RAM, estado = online
    ▼
[Cliente] Accede a su panel en client_url (panel-estandar.html)
    │ - Se registra con email + contraseña + HW ID (del QR o email)
    │ - Introduce PIN si la instalación lo tiene
    └── Accede al panel de control de su hogar
```

**Gaps activos (a automatizar):**
- Descarga de config WireGuard: hoy es manual; debería generarse en n8n y enviarse por email o mostrarse en el panel
- Instalación del conector Python: hoy es manual SSH; debería ser un script de un paso o addon de HA
- QR de acceso al panel cliente: pendiente de generar y enviar automáticamente

---

### Invitación de admin/user

```
[Panel gestión] admin o superadmin: clic "Generar enlace"
    │
    ▼
[Frontend] sb.rpc('crear_invitacion')   [SECURITY DEFINER]
    ├── Verifica rol del caller (auth.email())
    ├── Si 04 no aplicado: sin límite de empleados
    ├── Si 04 aplicado: admin → máx 3 users por empresa
    └── INSERT invitaciones (token 16 chars, expira 5 min)
    │
    ▼
[Frontend] construye URL: /register?invite=TOKEN
[Admin envía enlace por email/WhatsApp al nuevo usuario]
    │
    ▼
[Nuevo usuario] abre /register?invite=TOKEN
    │
    ▼
[invitacion.html]
    ├── sb.rpc('validar_invitacion', { p_token }) → rol a crear
    ├── Muestra formulario con pill de rol
    │
    ▼
[Usuario rellena: nombre, email, empresa (si admin), contraseña]
    │
    ▼
sb.auth.signUp(email, password)
    ├── OK → user_id disponible
    └── Error "User already registered" → flujo no implementado (pendiente)
    │
    ▼
sb.rpc('completar_invitacion', { p_token, p_user_id, p_email, p_nombre, p_empresa_nombre })
    ├── Si 04 aplicado:
    │   ├── rol=admin → INSERT empresas, INSERT usuarios con empresa_id nuevo
    │   └── rol=user  → hereda empresa_id del admin invitador
    └── Si solo 01 aplicado: INSERT usuarios sin empresa_id
    │
    ▼
Redirige a /gestion (si sesión activa) o muestra botón manual
```

---

### Login panel de gestión (index.html)

```
[Usuario] introduce email + contraseña
    │
    ▼
sb.auth.signInWithPassword(email, password)
    ├── Error → muestra mensaje
    └── OK → session disponible
    │
    ▼
sb.from('usuarios').select('*').eq('email', email)
    ├── Sin fila → "Sin acceso. Contacta con el administrador."
    └── Con fila → rol, nombre, empresa_id
    │
    ▼
initApp(user):
    ├── Oculta secciones .superadmin-only si rol ≠ superadmin
    ├── loadDashboard() → stats de hardware_devices + heartbeats
    ├── loadServers()   → tabla de instalaciones
    └── loadInstallers() → tabla instaladores (llama listar_empresas RPC si superadmin)
```

---

### Login panel cliente (panel-estandar.html)

```
[Usuario] introduce nombre + email + contraseña + HW ID (del QR)
    │
    ▼
sb.auth.signUp(email, password)
    ├── OK → session
    └── "User already registered" → sb.auth.signInWithPassword(email, password) → session
    │
    ▼
POST /api/ha-proxy { action: 'register_user', hw_id, auth_token, payload: { nombre, pin } }
    ├── Verifica PIN si la instalación lo tiene
    ├── Comprueba si ya está en instalacion_usuarios (idempotente)
    ├── Verifica límite max_usuarios (default 5)
    └── INSERT instalacion_usuarios { hw_id, email, nombre }
    │
    ▼
POST /api/ha-proxy { action: 'load_home', hw_id, auth_token }
    ├── Lee ha_token + client_url desde hardware_devices (service key)
    ├── GET HA /api/template areas()
    ├── GET HA /api/states
    └── Devuelve { server_name, areas: [{ id, name, entities }] }
    │
    ▼
Panel muestra habitaciones y dispositivos
```

---

### Control de Home Assistant (panel cliente)

```
[Usuario] toca botón (luz, persiana, clima)
    │
    ▼
POST /api/ha-proxy {
    action: 'call_service',
    hw_id,
    auth_token,
    payload: { domain, service, entity_id, service_data }
}
    ├── Verifica sesión
    ├── Verifica instalacion_usuarios (acceso autorizado)
    ├── Lee ha_token + client_url (service key, nunca al browser)
    ├── Valida domain ∈ [light, switch, cover, climate, sensor, binary_sensor, input_boolean, fan]
    └── POST HA /api/services/{domain}/{service} { entity_id, ...service_data }
    │
    ▼
UI: estado optimista (actualización inmediata)
    │
    ▼ (refresco puntual)
POST /api/ha-proxy { action: 'get_state', hw_id, auth_token, payload: { entity_id } }
    └── GET HA /api/states/{entity_id} → estado real
```

---

### Diagnóstico IA

```
[Panel gestión] admin: clic "Diagnosticar" en ficha de instalación
    │ server_id (uuid de hardware_devices)
    ▼
POST /api/diagnose { server_id, auth_token }
    ├── Rate limit: 5 req/min por usuario
    ├── Verifica sesión Supabase
    ├── Lee ha_token + client_url desde hardware_devices (service key)
    ├── GET HA /api/states → entidades unavailable/unknown
    ├── GET HA /api/error/all → errores del sistema
    └── POST Anthropic API (Claude Haiku):
            Prompt: entidades caídas + errores HA → informe en 4 secciones
    │
    ▼
Respuesta: { diagnosis, ha_reachable, unavailable_count, error_count }
    │
    ▼
Panel muestra el informe con formato markdown
```

---

## 6. Clasificación final

### Producción crítica — no tocar sin prueba

| Elemento | Por qué es crítico |
|---|---|
| `api/ha-proxy.js` | Toda la funcionalidad del panel cliente pasa por aquí |
| `api/hw-provision.js` | Alta de instalaciones. Acaba de migrar a backend seguro |
| `api/hw-delete.js` | Única vía de borrado autorizado |
| `panel-estandar.html` | Panel en uso por clientes reales |
| `index.html` | Panel en uso por instaladores/admins |
| `invitacion.html` | Flujo de alta de instaladores |
| `vercel.json` | Romper esto hace caer todo el routing |
| `sql/invitaciones_rpc.sql` | Aplicado en Supabase. Las RPCs están en uso |
| Tabla `hardware_devices` | Central para todo. Cualquier migración requiere cuidado extremo |
| Tabla `heartbeats` | Usada por el dashboard y la ficha de instalación |
| Tabla `instalacion_usuarios` | Multi-vivienda del panel cliente |
| Tabla `usuarios` | Sistema de roles |

### Demo comercial

| Elemento | Notas |
|---|---|
| `panel-asier-demo.html` | Sin ruta pública. Datos hardcodeados. Solo para mostrar en reuniones comerciales. No está en producción. |

### Laboratorio / local

| Elemento | Notas |
|---|---|
| `ha-lab/create_hotel_lab.py` | Script de laboratorio. Conecta a IP local (192.168.1.48). No tiene uso en producción. |
| `ha-lab/hotel_clima.yaml` | Generado por el script anterior. Local. |
| `ha-lab/hotel_laboratorio.yaml` | Local. |
| `Projects_claude/home_assistant/` | Dashboard HA del laboratorio personal (192.168.1.19). No relacionado con producción. |
| `Projects_claude/Imagen Pi/scripts/` | Scripts de boot para imagen maestra del RPi5. Laboratorio. |

### Desarrollo / prototipos (otros proyectos)

| Proyecto | Estado | Relación con producción |
|---|---|---|
| `Projects_claude/domotekan-panel` | Next.js, WebSocket directo a HA. Prototipo de panel cliente más avanzado que `panel-estandar.html` | Ninguna, es paralelo |
| `Projects_claude/PANEL DE CONTROL TXOPO` | Next.js, variante para Asier Txopo. WebSocket HA. | Ninguna |
| `Projects_claude/hoteles` | Next.js, gestión hotelera. `hotel_id='pino-0002'`, tabla `room_states`. | Comparte Supabase pero tablas distintas |
| `Projects_claude/guest-cloud` | Next.js, panel de huéspedes por `guest_token`. Prototipo. | Comparte Supabase (`room_states`) |
| `Projects_claude/Agente control` | Vercel + Node.js. `agent-writer.js`. Experimental. | Ninguna clara |
| `Projects_claude/Precios producto` | Scripts Python para catálogo/Holded. | Ninguna (herramienta de negocio) |
| `Projects_claude/n8n` | Carpeta con solo `.claude/`. Sin código visible. | Referencia a n8n.domotekan.com |

### Pendiente de revisar / decidir

| Elemento | Decisión pendiente |
|---|---|
| `panel-ander.html` | ¿Tiene uso? ¿Necesita ruta propia en vercel.json? ¿O se puede eliminar? |
| `index.html.bak` | Borrar cuando se confirme que `index.html` es estable |
| `Projects_claude/domotekan-panel` vs `panel-estandar.html` | ¿Cuál es el futuro del panel cliente? |
| `Projects_claude/guest-cloud` vs `Projects_claude/hoteles` | Dos proyectos de huéspedes de hotel distintos. ¿Cuál avanza? |

### Candidatos a borrar / archivar (sin riesgo de producción)

| Elemento | Condición para borrar |
|---|---|
| `index.html.bak` | Inmediato — es un backup de sesión sin valor |
| `ha-lab/hotel_laboratorio.yaml` | Si el lab de hoteles está completo con `hotel_clima.yaml` |
| `Projects_claude/Agente control` | Si no tiene un propósito claro definido |

---

## 7. Variables de entorno requeridas en Vercel

| Variable | Usada en | Descripción | Estado |
|---|---|---|---|
| `SUPABASE_URL` | Todos los endpoints | URL del proyecto Supabase | Configurada |
| `SUPABASE_SERVICE_KEY` | Todos los endpoints | Service role key (nunca al browser) | Configurada |
| `ANTHROPIC_API_KEY` | `api/diagnose.js` | API key de Anthropic para Claude Haiku | Configurada |
| `N8N_DELETE_TOKEN` | `api/hw-delete.js` | Token para el webhook de borrado de n8n (header `X-Admin-Token`) | Configurada |
| `N8N_PROVISION_TOKEN` | `api/hw-provision.js` | Token para el webhook de provisioning (header `X-Admin-Token`) | **PENDIENTE — añadir** |
| `N8N_WEBHOOK_DELETE` | `api/hw-delete.js` | URL del webhook hw-delete (opcional, tiene fallback) | Opcional |
| `N8N_WEBHOOK_PROVISION` | `api/hw-provision.js` | URL del webhook provisionar (opcional, tiene fallback) | Opcional |

---

## 8. Recomendación de orden de limpieza

### Hacer ya (sin riesgo, bajo esfuerzo)

1. **Añadir `N8N_PROVISION_TOKEN` en Vercel** → provisioning sigue sin verificación de token en n8n.
2. **Configurar Header Auth en n8n WF5 y WF3** → cerrar los webhooks de provisioning y borrado.
3. **Borrar `index.html.bak`** → residuo sin valor.
4. **Decidir qué hacer con `panel-ander.html`** → añadir ruta o gitignore.
5. **Crear tabla `audit_log` en Supabase** → las llamadas fire-and-forget en hw-provision.js y hw-delete.js fallan silenciosamente sin esta tabla.
6. **Cerrar anon INSERT/UPDATE en heartbeats** — condición previa: validar que `api/heartbeat.js` funciona en producción (al menos un heartbeat real recibido). Una vez validado, revocar las policies anon de escritura en `heartbeats`. El endpoint usa `SUPABASE_SERVICE_KEY` (bypassa RLS), así que no depende de esas policies. El panel lee con JWT autenticado (`authenticated` role). No hay conector existente que use la anon key. **No hacerlo antes de validar el endpoint para no bloquear una fallback no prevista.**

### Hacer pronto (bajo riesgo, impacto visible)

6. **Ejecutar migrations SQL 02 → 03 → 04** en Supabase en orden.  
   Condición previa: verificar con `SELECT * FROM pg_tables WHERE tablename = 'empresas'` que la tabla no existe.  
   Resultado: sección Instaladores/Empresas del panel quedará completamente funcional.

7. **Resolver "User already registered" en invitacion.html** → Fase 2 del backlog.  
   Afecta a cualquier persona que tenga cuenta de cliente final e intente registrarse como instalador.

8. **Automatizar onboarding HA** → WireGuard config download + Python connector install son pasos manuales hoy. Ver sección "Onboarding de cliente con HA existente".

### Hacer cuando haya claridad de producto

7. **Decidir el futuro del panel cliente** → `panel-estandar.html` (HTML simple) vs `domotekan-panel` (Next.js + WebSocket). Son dos implementaciones del mismo concepto.

8. **Unificar los proyectos de hotel** → `hoteles` y `guest-cloud` son dos proyectos de gestión hotelera paralelos. Definir cuál avanza y archivar el otro.

9. **Mover `ha_token` update a backend** → actualmente `index.html` actualiza `ha_token` directo en Supabase con la anon key. Moverlo a un endpoint serverless que verifique rol.

10. **Consistencia de autenticación en n8n** → `hw-delete` envía el token en el body JSON. `hw-provision` lo envía en header `X-Admin-Token`. Normalizar uno de los dos una vez que ambos webhooks estén asegurados.

---

## Supabase — tablas usadas por el repo Vercel

| Tabla | Quién escribe | Quién lee | Notas |
|---|---|---|---|
| `hardware_devices` | n8n (provisionamiento), `index.html` (edición), `api/hw-delete.js` | `api/ha-proxy.js`, `api/diagnose.js`, `index.html` | Central del sistema. Contiene `ha_token` sensible. RLS activo con aislamiento por `empresa_id` (sql/05 + sql/06 aplicados). |
| `heartbeats` | `api/heartbeat.js` (service key, UPSERT por hw_id) | `index.html` (dashboard + ficha) | **Tabla de estado actual, no de histórico.** Exactamente 1 fila por hw_id, actualizada con cada heartbeat. UNIQUE CONSTRAINT `heartbeats_hw_id_unique` en hw_id. El dashboard detecta "online" si `recibido_en` < 7 min. |
| `usuarios` | `completar_invitacion()` RPC | `index.html` (login + rol), `api/hw-provision.js`, `api/hw-delete.js` | Roles: superadmin, admin, user |
| `invitaciones` | `crear_invitacion()` RPC | `validar_invitacion()` RPC | Tokens de 5 min, un solo uso |
| `instalacion_usuarios` | `api/ha-proxy.js` (register_user) | `api/ha-proxy.js` (access check), `panel-estandar.html` | Multi-vivienda |
| `audit_log` | `api/hw-provision.js`, `api/hw-delete.js`, `index.html` (directo frontend) | Solo consulta manual | INSERT directo desde frontend es deuda técnica |
| `rate_limits` | `api/_ratelimit.js` | `api/_ratelimit.js` | Limpieza automática > 5 min |
| `empresas` | `completar_invitacion()` RPC (cuando sql/04 esté aplicado) | `listar_empresas()` RPC | **Tabla no existe todavía en Supabase** |

---

*Fin del documento. Actualizar en cada cambio estructural relevante.*
