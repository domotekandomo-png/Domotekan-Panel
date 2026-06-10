// Vercel Serverless Function — POST /api/registro
// Auto-registro del cliente. Domotekan nunca maneja las credenciales.
// Soporta hasta max_usuarios por instalación (default 5).
// Requiere tabla instalacion_usuarios en Supabase — ver SCHEMA.sql

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HDR = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: 'application/json' };

module.exports = async function handler(req, res) {
  const _origin = req.headers.origin;
  const _allowed = new Set(['https://panel-gestion.domotekan.com', 'http://localhost:3000', 'http://localhost:5173']);
  if (_origin && _allowed.has(_origin)) { res.setHeader('Access-Control-Allow-Origin', _origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método no permitido' });

  const { hw_id, email, password, nombre } = req.body || {};

  if (!hw_id)    return res.status(400).json({ error: 'Código de dispositivo no proporcionado.' });
  if (!email)    return res.status(400).json({ error: 'El email es obligatorio.' });
  if (!password) return res.status(400).json({ error: 'La contraseña es obligatoria.' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });

  const hwId = hw_id.trim().toUpperCase();

  // 1. Verificar dispositivo y obtener límite de usuarios
  const [devRes, countRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/hardware_devices?hw_id=eq.${enc(hwId)}&select=id,hw_id,client_name,status,max_usuarios&limit=1`,
      { headers: SB_HDR }
    ).catch(() => null),
    fetch(
      `${SUPABASE_URL}/rest/v1/instalacion_usuarios?hw_id=eq.${enc(hwId)}&select=id`,
      { headers: { ...SB_HDR, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }
    ).catch(() => null)
  ]);

  if (!devRes?.ok) {
    const errBody = await devRes?.text().catch(() => '(sin respuesta)');
    console.error('[registro] devRes error', devRes?.status, errBody);
    return res.status(500).json({ error: 'Error al verificar el dispositivo. [' + (devRes?.status ?? 'null') + '] ' + errBody.slice(0, 200) });
  }

  const [device] = await devRes.json();

  if (!device)                    return res.status(404).json({ error: 'Código no encontrado. Comprueba el QR.' });
  if (device.status !== 'active') return res.status(403).json({ error: 'Dispositivo aún no activado. Contacta con tu instalador.' });

  // Verificar red local: el registro solo se permite desde la WiFi del hogar
  // (solo activo si la columna wan_ip existe y está configurada)
  try {
    const wanRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hardware_devices?hw_id=eq.${enc(hwId)}&select=wan_ip&limit=1`,
      { headers: SB_HDR }
    ).catch(() => null);
    if (wanRes?.ok) {
      const [wanData] = await wanRes.json().catch(() => [{}]);
      if (wanData?.wan_ip) {
        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                       || req.socket?.remoteAddress || '';
        if (clientIp && clientIp !== wanData.wan_ip) {
          return res.status(403).json({
            error: 'El registro solo está disponible desde la red WiFi de tu vivienda. Conéctate al WiFi de casa e inténtalo de nuevo.'
          });
        }
      }
    }
  } catch (_) { /* columna wan_ip aún no existe — continuar sin restricción */ }

  // Límite de usuarios (max_usuarios en BD, default 5)
  const maxUsers = device.max_usuarios ?? 5;
  const currentCount = parseInt(countRes?.headers?.get('content-range')?.split('/')[1] ?? '0', 10);

  if (currentCount >= maxUsers) {
    return res.status(409).json({
      error: `Esta instalación ya tiene el máximo de ${maxUsers} usuarios registrados. Contacta con tu instalador para ampliar el plan.`
    });
  }

  // 2. Verificar que este email no está ya registrado en esta instalación
  const dupeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instalacion_usuarios?hw_id=eq.${enc(hwId)}&email=eq.${enc(email.toLowerCase())}&select=id&limit=1`,
    { headers: SB_HDR }
  ).catch(() => null);

  if (dupeRes?.ok) {
    const [dupe] = await dupeRes.json();
    if (dupe) return res.status(409).json({ error: 'Este email ya está registrado en esta instalación. Accede directamente.' });
  }

  // 3. Crear cuenta en Supabase Auth (el cliente introduce sus propios datos)
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  'POST',
    headers: { ...SB_HDR, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { hw_id: hwId, nombre: nombre || '', client_name: device.client_name || '' }
    })
  }).catch(() => null);

  if (!createRes) return res.status(502).json({ error: 'Error de conexión al crear la cuenta.' });

  const createData = await createRes.json();

  if (!createRes.ok) {
    const msg = createData?.msg || createData?.message || '';
    const emailExists = createData?.error_code === 'email_exists'
                     || createData?.code === 'email_exists'
                     || msg.includes('already been registered')
                     || msg.includes('already registered');
    console.error('[registro] createRes error', createRes.status, JSON.stringify(createData));
    if (emailExists) {
      // El email ya existe en Supabase Auth — simplemente vincular a esta instalación
    } else {
      return res.status(400).json({ error: '[' + createRes.status + '] ' + (msg || JSON.stringify(createData) || 'No se pudo crear la cuenta.') });
    }
  }

  // 4. Registrar en instalacion_usuarios
  const linkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instalacion_usuarios`,
    {
      method:  'POST',
      headers: { ...SB_HDR, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ hw_id: hwId, email: email.toLowerCase(), nombre: nombre || null })
    }
  ).catch(() => null);

  if (!linkRes?.ok) {
    console.error('[registro] Error al vincular usuario', email, 'a', hwId, linkRes?.status);
    return res.status(500).json({ error: 'Cuenta creada pero no se pudo vincular a la instalación. Contacta con el instalador.' });
  }

  return res.status(201).json({
    ok:          true,
    client_name: device.client_name || '',
    usuarios:    currentCount + 1,
    max:         maxUsers
  });
};

function enc(s) { return encodeURIComponent(s); }
