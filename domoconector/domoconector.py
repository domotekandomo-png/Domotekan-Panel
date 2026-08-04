#!/usr/bin/env python3
"""
Domoconector v1.0.0 — Agente de heartbeat para Domotekan
=========================================================
Ejecutar: python3 domoconector.py

Requiere config.json en el mismo directorio (ver config.json.example).
Descarga la config desde el panel de gestión: Servidores → detalle → Domoconector.

Dependencias:
  Obligatorias : ninguna (solo stdlib Python 3.7+)
  Opcionales   : pip3 install psutil   (para métricas CPU/RAM/disco/temperatura)

Compatibilidad: Linux, macOS, Windows. Probado en Raspberry Pi OS y HA OS.
"""

import json
import time
import urllib.request
import urllib.error
import sys
import os
import logging

CONNECTOR_VERSION = "1.0.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("domoconector")


def load_config():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    if not os.path.exists(config_path):
        log.error("No se encontró config.json en %s", script_dir)
        log.error("Descarga la config desde el panel: Servidores → detalle → Domoconector")
        sys.exit(1)
    try:
        with open(config_path, "r") as f:
            cfg = json.load(f)
    except json.JSONDecodeError as e:
        log.error("config.json inválido: %s", e)
        sys.exit(1)

    for key in ("hw_id", "connector_token", "heartbeat_url"):
        if not cfg.get(key):
            log.error("config.json incompleto: falta '%s'", key)
            sys.exit(1)
    return cfg


def get_metrics():
    """
    Intenta leer métricas del sistema con psutil.
    Si psutil no está instalado, devuelve None en todos los campos sin romper el script.
    """
    metrics = {"cpu": None, "ram": None, "disco": None, "temperatura": None}
    try:
        import psutil

        metrics["cpu"]   = round(psutil.cpu_percent(interval=1), 1)
        metrics["ram"]   = round(psutil.virtual_memory().percent, 1)
        metrics["disco"] = round(psutil.disk_usage("/").percent, 1)

        try:
            temps = psutil.sensors_temperatures()
            if temps:
                # Orden de preferencia: RPi primero, luego Intel, AMD, genérico ACPI
                for key in ("cpu_thermal", "coretemp", "k10temp", "acpitz"):
                    if key in temps and temps[key]:
                        metrics["temperatura"] = round(temps[key][0].current, 1)
                        break
        except (AttributeError, Exception):
            pass  # sensors_temperatures() no disponible en todas las plataformas

    except ImportError:
        pass  # psutil opcional — se enviará null en las métricas

    return metrics


def send_heartbeat(config, metrics):
    payload = {
        "hw_id":             config["hw_id"],
        "connector_token":   config["connector_token"],
        "connector_version": CONNECTOR_VERSION,
        "cpu":               metrics["cpu"],
        "ram":               metrics["ram"],
        "disco":             metrics["disco"],
        "temperatura":       metrics["temperatura"],
    }

    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        config["heartbeat_url"],
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()  # consumir el body
            m = metrics
            log.info(
                "Heartbeat OK | CPU: %s%% | RAM: %s%% | Disco: %s%% | Temp: %s°C",
                m["cpu"]         if m["cpu"]         is not None else "—",
                m["ram"]         if m["ram"]         is not None else "—",
                m["disco"]       if m["disco"]       is not None else "—",
                m["temperatura"] if m["temperatura"] is not None else "—",
            )
            return True

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:300]
        log.warning("Error HTTP %d: %s", e.code, body)
        if e.code in (401, 403):
            log.error("Token o hw_id inválido. Verifica config.json.")
        return False

    except urllib.error.URLError as e:
        log.warning("Error de red: %s (reintentará en el siguiente ciclo)", e.reason)
        return False

    except Exception as e:
        log.warning("Error inesperado: %s", e)
        return False


def main():
    log.info("Domoconector v%s iniciando...", CONNECTOR_VERSION)
    config   = load_config()
    interval = max(30, int(config.get("interval_seconds", 120)))

    log.info("HW ID   : %s", config["hw_id"])
    log.info("URL     : %s", config["heartbeat_url"])
    log.info("Intervalo: %ds", interval)

    try:
        import psutil
        log.info("psutil OK — métricas de sistema activas")
    except ImportError:
        log.info("psutil no instalado — métricas de sistema no disponibles")
        log.info("  Para activarlas: pip3 install psutil")

    # Primer heartbeat inmediato al arrancar
    metrics = get_metrics()
    send_heartbeat(config, metrics)

    while True:
        time.sleep(interval)
        metrics = get_metrics()
        send_heartbeat(config, metrics)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Domoconector detenido.")
        sys.exit(0)
