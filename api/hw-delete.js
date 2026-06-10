// Vercel Serverless Function — POST /api/hw-delete
// Proxy seguro para eliminar instalaciones via n8n.
// Verifica sesión Supabase + rol superadmin antes de llamar al webhook.
// El token de n8n nunca sale del servidor (variable de entorno N8N_ADMIN_TOKEN).
//
// Variables de entorno requeridas en Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  — ya existentes
//   N8N_ADMIN_TOKEN                     — el token que antes estaba hardcodeado
//   N8N_WEBHOOK_DELETE (opcional)       — URL del webhook (tiene fallback)

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const N8N_ADMIN_TOKEN     = process.env.N8N_ADMIN_TOKEN;
const N8N_WEBHOOK_DELETE  = process.env.N8N_WEBHOOK_DELETE
  || 'https://n8n.domotekan.com/webhook/hw-delete';

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

  const { hw_id, auth_token } = req.body || {};
  if (!hw_id || !auth_token)
    return res.status(400).json({ error: 'Faltan parámetros: hw_id y auth_token son obligatorios' });

  if (!N8N_ADMIN_TOKEN)
    return res.status(500).json({ error: 'N8N_ADMIN_TOKEN no configurado en el servidor' });

  // 1. Verificar sesión Supabase
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${auth_token}` },
  }).catch(() => null);

  if (!authCheck?.ok)
    return res.status(401).json({ error: 'Sesión expirada. Refresca la página.' });

  const { email: userEmail } = await authCheck.json().catch(() => ({}));
  if (!userEmail)
    return res.status(401).json({ error: 'No se pudo identificar al usuario' });

  // 2. Verificar rol superadmin
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(userEmail)}&select=rol&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);

  if (!profileRes?.ok)
    return res.status(500).json({ error: 'Error al verificar permisos' });

  const [profile] = await profileRes.json().catch(() => []);
  if (!profile || profile.rol !== 'superadmin')
    return res.status(403).json({ error: 'Permiso denegado. Se requiere rol superadmin.' });

  // 3. Llamar al webhook de n8n con el token desde variables de entorno
  const resp = await fetch(N8N_WEBHOOK_DELETE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ hw_id, admin_token: N8N_ADMIN_TOKEN }),
    signal:  AbortSignal.timeout(30000),
  }).catch(() => null);

  if (!resp?.ok) {
    const status = resp?.status ?? 'timeout';
    return res.status(502).json({ error: `n8n respondió ${status}. Comprueba que el workflow está activo.` });
  }

  // Audit log (fire-and-forget — no bloquea la respuesta)
  fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
    method:  'POST',
    headers: { ...SB_HDR, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_email: userEmail,
      action:     'hw_delete',
      resource:   hw_id,
      detail:     JSON.stringify({ hw_id }),
      ip:         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
    }),
  }).catch(() => null);

  return res.status(200).json({ ok: true });
};
