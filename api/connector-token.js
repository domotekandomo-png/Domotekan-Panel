// Vercel Serverless Function — POST /api/connector-token
// Genera o devuelve el connector_token de una instalación concreta.
// El token identifica solo esa instalación: no da acceso a nada más.
//
// Requiere: sql/07_connector_token.sql ejecutado en Supabase.
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY (ya existentes)

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const crypto               = require('crypto');

const SB_HDR = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  Accept:         'application/json',
  'Content-Type': 'application/json',
};

const _ORIGIN_ALLOW = /^https:\/\/([a-z0-9-]+\.)?domotekan\.com$|^http:\/\/localhost(:\d+)?$/;

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && _ORIGIN_ALLOW.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método no permitido' });

  const { hw_id, auth_token } = req.body || {};
  if (!hw_id || !auth_token)
    return res.status(400).json({ error: 'Faltan parámetros: hw_id y auth_token' });

  // 1. Verificar sesión Supabase
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${auth_token}` },
  }).catch(() => null);
  if (!authRes?.ok) return res.status(401).json({ error: 'Sesión expirada. Vuelve a entrar.' });

  const { email: userEmail } = await authRes.json().catch(() => ({}));
  if (!userEmail) return res.status(401).json({ error: 'No se pudo identificar al usuario' });

  // 2. Verificar perfil: rol admin/superadmin + activo
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(userEmail)}&select=rol,activo,empresa_id&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);
  if (!profileRes?.ok) return res.status(500).json({ error: 'Error al verificar perfil' });

  const [profile] = await profileRes.json().catch(() => []);
  if (!profile || !profile.activo)
    return res.status(403).json({ error: 'Usuario inactivo o sin acceso' });
  if (!['superadmin', 'admin'].includes(profile.rol))
    return res.status(403).json({ error: 'Se requiere rol admin o superadmin' });

  // 3. Leer la instalación (sin devolver datos sensibles al inicio)
  const normalizedId = hw_id.toUpperCase().trim();
  const hwRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hardware_devices?hw_id=eq.${encodeURIComponent(normalizedId)}&select=id,hw_id,empresa_id,connector_token&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);
  if (!hwRes?.ok) return res.status(500).json({ error: 'Error al consultar instalación' });

  const [hw] = await hwRes.json().catch(() => []);
  if (!hw) return res.status(404).json({ error: 'Instalación no encontrada' });

  // 4. Multi-tenant: admin solo puede acceder a instalaciones de su empresa
  if (profile.rol === 'admin') {
    if (!profile.empresa_id || hw.empresa_id !== profile.empresa_id)
      return res.status(403).json({ error: 'No tienes acceso a esta instalación' });
  }

  // 5. Si ya existe token, devolver el mismo
  if (hw.connector_token) {
    return res.json({ hw_id: normalizedId, connector_token: hw.connector_token });
  }

  // 6. Generar token nuevo: 32 bytes = 64 chars hex (256 bits de entropía)
  const newToken = crypto.randomBytes(32).toString('hex');

  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hardware_devices?id=eq.${hw.id}`,
    {
      method:  'PATCH',
      headers: { ...SB_HDR, Prefer: 'return=minimal' },
      body:    JSON.stringify({ connector_token: newToken }),
    }
  ).catch(() => null);

  if (!updateRes?.ok)
    return res.status(500).json({ error: 'Error al guardar el token del conector' });

  return res.json({ hw_id: normalizedId, connector_token: newToken });
};
