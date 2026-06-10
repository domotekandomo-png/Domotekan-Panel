// Vercel Serverless Function — POST /api/diagnose
// Reads ha_token + client_url from Supabase (service role, never exposed to browser),
// calls HA REST API, then asks Claude for a plain-language diagnosis.

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;

module.exports = async function handler(req, res) {
  const _origin = req.headers.origin;
  const _allowed = new Set(['https://panel-gestion.domotekan.com', 'http://localhost:3000', 'http://localhost:5173']);
  if (_origin && _allowed.has(_origin)) { res.setHeader('Access-Control-Allow-Origin', _origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Método no permitido' });

  const { server_id, auth_token } = req.body || {};
  if (!server_id || !auth_token) {
    return res.status(400).json({ error: 'Faltan parámetros: server_id y auth_token son obligatorios' });
  }

  // ── 1. Verificar sesión del usuario ───────────────────────────────────────
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${auth_token}`
    }
  }).catch(() => null);

  if (!authCheck || !authCheck.ok) {
    return res.status(401).json({ error: 'Sesión expirada. Refresca la página.' });
  }

  // ── 2. Leer ha_token + client_url con service role (nunca al browser) ─────
  const srvRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hardware_devices?id=eq.${encodeURIComponent(server_id)}&select=id,client_name,client_url,ha_token`,
    {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Accept':        'application/json'
      }
    }
  ).catch(() => null);

  if (!srvRes || !srvRes.ok) {
    return res.status(500).json({ error: 'Error al consultar la base de datos' });
  }

  const servers = await srvRes.json();
  const srv = Array.isArray(servers) ? servers[0] : null;

  if (!srv) {
    return res.status(404).json({ error: 'Servidor no encontrado' });
  }
  if (!srv.ha_token) {
    return res.status(422).json({ error: 'Token de Home Assistant no configurado. Edita la instalación y añade el HA Token.' });
  }
  if (!srv.client_url) {
    return res.status(422).json({ error: 'URL del servidor no disponible' });
  }

  const haBase    = srv.client_url.replace(/\/$/, '');
  const haHeaders = { 'Authorization': `Bearer ${srv.ha_token}`, 'Content-Type': 'application/json' };

  // ── 3. Llamar a la API de Home Assistant ──────────────────────────────────
  const [statesResult, errorsResult] = await Promise.allSettled([
    fetchWithTimeout(`${haBase}/api/states`,    { headers: haHeaders }, 15000),
    fetchWithTimeout(`${haBase}/api/error/all`, { headers: haHeaders }, 15000)
  ]);

  let unavailableEntities = [];
  let systemErrors        = [];

  if (statesResult.status === 'fulfilled' && statesResult.value.ok) {
    const allStates = await statesResult.value.json().catch(() => []);
    unavailableEntities = allStates
      .filter(s => s.state === 'unavailable' || s.state === 'unknown')
      .map(s => ({
        entity_id:     s.entity_id,
        state:         s.state,
        friendly_name: s.attributes?.friendly_name || null
      }))
      .slice(0, 60);
  }

  if (errorsResult.status === 'fulfilled' && errorsResult.value.ok) {
    const raw = await errorsResult.value.json().catch(() => []);
    systemErrors = (Array.isArray(raw) ? raw : []).slice(0, 30);
  }

  const haUnreachable = statesResult.status === 'rejected' ||
                        (statesResult.status === 'fulfilled' && !statesResult.value.ok);

  // ── 4. Llamar a Claude ────────────────────────────────────────────────────
  const diagContext = {
    servidor:                srv.client_name || srv.id,
    ha_accesible:            !haUnreachable,
    entidades_no_disponibles: unavailableEntities,
    errores_sistema:          systemErrors
  };

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json'
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: [
        {
          type: 'text',
          text: `Eres un técnico experto en Home Assistant y domótica. Analiza los datos de diagnóstico de una instalación y devuelve un informe breve en español.

Estructura tu respuesta SIEMPRE con estas 4 secciones usando estos encabezados exactos:
**Diagnóstico:**
**Entidades afectadas:**
**Causa probable:**
**Acción recomendada:**

Reglas:
- Sé directo y técnico pero comprensible para un técnico instalador.
- Si ha_accesible es false, el servidor HA no responde — indica que el problema es de conectividad antes de analizar nada más.
- Si no hay errores ni entidades caídas, indícalo en 1 frase positiva.
- Máximo 250 palabras en total.`,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{
        role:    'user',
        content: `Datos de diagnóstico:\n\`\`\`json\n${JSON.stringify(diagContext, null, 2)}\n\`\`\``
      }]
    })
  }).catch(() => null);

  if (!anthropicRes || !anthropicRes.ok) {
    return res.status(502).json({ error: 'Error al contactar con la IA. Inténtalo en un momento.' });
  }

  const aiData   = await anthropicRes.json();
  const diagnosis = aiData.content?.[0]?.text || 'Sin diagnóstico disponible';

  return res.status(200).json({
    diagnosis,
    ha_reachable:      !haUnreachable,
    unavailable_count: unavailableEntities.length,
    error_count:       systemErrors.length
  });
};

// ── Helpers ────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
