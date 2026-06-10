// Vercel Serverless Function — POST /api/ha-proxy
// Proxy seguro hacia Home Assistant. El ha_token nunca sale del servidor.
// Actions: "load_home" | "call_service" | "get_state"

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const { checkRateLimit }   = require('./_ratelimit');

const ALLOWED_DOMAINS = ['light', 'switch', 'cover', 'climate', 'sensor',
                         'binary_sensor', 'input_boolean', 'fan'];

module.exports = async function handler(req, res) {
  const _origin = req.headers.origin;
  const _allowed = new Set(['https://panel-gestion.domotekan.com', 'http://localhost:3000', 'http://localhost:5173']);
  if (_origin && _allowed.has(_origin)) { res.setHeader('Access-Control-Allow-Origin', _origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método no permitido' });

  const { auth_token, hw_id, action, payload } = req.body || {};
  if (!auth_token || !hw_id || !action)
    return res.status(400).json({ error: 'Faltan parámetros: auth_token, hw_id, action' });

  // 1. Verificar sesión Supabase y obtener el email del usuario autenticado
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${auth_token}` }
  }).catch(() => null);
  if (!authCheck?.ok) return res.status(401).json({ error: 'Sesión expirada. Vuelve a entrar.' });
  const { email: userEmail } = await authCheck.json().catch(() => ({}));

  // 2. Leer ha_token + client_url + client_email con service role (nunca al browser)
  const normalizedId = hw_id.toUpperCase();
  const srvRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hardware_devices?hw_id=eq.${encodeURIComponent(normalizedId)}&select=id,client_name,client_url,ha_token,status,client_email,max_usuarios&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: 'application/json' } }
  ).catch(() => null);

  if (!srvRes?.ok) return res.status(500).json({ error: 'Error de base de datos' });
  const [srv] = await srvRes.json();

  if (!srv)                    return res.status(404).json({ error: 'Instalación no encontrada. Verifica tu código.' });
  if (srv.status !== 'active') return res.status(403).json({ error: 'Instalación pendiente. Contacta con tu instalador.' });
  if (!srv.ha_token)           return res.status(422).json({ error: 'Sin configuración de acceso. Contacta con tu instalador.' });
  if (!srv.client_url)         return res.status(422).json({ error: 'URL del servidor no disponible.' });

  // 3. Verificar que el usuario autenticado está registrado en esta instalación
  if (userEmail) {
    const accessRes = await fetch(
      `${SUPABASE_URL}/rest/v1/instalacion_usuarios?hw_id=eq.${encodeURIComponent(normalizedId)}&email=eq.${encodeURIComponent(userEmail.toLowerCase())}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: 'application/json' } }
    ).catch(() => null);

    if (accessRes?.ok) {
      const [access] = await accessRes.json();
      // Si la tabla existe y no hay coincidencia, denegar. Si la tabla aún no existe (error),
      // caer al fallback de client_email para compatibilidad durante la transición.
      if (!access && srv.client_email && srv.client_email.toLowerCase() !== userEmail.toLowerCase()) {
        return res.status(403).json({ error: 'No tienes acceso a esta instalación.' });
      }
      if (!access && !srv.client_email) {
        return res.status(403).json({ error: 'No tienes acceso a esta instalación.' });
      }
    }
  }

  const haBase = srv.client_url.replace(/\/$/, '');
  const haHdr  = { Authorization: `Bearer ${srv.ha_token}`, 'Content-Type': 'application/json' };

  // ── LOAD HOME ──────────────────────────────────────────────────────────────
  // call_service y get_state están exentos de rate limit (son controles en tiempo real)
  if (action === 'load_home') {
    const rlKey = `ha-proxy:${auth_token.slice(-16)}`;
    if (!(await checkRateLimit(rlKey, 30))) {
      return res.status(429).json({ error: 'Demasiadas cargas. Espera un momento.' });
    }

    const [areasTpl, statesRes] = await Promise.allSettled([
      haPost(`${haBase}/api/template`, haHdr, { template: '{{ areas() | list | tojson }}' }).then(r => r.text()),
      haGet(`${haBase}/api/states`, haHdr).then(r => r.json())
    ]);

    const allStates = (statesRes.status === 'fulfilled' && Array.isArray(statesRes.value))
      ? statesRes.value : [];
    const statesMap = Object.fromEntries(allStates.map(s => [s.entity_id, s]));

    let areaIds = [];
    try {
      const raw = areasTpl.status === 'fulfilled' ? areasTpl.value.trim() : '[]';
      areaIds = JSON.parse(raw);
    } catch (_) {}

    // Sin áreas configuradas → agrupar todo en un área virtual
    if (!Array.isArray(areaIds) || !areaIds.length) {
      const entities = allStates
        .filter(s => ALLOWED_DOMAINS.includes(s.entity_id.split('.')[0]))
        .map(slim);
      return res.json({
        server_name: srv.client_name,
        areas: [{ id: '__all__', name: 'Mi Vivienda', entities }]
      });
    }

    // Cargar nombre + entidades de cada área en paralelo
    const areaDetails = await Promise.allSettled(
      areaIds.map(async id => {
        const [nameTpl, entitiesTpl] = await Promise.allSettled([
          haPost(`${haBase}/api/template`, haHdr, { template: `{{ area_name('${id}') }}` }).then(r => r.text()),
          haPost(`${haBase}/api/template`, haHdr, { template: `{{ area_entities('${id}') | list | tojson }}` }).then(r => r.text())
        ]);
        const name = nameTpl.status === 'fulfilled'
          ? nameTpl.value.trim().replace(/^["']|["']$/g, '') : id;
        let entityIds = [];
        try { entityIds = JSON.parse(entitiesTpl.status === 'fulfilled' ? entitiesTpl.value.trim() : '[]'); } catch (_) {}
        return { id, name, entityIds };
      })
    );

    const areas = areaDetails
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .map(({ id, name, entityIds }) => ({
        id, name,
        entities: entityIds
          .filter(eid => ALLOWED_DOMAINS.includes(eid.split('.')[0]) && statesMap[eid])
          .map(eid => slim(statesMap[eid]))
      }))
      .filter(a => a.entities.length > 0);

    return res.json({ server_name: srv.client_name, areas });
  }

  // ── CALL SERVICE ───────────────────────────────────────────────────────────
  if (action === 'call_service') {
    const { domain, service, entity_id, service_data } = payload || {};
    if (!domain || !service || !entity_id)
      return res.status(400).json({ error: 'Faltan domain, service o entity_id' });
    if (!ALLOWED_DOMAINS.includes(domain))
      return res.status(403).json({ error: 'Dominio no permitido' });

    const r = await fetch(`${haBase}/api/services/${domain}/${service}`, {
      method:  'POST',
      headers: haHdr,
      signal:  AbortSignal.timeout(10000),
      body:    JSON.stringify({ entity_id, ...(service_data || {}) })
    }).catch(() => null);

    if (!r?.ok) return res.status(502).json({ error: 'Error al ejecutar el comando en HA' });
    return res.json({ ok: true });
  }

  // ── GET STATE (para refrescos puntuales) ───────────────────────────────────
  if (action === 'get_state') {
    const { entity_id } = payload || {};
    if (!entity_id) return res.status(400).json({ error: 'Falta entity_id' });

    const r = await haGet(`${haBase}/api/states/${encodeURIComponent(entity_id)}`, haHdr);
    if (!r.ok) return res.status(502).json({ error: 'Error al consultar estado' });
    return res.json(slim(await r.json()));
  }

  return res.status(400).json({ error: 'Acción desconocida' });
};

// Extrae solo los campos que necesita el panel del cliente
function slim(s) {
  if (!s) return null;
  const { entity_id, state, attributes: a = {} } = s;
  return {
    entity_id,
    domain:              entity_id.split('.')[0],
    state,
    name:                a.friendly_name || entity_id,
    brightness:          a.brightness          ?? null,
    current_temperature: a.current_temperature ?? null,
    temperature:         a.temperature         ?? null,
    hvac_action:         a.hvac_action         ?? null,
    unit:                a.unit_of_measurement ?? null,
    device_class:        a.device_class        ?? null,
    current_position:    a.current_position    ?? null,
    supported_features:  a.supported_features  ?? null
  };
}

async function haGet(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }).catch(() => null);
  return r || { ok: false, json: async () => [], text: async () => '' };
}

async function haPost(url, headers, body) {
  const r = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
  }).catch(() => null);
  return r || { ok: false, text: async () => '' };
}
