// Vercel Serverless Function — GET /api/my-ip
// Devuelve la IP pública del llamante (usada por el panel admin para capturar la WAN IP del hogar)

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket?.remoteAddress
           || 'unknown';
  res.json({ ip });
};
