# Domoconector

Agente de heartbeat para Domotekan. Se instala en el Home Assistant del cliente y envía métricas periódicas (CPU, RAM, disco, temperatura) al panel de gestión.

## Requisitos

- Python 3.7 o superior
- Acceso SSH al Home Assistant (addon "SSH & Web Terminal" recomendado)
- `psutil` opcional: `pip3 install psutil` para métricas de sistema

## Instalación

### 1. Obtener los archivos desde el panel

En el panel de gestión → Servidores → clic en la instalación → sección **Domoconector**:

1. Clic en **Descargar config.json** → descarga un `config-HWID.json` pre-rellenado
2. Clic en **Descargar domoconector.py** → descarga el script

Renombra `config-HWID.json` a `config.json`.

### 2. Copiar al Home Assistant

Conecta por SSH al HA del cliente y copia los archivos a `/config/domoconector/`:

```bash
mkdir -p /config/domoconector
# Copiar usando scp, SFTP, o el addon File Editor
```

Estructura resultante:
```
/config/domoconector/
  domoconector.py
  config.json
```

### 3. Instalar psutil (opcional pero recomendado)

```bash
pip3 install psutil
```

En HA OS puede ser necesario usar el entorno de Python del sistema:

```bash
/usr/bin/python3 -m pip install psutil
```

### 4. Probar manualmente

```bash
python3 /config/domoconector/domoconector.py
```

Deberías ver en consola:
```
2026-08-04 12:00:00 [INFO] Domoconector v1.0.0 iniciando...
2026-08-04 12:00:00 [INFO] HW ID   : 0626-0001
2026-08-04 12:00:00 [INFO] Heartbeat OK | CPU: 12.3% | RAM: 48.7% | Disco: 22.1% | Temp: 51.0°C
```

Y en el panel de gestión el badge de la instalación cambia a **Online** en menos de 1 minuto.

### 5. Ejecutar en segundo plano (arranque automático)

**Opción A — shell_command en HA (recomendada):**

En `/config/configuration.yaml` añadir:

```yaml
shell_command:
  start_domoconector: "nohup python3 /config/domoconector/domoconector.py >> /config/domoconector/domoconector.log 2>&1 &"
```

Crear una automatización que lo ejecute al arrancar HA:

```yaml
automation:
  - alias: "Iniciar Domoconector"
    trigger:
      - platform: homeassistant
        event: start
    action:
      - service: shell_command.start_domoconector
```

**Opción B — systemd (si el sistema operativo lo permite):**

```ini
# /etc/systemd/system/domoconector.service
[Unit]
Description=Domoconector Domotekan
After=network.target

[Service]
ExecStart=/usr/bin/python3 /config/domoconector/domoconector.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable domoconector
systemctl start domoconector
```

## Seguridad

- El `connector_token` identifica únicamente esta instalación. No da acceso a ningún otro sistema.
- Si el token se compromete, genera uno nuevo desde el panel (borra el existente en `hardware_devices.connector_token` y vuelve a hacer clic en "Descargar config.json").
- El script no contiene claves globales de Supabase ni de Domotekan.

## Solución de problemas

| Problema | Causa probable | Solución |
|---|---|---|
| Error HTTP 401 | Token o hw_id incorrecto | Descarga de nuevo el config.json desde el panel |
| Error HTTP 403 | Instalación inactiva | El estado en hardware_devices no es 'active' |
| Error de red | Sin conectividad | Verificar que el RPi tiene acceso a internet |
| Métricas null | psutil no instalado | `pip3 install psutil` |
| Panel no actualiza | < 7 min desde primer HB | Esperar el ciclo (120s por defecto) |
