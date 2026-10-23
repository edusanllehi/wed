// POST /api/rsvp — guarda una respuesta en Supabase.
// La clave privada de Supabase solo existe aquí, en el servidor (variables de entorno de Vercel).
import { createHash } from "node:crypto";

const LANGS = ["ca", "es", "en"];
const DIET = ["none", "vegetarian", "vegan", "gluten_free", "lactose_free", "nuts", "shellfish", "fish", "pregnant"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 20_000;

// Quita caracteres de control (deja saltos de línea solo si se pide) y recorta
function clean(v, { max, multiline = false } = {}) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  let s = v.normalize("NFC").replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  s = multiline ? s.replace(/\r\n?/g, "\n").trim() : s.replace(/\s+/g, " ").trim();
  if (max && s.length > max) return null;
  return s;
}
const nameKey = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

function diets(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > DIET.length) return null;
  if (!v.every((x) => typeof x === "string" && DIET.includes(x))) return null;
  const set = [...new Set(v)];
  if (set.includes("none") && set.length > 1) return null;
  return set;
}

// Devuelve { ok: true, value } con los datos limpios, o { ok: false, field }
export function validate(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, field: "body" };
  if (typeof b.website === "string" && b.website.trim() !== "") return { ok: false, field: "website" };
  if (typeof b.submission_id !== "string" || !UUID.test(b.submission_id)) return { ok: false, field: "submission_id" };
  if (!LANGS.includes(b.language)) return { ok: false, field: "language" };
  const name = clean(b.name, { max: 120 });
  if (!name || name.length < 2) return { ok: false, field: "name" };
  if (b.attending !== "yes" && b.attending !== "no") return { ok: false, field: "attending" };

  const out = { submission_id: b.submission_id.toLowerCase(), language: b.language, name, attending: b.attending === "yes" };
  if (!out.attending) return { ok: true, value: { ...out, with_partner: false } };

  if (b.with_partner !== "partner" && b.with_partner !== "alone") return { ok: false, field: "with_partner" };
  if (b.prewedding !== "yes" && b.prewedding !== "no") return { ok: false, field: "prewedding" };
  if (!["", undefined, null, "bus", "car"].includes(b.transport)) return { ok: false, field: "transport" };
  const dietary = diets(b.dietary);
  if (!dietary) return { ok: false, field: "dietary" };
  const dietary_other = clean(b.dietary_other, { max: 300 });
  if (dietary_other === null) return { ok: false, field: "dietary_other" };
  const message = clean(b.message, { max: 2000, multiline: true });
  if (message === null) return { ok: false, field: "message" };

  Object.assign(out, {
    with_partner: b.with_partner === "partner",
    prewedding: b.prewedding === "yes",
    transport: b.transport || "",
    dietary, dietary_other, message,
  });

  if (out.with_partner) {
    const partner_name = clean(b.partner_name, { max: 120 });
    if (!partner_name || partner_name.length < 2 || nameKey(partner_name) === nameKey(name)) return { ok: false, field: "partner_name" };
    const partner_dietary = diets(b.partner_dietary);
    if (!partner_dietary) return { ok: false, field: "partner_dietary" };
    const partner_dietary_other = clean(b.partner_dietary_other, { max: 300 });
    if (partner_dietary_other === null) return { ok: false, field: "partner_dietary_other" };
    Object.assign(out, { partner_name, partner_dietary, partner_dietary_other });
  }
  return { ok: true, value: out };
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// En Vercel, estas cabeceras las pone la propia plataforma (el visitante no puede falsearlas)
function clientIp(req) {
  for (const h of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const v = req.headers[h];
    if (typeof v === "string" && v) return v.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

async function readBody(req) {
  let parsed;
  try { parsed = req.body; } catch { return { badJson: true }; } // Vercel lanza si el JSON no es válido
  if (parsed !== undefined) {
    if (typeof parsed === "string") return parsed.length > MAX_BODY ? { tooLarge: true } : { text: parsed };
    if (Buffer.isBuffer(parsed)) return parsed.length > MAX_BODY ? { tooLarge: true } : { text: parsed.toString("utf8") };
    return { json: parsed };
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return { tooLarge: true }; chunks.push(c); }
  return { text: Buffer.concat(chunks).toString("utf8") };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { status: "method_not_allowed" }); }

  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) return send(res, 415, { status: "invalid" });

  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length && origin && !allowed.includes(origin)) return send(res, 403, { status: "forbidden" });

  const raw = await readBody(req);
  if (raw.tooLarge) return send(res, 413, { status: "invalid" });
  if (raw.badJson) return send(res, 400, { status: "invalid" });
  let body = raw.json;
  if (body === undefined) { try { body = JSON.parse(raw.text || ""); } catch { return send(res, 400, { status: "invalid" }); } }

  const v = validate(body);
  if (!v.ok) return send(res, 400, { status: "invalid", field: v.field });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("rsvp: Supabase no está configurado"); return send(res, 503, { status: "not_configured" }); }

  const salt = process.env.RSVP_HASH_SALT;
  const ip = clientIp(req);
  const ipHash = salt && ip ? createHash("sha256").update(salt + "|" + ip).digest("hex") : null;

  // Claves nuevas de Supabase (sb_secret_…) van solo en "apikey"; las antiguas (JWT) también en Authorization
  const headers = { "Content-Type": "application/json", apikey: key };
  if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key;

  let r, out;
  try {
    r = await fetch(url.replace(/\/+$/, "") + "/rest/v1/rpc/submit_rsvp", {
      method: "POST",
      headers,
      body: JSON.stringify({ p: v.value, p_ip_hash: ipHash }),
      signal: AbortSignal.timeout(10_000),
    });
    out = await r.json().catch(() => null);
  } catch (e) {
    console.error("rsvp: no se pudo contactar con Supabase:", e?.name || "error");
    return send(res, 502, { status: "error" });
  }
  if (!r.ok || !out || typeof out.status !== "string") {
    console.error("rsvp: respuesta inesperada de Supabase, HTTP", r.status, out?.code || "");
    return send(res, 502, { status: "error" });
  }

  switch (out.status) {
    case "ok": return send(res, 200, { status: "ok", replayed: !!out.replayed });
    case "duplicate": return send(res, 409, { status: "duplicate" });
    case "rate_limited": return send(res, 429, { status: "rate_limited" });
    case "invalid": return send(res, 400, { status: "invalid" });
    default: return send(res, 502, { status: "error" });
  }
}
