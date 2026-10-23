// GET /api/keepalive — lo llama Vercel una vez al día (ver "crons" en vercel.json)
// para que Supabase no pause el proyecto gratuito por inactividad.
// No devuelve ningún dato de invitados.
export default async function handler(req, res) {
  const done = (code, body) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return done(405, { ok: false }); }

  // Vercel envía "Authorization: Bearer <CRON_SECRET>" a los crons si CRON_SECRET está configurado
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== "Bearer " + secret) return done(401, { ok: false });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return done(503, { ok: false });
  const headers = { apikey: key };
  if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key;
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/rest/v1/rsvp_totals?select=personas_que_vienen", { headers, signal: AbortSignal.timeout(10_000) });
    await r.arrayBuffer();
    return done(r.ok ? 200 : 502, { ok: r.ok });
  } catch {
    return done(502, { ok: false });
  }
}
