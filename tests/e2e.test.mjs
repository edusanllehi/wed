// Prueba de extremo a extremo: navegador real → web → /api/rsvp → Postgres real.
// Supabase se sustituye por una imitación de su API REST sobre PGlite (mismo SQL de la migración).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createDb } from "./helpers/db.mjs";
import { startPostgrest, SERVICE_KEY, ANON_KEY } from "./helpers/postgrest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const I18N = Object.fromEntries(["ca", "es", "en"].map((l) => [l, JSON.parse(readFileSync(join(root, "src/i18n", l + ".json"), "utf8"))]));
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";

let db, pg, web, base, browser, failBackend = false;

before(async () => {
  execFileSync("node", [join(root, "scripts/build.mjs")]);
  db = await createDb();
  pg = await startPostgrest(db, { failNext: () => { const f = failBackend; failBackend = false; return f; } });
  Object.assign(process.env, { SUPABASE_URL: pg.url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, RSVP_HASH_SALT: "e2e-salt" });
  const { startServer } = await import("../scripts/dev-server.mjs");
  web = await startServer(0);
  base = "http://127.0.0.1:" + web.address().port;
  browser = await chromium.launch({ executablePath: CHROME });
});
after(async () => {
  await browser?.close();
  web?.closeAllConnections(); web?.close();
  pg?.server.closeAllConnections(); pg?.server.close();
  await db?.close();
});

async function open(lang, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "es-ES" });
  // Cada "invitado" de la prueba llega desde una IP distinta (como en la vida real)
  await ctx.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 250 + 1) + "-" + Math.random() });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base + "/" + (lang ? "?lang=" + lang : ""));
  return page;
}
async function fill(page, o) {
  if (o.name !== undefined) await page.fill("#nombre", o.name);
  if (o.attending) await page.check(o.attending === "yes" ? "#asiste-si" : "#asiste-no");
  if (o.partner !== undefined) await page.check(o.partner ? "#acomp-si" : "#acomp-no");
  if (o.partnerName) await page.fill("#nombre_acompanante", o.partnerName);
  if (o.pre) await page.check(o.pre === "yes" ? "#pre-si" : "#pre-no");
  for (const d of o.diet || []) await page.check("#dieta-" + d);
  for (const d of o.partnerDiet || []) await page.check("#dieta_acompanante-" + d);
  if (o.bus) await page.check(o.bus === "bus" ? "#bus-si" : "#bus-no");
  if (o.message) await page.fill("#mensaje", o.message);
}
const rowsFor = async (name) => (await db.query(
  "select r.*, g.role, g.full_name, g.dietary from rsvp_responses r join rsvp_guests g on g.response_id = r.id where r.id in (select response_id from rsvp_guests where name_key = lower($1)) order by g.role desc", [name])).rows;
const errorText = (page) => page.locator("#form-error").textContent();

test("RSVP completo en catalán, castellano e inglés: se guarda y se confirma en su idioma", async () => {
  for (const l of ["ca", "es", "en"]) {
    const page = await open(l);
    assert.equal(await page.getAttribute("html", "lang"), l);
    assert.equal(await page.textContent("#submit-btn"), I18N[l].submit);
    const name = `Prova ${l.toUpperCase()} Persona`;
    await fill(page, { name, attending: "yes", partner: true, partnerName: `Parella ${l} Dos`, pre: "yes", diet: ["vegan"], partnerDiet: ["nuts"], bus: "bus", message: "Visca!" });
    await page.click("#submit-btn");
    await page.waitForSelector("#thanks:not([hidden])");
    assert.equal(await page.textContent("#thanks-title"), I18N[l].ty_yes.replace("{n}", "Prova"));
    const rows = await rowsFor(name);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].language, l); assert.equal(rows[0].attending, true); assert.equal(rows[0].transport, "bus");
    assert.deepEqual(rows[0].dietary, ["vegan"]); assert.deepEqual(rows[1].dietary, ["nuts"]);
    await page.context().close();
  }
});

test("un 'no vengo' se guarda correctamente", async () => {
  const page = await open("es");
  await fill(page, { name: "Decline Persona", attending: "no" });
  assert.equal(await page.isHidden("#si-block"), true);
  assert.equal(await page.isHidden("#msg-block"), true);
  await page.click("#submit-btn");
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal(await page.textContent("#thanks-title"), I18N.es.ty_no.replace("{n}", "Decline"));
  const rows = await rowsFor("Decline Persona");
  assert.equal(rows.length, 1); assert.equal(rows[0].attending, false); assert.equal(rows[0].prewedding, null);
  await page.context().close();
});

test("campos obligatorios y regla de pareja: errores traducidos y nada guardado", async () => {
  for (const l of ["ca", "es", "en"]) {
    const page = await open(l);
    const calls = []; page.on("request", (r) => r.url().includes("/api/rsvp") && calls.push(r));
    await page.click("#submit-btn"); assert.equal(await errorText(page), I18N[l].err_name);
    await fill(page, { name: "Validacio " + l });
    await page.click("#submit-btn"); assert.equal(await errorText(page), I18N[l].err_attend);
    await fill(page, { attending: "yes" });
    await page.click("#submit-btn"); assert.equal(await errorText(page), I18N[l].err_plus);
    await fill(page, { partner: true });
    await page.click("#submit-btn"); assert.equal(await errorText(page), I18N[l].err_plusname);
    await fill(page, { partnerName: "Pareja Validacio " + l });
    await page.click("#submit-btn"); assert.equal(await errorText(page), I18N[l].err_pre);
    assert.equal(calls.length, 0);
    assert.equal((await rowsFor("Validacio " + l)).length, 0);
    await page.context().close();
  }
});

test("doble clic en Enviar: una sola petición y una sola fila", async () => {
  const page = await open("ca");
  const calls = []; page.on("request", (r) => r.url().includes("/api/rsvp") && calls.push(r));
  await page.route("**/api/rsvp", async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await fill(page, { name: "Doble Clic", attending: "yes", partner: false, pre: "no" });
  await page.dblclick("#submit-btn");
  await page.click("#submit-btn", { force: true }).catch(() => {});
  assert.equal(await page.isDisabled("#submit-btn"), true);
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal(calls.length, 1);
  assert.equal((await rowsFor("Doble Clic")).length, 1);
  await page.context().close();
});

test("sin conexión: no hay mensaje de éxito, no se pierden los datos y el reintento guarda una vez", async () => {
  const page = await open("en");
  await page.route("**/api/rsvp", (r) => r.abort("internetdisconnected"));
  await fill(page, { name: "Offline Person", attending: "yes", partner: false, pre: "yes", message: "keep me" });
  await page.click("#submit-btn");
  await page.waitForSelector("#form-error:not([hidden])");
  assert.equal(await errorText(page), I18N.en.err_conn);
  assert.equal(await page.isHidden("#thanks"), true);
  assert.equal(await page.inputValue("#nombre"), "Offline Person");
  assert.equal(await page.inputValue("#mensaje"), "keep me");
  assert.equal(await page.isEnabled("#submit-btn"), true);
  assert.equal((await rowsFor("Offline Person")).length, 0);
  await page.unroute("**/api/rsvp");
  await page.click("#submit-btn");
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal((await rowsFor("Offline Person")).length, 1);
  await page.context().close();
});

test("resultado incierto (se guardó pero la respuesta se perdió): el reintento no duplica", async () => {
  const page = await open("es");
  await page.route("**/api/rsvp", async (route) => { await route.fetch(); await route.abort("connectionreset"); });
  await fill(page, { name: "Incierto Persona", attending: "yes", partner: false, pre: "no" });
  await page.click("#submit-btn");
  await page.waitForSelector("#form-error:not([hidden])");
  assert.equal(await page.isHidden("#thanks"), true);
  assert.equal((await rowsFor("Incierto Persona")).length, 1); // ya estaba guardado
  await page.unroute("**/api/rsvp");
  const resp = page.waitForResponse("**/api/rsvp");
  await page.click("#submit-btn");
  assert.deepEqual(await (await resp).json(), { status: "ok", replayed: true });
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal((await rowsFor("Incierto Persona")).length, 1);
  await page.context().close();
});

test("si la base de datos falla: error traducido, sin éxito falso, y se puede reintentar", async () => {
  const page = await open("ca");
  await fill(page, { name: "Fallo Base", attending: "no" });
  failBackend = true;
  await page.click("#submit-btn");
  await page.waitForSelector("#form-error:not([hidden])");
  assert.equal(await errorText(page), I18N.ca.err_server);
  assert.equal(await page.isHidden("#thanks"), true);
  assert.equal((await rowsFor("Fallo Base")).length, 0);
  await page.click("#submit-btn");
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal((await rowsFor("Fallo Base")).length, 1);
  await page.context().close();
});

test("nombre repetido: se avisa en el idioma elegido y no se guarda otra vez", async () => {
  const page = await open("en");
  await fill(page, { name: "decline   persona", attending: "no" });
  await page.click("#submit-btn");
  await page.waitForSelector("#form-error:not([hidden])");
  assert.equal(await errorText(page), I18N.en.err_dup);
  assert.equal((await rowsFor("Decline Persona")).length, 1);
  await page.context().close();
});

test("al recargar tras responder: se ve la confirmación y el registro sigue en la base de datos", async () => {
  const page = await open("ca");
  await fill(page, { name: "Recarrega Persona", attending: "no" });
  await page.click("#submit-btn");
  await page.waitForSelector("#thanks:not([hidden])");
  await page.reload();
  await page.waitForSelector("#thanks:not([hidden])");
  assert.equal(await page.textContent("#thanks-title"), I18N.ca.ty_seen_title);
  assert.ok(!page.url().includes("Recarrega"));
  assert.equal((await rowsFor("Recarrega Persona")).length, 1);
  await page.context().close();
});

test("seguridad: la web no contiene claves y el público no puede leer las respuestas", async () => {
  for (const f of readdirSync(join(root, "dist")).filter((f) => /\.(html|js)$/.test(f))) {
    const s = readFileSync(join(root, "dist", f), "utf8");
    assert.ok(!s.includes(SERVICE_KEY) && !/service_role|SUPABASE/i.test(s), f);
  }
  assert.equal((await fetch(base + "/api/rsvp")).status, 405);
  for (const t of ["rsvp_export", "rsvp_responses", "rsvp_guests"]) {
    const r = await fetch(pg.url + "/rest/v1/" + t, { headers: { apikey: ANON_KEY } });
    assert.equal(r.status, 403, t);
  }
  const rpc = await fetch(pg.url + "/rest/v1/rpc/submit_rsvp", { method: "POST", headers: { apikey: ANON_KEY }, body: JSON.stringify({ p: {}, p_ip_hash: null }) });
  assert.equal(rpc.status, 403);
});

test("todos los textos cambian de idioma y el diseño no se rompe en móvil, tablet y ordenador", async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
    for (const l of ["ca", "es", "en"]) {
      const page = await open(l, vp);
      const mismatches = await page.evaluate((dict) => {
        const out = [];
        document.querySelectorAll("[data-i18n]").forEach((el) => { if (el.textContent !== dict[el.dataset.i18n]) out.push(el.dataset.i18n); });
        return out;
      }, I18N[l]);
      assert.deepEqual(mismatches, [], `${l} ${vp.width}`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= vp.width, `${l} ${vp.width}: scrollWidth ${sw}`);
      const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).length);
      assert.equal(broken, 0);
      await page.context().close();
    }
  }
});

test("límite de abuso: muchas respuestas desde la misma conexión se frenan con un aviso traducido", async () => {
  const ctx = await browser.newContext();
  await ctx.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.99" });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  for (let i = 0; i < 21; i++) {
    await page.goto(base + "/?lang=ca");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await fill(page, { name: "Abus Persona " + i, attending: "no" });
    await page.click("#submit-btn");
    await page.waitForSelector(i < 20 ? "#thanks:not([hidden])" : "#form-error:not([hidden])");
  }
  assert.equal(await errorText(page), I18N.ca.err_rate);
  assert.equal((await rowsFor("Abus Persona 20")).length, 0);
  await ctx.close();
});

test("cambiar de idioma mantiene la elección al recargar y en el enlace", async () => {
  const page = await open("");
  await page.click('.lang button[data-lang="en"]');
  assert.ok(page.url().includes("lang=en"));
  await page.goto(base + "/");
  assert.equal(await page.getAttribute("html", "lang"), "en");
  await page.context().close();
});

test("vosotros podéis exportar todas las respuestas a CSV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsvp-csv-"));
  // asíncrono: el servidor de pruebas vive en este mismo proceso
  const { stdout: out } = await promisify(execFile)("node", [join(root, "scripts/export-csv.mjs")], { cwd: dir, env: { ...process.env, SUPABASE_URL: pg.url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } });
  const file = readdirSync(dir).find((f) => f.endsWith(".csv"));
  const csv = readFileSync(join(dir, file), "utf8");
  const guests = Number((await db.query("select count(*) n from rsvp_guests")).rows[0].n);
  assert.match(csv, /^﻿fecha,invitado,rol,asiste,preboda/);
  assert.equal(csv.trim().split("\n").length - 1, guests);
  assert.match(out, /Guardado/);
});
