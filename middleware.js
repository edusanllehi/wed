// Acceso con código: solo entra quien tenga el código de la invitación.
// Corre en Vercel antes de servir cualquier página, imagen o /api/rsvp.
//
// - Sin código válido → portada que pide el código (en CA, ES o EN).
// - Código correcto → cookie segura (HttpOnly) de 400 días; no se vuelve a pedir.
// - Enlace directo: https://…/?code=CODIGO entra sin escribir nada.
// - El código se configura en Vercel como variable de entorno SITE_PASSCODE.
//   Cambiarlo invalida todos los accesos anteriores.
import { next } from "@vercel/functions";
import { createHmac, timingSafeEqual } from "node:crypto";

export const config = {
  // Todo menos el cron (que tiene su propio secreto) y robots.txt
  matcher: ["/((?!api/keepalive|robots\\.txt|assets/[a-z0-9-]+\\.woff2).*)"],
};

const COOKIE = "be_access";
const MAX_AGE = 400 * 24 * 60 * 60;

const T = {
  es: { title: "Escribe el código de la invitación", label: "Código", btn: "Entrar", err: "Código incorrecto. Revisa el mensaje de la invitación.", help: "¿No lo encuentras? Escríbenos." },
  ca: { title: "Escriu el codi de la invitació", label: "Codi", btn: "Entra", err: "Codi incorrecte. Revisa el missatge de la invitació.", help: "No el trobes? Escriu-nos." },
  en: { title: "Enter the code from your invitation", label: "Code", btn: "Enter", err: "Wrong code. Please check your invitation message.", help: "Can't find it? Drop us a message." },
};

export const normalize = (s) => String(s ?? "").normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();

export function tokenFor(passcode, salt = "") {
  return createHmac("sha256", `be-access|${salt}`).update(normalize(passcode)).digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function pickLang(req, url) {
  const q = url.searchParams.get("lang");
  return T[q] ? q : "es"; // castellano por defecto
}

// Solo rutas internas: evita redirecciones a otros dominios
export function safeNext(v) {
  const s = String(v || "/");
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export function gatePage(lang, nextPath, error) {
  const t = T[lang];
  const langs = ["ca", "es", "en"].map((l) =>
    l === lang ? `<b>${l.toUpperCase()}</b>` : `<a href="/acceso?lang=${l}&amp;next=${encodeURIComponent(nextPath)}">${l.toUpperCase()}</a>`).join(" · ");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="format-detection" content="telephone=no">
<title>Berta &amp; Edu · 15.05.27</title>
<style>@font-face{font-family:"Instrument Serif";font-weight:400;font-display:swap;src:url(/assets/instrument-serif-latin-400-normal.woff2) format("woff2")}@font-face{font-family:"Cormorant Garamond";font-weight:500;font-display:swap;src:url(/assets/cormorant-garamond-latin-500-normal.woff2) format("woff2")}@font-face{font-family:"Cormorant Garamond";font-weight:600;font-display:swap;src:url(/assets/cormorant-garamond-latin-600-normal.woff2) format("woff2")}</style>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:#F1ECE0;color:#2B2722;font:500 1.25rem/1.5 "Cormorant Garamond",Garamond,Georgia,serif}
main{width:100%;max-width:420px;text-align:center}
.langs{font-size:.8rem;letter-spacing:.2em;margin-bottom:40px}
.langs a{color:#6A6155;text-decoration:none}.langs b{color:#2D6782;font-weight:600}
h1{font:400 clamp(3rem,13vw,4.4rem)/1 "Instrument Serif",Georgia,serif;margin:0;letter-spacing:-.015em}
.date{text-transform:uppercase;letter-spacing:.28em;font-size:.8rem;font-weight:600;color:#2D6782;margin:14px 0 40px}
p{margin:0 0 18px}
form{display:grid;gap:12px}
label{position:absolute;left:-9999px}
input{width:100%;padding:14px 16px;font:500 1.3rem "Cormorant Garamond",Georgia,serif;text-align:center;letter-spacing:.12em;text-transform:uppercase;background:#FBF4E2;color:#2B2722;border:1px solid rgba(43,39,34,.3);border-radius:0}
input:focus{outline:2px solid #2D6782;outline-offset:2px}
button{padding:14px;background:#1E4759;color:#FBF4E2;border:0;font:600 .85rem "Cormorant Garamond",Georgia,serif;letter-spacing:.25em;text-transform:uppercase;cursor:pointer}
button:hover{background:#2D6782}
.err{color:#9B2C1F;font-size:1.05rem;margin-top:4px}
.help{color:#6A6155;font-size:1rem;margin-top:28px}
</style></head><body><main>
<div class="langs">${langs}</div>
<h1>Berta &amp; Edu</h1>
<div class="date">15.05.27 · Menorca</div>
<p>${esc(t.title)}</p>
<form method="post" action="/acceso">
<input type="hidden" name="next" value="${esc(nextPath)}">
<input type="hidden" name="lang" value="${lang}">
<label for="code">${esc(t.label)}</label>
<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="64" placeholder="${esc(t.label)}" ${error ? 'aria-invalid="true" aria-describedby="err"' : ""} autofocus>
<button type="submit">${esc(t.btn)}</button>
${error ? `<div class="err" id="err" role="alert">${esc(t.err)}</div>` : ""}
</form>
<p class="help">${esc(t.help)}</p>
</main></body></html>`;
}

function setCookie(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function middleware(request) {
  const passcode = process.env.SITE_PASSCODE;
  if (!passcode || !normalize(passcode)) {
    // Sin código configurado la web queda abierta (estado anterior). Avisamos en los logs.
    console.warn("[acceso] SITE_PASSCODE no configurado: la web está abierta");
    return next();
  }
  const url = new URL(request.url);
  const expected = tokenFor(passcode, process.env.RSVP_HASH_SALT || "");
  const lang = pickLang(request, url);

  // 1. Ya tiene acceso
  if (safeEqual(readCookie(request, COOKIE), expected)) {
    if (url.pathname === "/acceso") return Response.redirect(new URL(safeNext(url.searchParams.get("next")), url), 303);
    return next();
  }

  // 2. Envía el código desde la portada
  if (url.pathname === "/acceso" && request.method === "POST") {
    let form;
    try { form = await request.formData(); } catch { form = new FormData(); }
    const nextPath = safeNext(form.get("next"));
    const formLang = T[form.get("lang")] ? form.get("lang") : lang;
    if (safeEqual(tokenFor(form.get("code"), process.env.RSVP_HASH_SALT || ""), expected)) {
      return new Response(null, { status: 303, headers: { location: nextPath, "set-cookie": setCookie(expected), ...SECURITY_HEADERS } });
    }
    await wait(600); // frena a quien intente adivinarlo
    return new Response(gatePage(formLang, nextPath, true), { status: 401, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS } });
  }

  // 3. Enlace con el código incluido (?code=…)
  const linkCode = url.searchParams.get("code");
  if (linkCode !== null) {
    url.searchParams.delete("code");
    if (safeEqual(tokenFor(linkCode, process.env.RSVP_HASH_SALT || ""), expected)) {
      const clean = url.pathname + (url.search || "") + url.hash;
      return new Response(null, { status: 303, headers: { location: clean, "set-cookie": setCookie(expected), ...SECURITY_HEADERS } });
    }
    await wait(600);
  }

  // 4. Sin acceso
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ status: "locked" }), { status: 401, headers: { "content-type": "application/json", ...SECURITY_HEADERS } });
  }
  const nextPath = url.pathname === "/acceso"
    ? safeNext(url.searchParams.get("next"))
    : safeNext(url.pathname + (url.search || ""));
  return new Response(gatePage(lang, nextPath, linkCode !== null), { status: 401, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS } });
}
