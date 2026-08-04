# Guía de instalación del Domoconector

**Para instaladores de Domotekan — Home Assistant existente**

---

## ¿Para qué sirve el Domoconector?

El Domoconector es un script Python que se ejecuta en el Home Assistant del cliente y envía una señal periódica al panel de gestión de Domotekan.

Esto permite:

- Saber si el servidor del cliente está **online u offline** desde el panel
- Ver métricas básicas en tiempo real: CPU, RAM, disco y temperatura
- Detectar caídas sin necesidad de acceder remotamente al equipo

**Lo que el Domoconector NO hace:**

- **No configura el acceso remoto HTTPS.** Que el panel muestre "Online" no significa que puedas conectarte al Home Assistant. Eso requiere WireGuard + Nginx, que es un sistema separado.
- **No sustituye a WireGuard.** El Domoconector solo envía una señal de estado. No abre ningún puerto, no crea ningún túnel.

---

## ¿Cuándo usar esta guía?

Úsala cuando el cliente ya tiene un **Home Assistant instalado y funcionando** y quieres conectarlo al panel de Domotekan.

> Esta guía **no aplica** a la futura Domotekan Box preconfigurada. En ese caso el conector ya vendrá instalado de fábrica y solo habrá que activar el HW ID desde el panel.

---

## Paso 1 — Descargar los ficheros desde el panel

1. Entra en `panel-gestion.domotekan.com/gestion` con tu usuario de instalador
2. Ve a **Servidores** y haz clic en la ficha de la instalación del cliente
3. Desplázate hasta la sección **Domoconector**
4. Haz clic en **Descargar config.json**
   - Se descarga un fichero llamado `config-HWID.json` con todos los datos ya rellenos: HW ID, token, URL y el intervalo de envío
5. Haz clic en **Descargar domoconector.py**
   - Se descarga el script Python del conector

Antes de continuar, **renombra** `config-HWID.json` a `config.json`.

---

## Paso 2 — Copiar los ficheros al Home Assistant

Conéctate al HA del cliente (por SSH, SFTP, File Editor o Samba) y crea la carpeta del conector:

```bash
mkdir -p /config/domoconector
```

Copia los dos ficheros a esa carpeta:

```
/config/domoconector/
  domoconector.py
  config.json
```

---

## Paso 3 — Instalar psutil (opcional)

Sin `psutil`, el conector funciona pero no envía métricas de CPU, RAM, disco ni temperatura (aparecen como `—` en el panel).

```bash
pip3 install psutil
```

En HA OS puede ser necesario usar:

```bash
/usr/bin/python3 -m pip install psutil
```

---

## Paso 4 — Probar manualmente

```bash
cd /config/domoconector
python3 domoconector.py
```

En los primeros segundos deberías ver algo así:

```
2026-08-04 10:00:00 [INFO] Domoconector v1.0.0 iniciando...
2026-08-04 10:00:00 [INFO] HW ID   : 0626-0001
2026-08-04 10:00:00 [INFO] URL     : https://panel-gestion.domotekan.com/api/heartbeat
2026-08-04 10:00:00 [INFO] Intervalo: 120s
2026-08-04 10:00:00 [INFO] Heartbeat OK | CPU: 12.3% | RAM: 48.7% | Disco: 22.1% | Temp: 51.0°C
```

Si ves `Heartbeat OK`, el conector funciona. En menos de un minuto el panel mostrará el badge **Online** en la ficha de la instalación.

Para detenerlo: `Ctrl+C`.

---

## Paso 5 — Arranque automático

> **Aviso:** El método siguiente es una solución provisional para el MVP.
> Si se ejecuta varias veces (por ejemplo, cada vez que HA arranca) puede dejar varios procesos Python activos a la vez.
> El objetivo a largo plazo es convertir el Domoconector en un **add-on oficial de Home Assistant**, que gestiona el proceso de forma limpia. Por ahora, este método es suficiente para producción controlada.

**Añadir en `/config/configuration.yaml`:**

```yaml
shell_command:
  start_domoconector: "nohup python3 /config/domoconector/domoconector.py >> /config/domoconector/domoconector.log 2>&1 &"
```

**Añadir la automatización** (en `/config/automations.yaml` o desde la UI de HA):

```yaml
- alias: "Iniciar Domoconector al arrancar HA"
  trigger:
    - platform: homeassistant
      event: start
  action:
    - service: shell_command.start_domoconector
```

Después de guardar: **Herramientas para desarrolladores → Recargar configuración de YAML**, o reinicia HA.

El log queda en `/config/domoconector/domoconector.log`.

---

## Paso 6 — Método viejo de heartbeat: qué quitar y qué no tocar

Si el cliente tenía configurado el heartbeat antiguo (mediante `rest_command` y una automatización en HA), ya puedes eliminar esas partes porque ahora el conector Python lo hace todo.

**Puedes eliminar:**

- La entrada `domotekan_connector_token` en `secrets.yaml` (el token ahora está en `config.json`)
- El token de HA que se usaba solo para el heartbeat (si no se usa para otra cosa)
- La sección `rest_command: domotekan_heartbeat` en `configuration.yaml`
- La automatización que lanzaba el heartbeat periódicamente

**No toques:**

- `configuration.yaml: http: trusted_proxies: 10.10.0.0/24` — esta línea es necesaria para el acceso remoto HTTPS, no para el heartbeat. Si la eliminas y hay WireGuard configurado, el panel del cliente dejará de funcionar.
- Cualquier otra configuración relacionada con WireGuard o Nginx.

---

## WireGuard y acceso remoto — son dos sistemas distintos

| Sistema | Para qué sirve | ¿Necesita el otro? |
|---|---|---|
| **Domoconector** | Señal de estado online/offline + métricas | No necesita WireGuard |
| **WireGuard + Nginx** | Acceso remoto HTTPS al panel del cliente | No necesita el Domoconector |

El Domoconector envía tráfico **saliente** desde el RPi hacia internet (`panel-gestion.domotekan.com`). Solo necesita que el equipo tenga conexión a internet.

WireGuard crea un túnel que permite tráfico **entrante** desde el VPS hasta el HA del cliente (puerto 8123). Eso es lo que hace funcionar la URL `clienteXXXX.domotekan.com` y el botón "Conectar al servidor" del panel de gestión.

**Hoy, la instalación de WireGuard sigue siendo un proceso manual.** El conector no lo automatiza ni lo sustituye.

---

## Checklist final

Antes de dar la instalación por terminada, verifica cada punto:

- [ ] `/config/domoconector/config.json` existe y tiene `hw_id`, `connector_token`, `heartbeat_url`
- [ ] `/config/domoconector/domoconector.py` existe
- [ ] `python3 domoconector.py` arranca sin errores
- [ ] El log muestra `Heartbeat OK` en los primeros 10 segundos
- [ ] El panel de gestión muestra el badge **Online** en la ficha de la instalación
- [ ] Prueba de token malo: si modificas `connector_token` en `config.json` con un valor inventado, el log debe mostrar `Error HTTP 401`
- [ ] La automatización de arranque está configurada y HA la carga sin errores
- [ ] Si el cliente tiene acceso remoto HTTPS: comprobar que `trusted_proxies` sigue en `configuration.yaml` y que la URL del cliente responde

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Error HTTP 401` | Token o HW ID incorrecto | Descarga de nuevo el `config.json` desde el panel |
| `Error HTTP 403` | Instalación marcada como inactiva | Verificar `status` en la ficha del panel |
| `Error de red` | Sin conexión a internet | Verificar que el RPi tiene salida a internet |
| Métricas aparecen como `—` | `psutil` no instalado | `pip3 install psutil` |
| Panel sigue mostrando Offline | Menos de 7 minutos desde el primer heartbeat | Esperar al siguiente ciclo (120 s por defecto) |
| URL remota del cliente no responde | WireGuard no configurado o `trusted_proxies` eliminado | Revisar configuración WireGuard y `configuration.yaml` |
