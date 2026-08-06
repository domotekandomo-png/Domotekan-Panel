// Vercel Serverless Function — POST /api/heartbeat
// Endpoint público del Domoconector. Autenticación: hw_id + connector_token por instalación.
// No requiere sesión Supabase. No expone la anon key al conector.
//
// Requiere: sql/07_connector_token.sql ejecutado en Supabase.
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY (ya existentes)

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SB_HDR = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  Accept:         'application/json',
  'Content-Type': 'application/json',
};

module.exports = async function handler(req, res) {
  // Endpoint público: puede ser llamado desde cualquier origen (el conector es server-side)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método no permitido' });

  const body = req.body || {};
  const {
    connector_version,
    cpu, ram, disco, temperatura,
  } = body;

  // Compatibilidad: connector_token puede venir en el body o en la cabecera
  // x-domotekan-token (instalaciones antiguas tipo rest_command de HA, que no
  // pueden meter !secret dentro de una plantilla Jinja del payload).
  // hw_id acepta también hwId (nombre usado por el conector legacy).
  const connector_token = body.connector_token || req.headers['x-domotekan-token'];
  const hw_id = body.hw_id || body.hwId;

  if (!hw_id || !connector_token)
    return res.status(400).json({ error: 'Faltan hw_id y connector_token' });

  // 1. Verificar hw_id + connector_token contra hardware_devices (service key)
  const normalizedId = hw_id.toUpperCase().trim();
  const hwRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hardware_devices` +
    `?hw_id=eq.${encodeURIComponent(normalizedId)}` +
    `&connector_token=eq.${encodeURIComponent(connector_token)}` +
    `&select=id,hw_id,status&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);

  if (!hwRes?.ok) {
    console.error('[heartbeat] error consultando hardware_devices:', hwRes?.status);
    return res.status(500).json({ error: 'Error interno' });
  }

  const [hw] = await hwRes.json().catch(() => []);
  // No distinguir "hw_id incorrecto" de "token incorrecto" para no dar información
  if (!hw) return res.status(401).json({ error: 'Credenciales no válidas' });

  if (hw.status !== 'active')
    return res.status(403).json({ error: 'Instalación inactiva' });

  // 2. Construir payload de heartbeat
  const now = new Date().toISOString();
  const payload = {
    hw_id:             normalizedId,
    servidor_id:       hw.id,
    recibido_en:       now,
    connector_version: typeof connector_version === 'string' ? connector_version : null,
    cpu:               typeof cpu         === 'number' ? cpu         : null,
    ram:               typeof ram         === 'number' ? ram         : null,
    disco:             typeof disco       === 'number' ? disco       : null,
    temperatura:       typeof temperatura === 'number' ? temperatura : null,
  };

  // 3. UPSERT en heartbeats — 1 fila por hw_id (modelo estado actual, no histórico)
  // ?on_conflict=hw_id es obligatorio: sin él PostgREST usa la PK y hace INSERT siempre.
  // Requiere UNIQUE CONSTRAINT heartbeats_hw_id_unique (creado por sql/07_connector_token.sql).
  // PostgREST no acepta índices parciales para upsert — se usa CONSTRAINT completo.
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/heartbeats?on_conflict=hw_id`, {
    method:  'POST',
    headers: { ...SB_HDR, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(payload),
  }).catch(() => null);

  if (!upsertRes?.ok) {
    const body = await upsertRes?.text().catch(() => '');
    console.error('[heartbeat] upsert error:', upsertRes?.status, body);
    return res.status(500).json({ error: 'Error al registrar heartbeat' });
  }

  return res.json({ ok: true, recibido_en: now });
};
