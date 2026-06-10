// Vercel Serverless Function — GET /api/my-ip
// Devuelve la IP pública del llamante (usada por el panel admin para capturar la WAN IP del hogar)

module.exports = (req, res) => {
  const _origin = req.headers.origin;
  const _allowed = new Set(['https://panel-gestion.domotekan.com', 'http://localhost:3000', 'http://localhost:5173']);
  if (_origin && _allowed.has(_origin)) { res.setHeader('Access-Control-Allow-Origin', _origin); res.setHeader('Vary', 'Origin'); }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket?.remoteAddress
           || 'unknown';
  res.json({ ip });
};
