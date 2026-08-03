// Vercel Serverless Function — POST /api/hw-provision
// Proxy seguro para provisionar instalaciones via n8n.
// Verifica sesión Supabase + rol (superadmin o admin activo) antes de llamar al webhook.
// El token de n8n nunca sale del servidor (variable de entorno).
//
// Variables de entorno requeridas en Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  — ya existentes
//   N8N_PROVISION_TOKEN                 — token para el webhook de provisioning
//     (fallback: N8N_ADMIN_TOKEN si N8N_PROVISION_TOKEN no está definido)
//   N8N_WEBHOOK_PROVISION (opcional)    — URL del webhook (tiene fallback hardcodeado)

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const N8N_TOKEN            = process.env.N8N_PROVISION_TOKEN || process.env.N8N_ADMIN_TOKEN;
const N8N_WEBHOOK_PROVISION = process.env.N8N_WEBHOOK_PROVISION
  || 'https://n8n.domotekan.com/webhook/provisionar';

const SB_HDR = {
  apikey:        SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  Accept:        'application/json',
};

const ALLOWED_ORIGINS = new Set([
  'https://panel-gestion.domotekan.com',
  'http://localhost:3000',
  'http://localhost:5173',
]);

const ALLOWED_ROLES = new Set(['superadmin', 'admin']);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método no permitido' });

  const { hw_id, client_name, alias, direccion, cp, comunidad, pais, assigned_by, auth_token } = req.body || {};

  if (!hw_id || !client_name || !auth_token)
    return res.status(400).json({ error: 'Faltan parámetros: hw_id, client_name y auth_token son obligatorios' });

  if (!N8N_TOKEN)
    return res.status(500).json({ error: 'N8N_PROVISION_TOKEN no configurado en el servidor' });

  // 1. Verificar sesión Supabase
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${auth_token}` },
  }).catch(() => null);

  if (!authCheck?.ok)
    return res.status(401).json({ error: 'Sesión expirada. Refresca la página.' });

  const { email: userEmail } = await authCheck.json().catch(() => ({}));
  if (!userEmail)
    return res.status(401).json({ error: 'No se pudo identificar al usuario' });

  // 2. Verificar rol (superadmin o admin) y que el usuario esté activo
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(userEmail)}&select=rol,activo&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);

  if (!profileRes?.ok)
    return res.status(500).json({ error: 'Error al verificar permisos' });

  const [profile] = await profileRes.json().catch(() => []);
  if (!profile || !ALLOWED_ROLES.has(profile.rol))
    return res.status(403).json({ error: 'Permiso denegado. Se requiere rol admin o superadmin.' });
  if (!profile.activo)
    return res.status(403).json({ error: 'Usuario inactivo. Contacta con el administrador.' });

  // 3. Llamar al webhook de n8n con el token desde variables de entorno
  const n8nRes = await fetch(N8N_WEBHOOK_PROVISION, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      hw_id,
      client_name,
      alias:     alias     || '',
      direccion: direccion || '',
      cp:        cp        || '',
      comunidad: comunidad || '',
      pais:      pais      || 'España',
      assigned_by: assigned_by || userEmail,
      admin_token: N8N_TOKEN,
    }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);

  if (!n8nRes) {
    return res.status(504).json({ error: 'n8n no respondió (timeout). Comprueba que el workflow está activo.' });
  }

  let n8nData = {};
  try {
    const txt = await n8nRes.text();
    if (txt && txt.trim()) n8nData = JSON.parse(txt);
  } catch (_) { /* body vacío o no-JSON */ }

  if (!n8nRes.ok || !n8nData.ok) {
    return res.status(502).json({
      error: n8nData.error || n8nData.message
        || `n8n respondió HTTP ${n8nRes.status}. Comprueba que WF3 está activo en n8n.`,
    });
  }

  // Audit log (fire-and-forget)
  fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
    method:  'POST',
    headers: { ...SB_HDR, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_email: userEmail,
      action:     'hw_create',
      resource:   hw_id,
      detail:     JSON.stringify({ hw_id, client_name }),
      ip:         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
    }),
  }).catch(() => null);

  return res.status(200).json(n8nData);
};
