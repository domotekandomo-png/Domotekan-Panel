// Shared rate limiter — Supabase-backed, NOT a Vercel route (underscore prefix)
// Usage: const { checkRateLimit } = require('./_ratelimit')
// Returns true = allowed, false = limit exceeded

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HDR = {
  apikey:        SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  Accept:        'application/json',
};

async function checkRateLimit(identifier, maxPerMinute) {
  try {
    const since      = new Date(Date.now() - 60000).toISOString();
    const oldCutoff  = new Date(Date.now() - 300000).toISOString(); // 5 min cleanup window

    // Fire-and-forget cleanup of records older than 5 min
    fetch(
      `${SUPABASE_URL}/rest/v1/rate_limits?created_at=lt.${encodeURIComponent(oldCutoff)}`,
      { method: 'DELETE', headers: SB_HDR }
    ).catch(() => null);

    // Count existing requests in the last 60 s
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limits?identifier=eq.${encodeURIComponent(identifier)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      { headers: SB_HDR, signal: AbortSignal.timeout(3000) }
    );

    if (!countRes.ok) return true; // Fail open — never block on DB error

    const rows = await countRes.json();
    if (!Array.isArray(rows) || rows.length >= maxPerMinute) return false;

    // Record this request
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limits`, {
      method:  'POST',
      headers: { ...SB_HDR, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body:    JSON.stringify({ identifier }),
      signal:  AbortSignal.timeout(3000),
    });

    return true;
  } catch (_) {
    return true; // Fail open on any unexpected error
  }
}

module.exports = { checkRateLimit };
